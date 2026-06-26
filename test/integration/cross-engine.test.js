/**
 * Cross-engine integration tests — executed against LIVE MySQL / Postgres.
 *
 * These exercise the engine-specific write paths that SQLite unit tests cannot
 * prove, because each engine's bulkInsert is structurally different:
 *   - SQLite  : loops N single INSERTs inside a transaction
 *   - MySQL   : one multi-row `INSERT … VALUES (…),(…)`, id via insertId
 *   - Postgres: one multi-row `INSERT … VALUES (…),(…) RETURNING pk`
 * "Green on SQLite" therefore does NOT prove "green on MySQL/Postgres" — this
 * suite closes that gap by running the real DDL/DML against a real server.
 *
 * Opt in by pointing at a database (CI sets these to service containers):
 *   MR_TEST_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/masterrecord_test
 *   MR_TEST_PG_URL=postgres://user:pass@127.0.0.1:5432/masterrecord_test
 * When unset, the engine's tests are skipped (default `npm test` stays offline).
 *
 * Coverage: batch/single .set() parity (1.2.10), multi-row bulkInsert + auto-PK
 * retrieval, heterogeneous-batch signature grouping + DB defaults (1.3.1), and
 * executed alterColumn type change (1.2.9).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mysqlTarget, postgresTarget } from './engineTargets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: context } = await import('../../context.js');
const { default: schemaCls } = await import('../../Migrations/schema.js');
const { instantiateReadyContext } = await import('../../Migrations/contextInit.js');

const ROLE_MAP = { operator: 2, administrator: 1 };

// Non-nullable INTEGER column with a label->int .set() (the 1.2.10 reported shape).
class User {
    id(db) { db.integer().primary().auto(); }
    role(db) { db.integer().notNullable(); db.set(v => (typeof v === 'string' ? ROLE_MAP[v] : v)); }
}
// body declares the DESIRED type (text); the table starts as VARCHAR for the alter.
class Note {
    id(db) { db.integer().primary().auto(); }
    body(db) { db.text(); }
}
// Optional columns: rows that leave `bio` unset get a DIFFERENT column
// signature than rows that set it — the heterogeneous-batch shape.
class Profile {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    bio(db) { db.string(); }
}
// Used to prove toList() has no implicit row cap (> 1000 rows).
class Counter {
    id(db) { db.integer().primary().auto(); }
    n(db) { db.integer(); }
}

const ENGINES = [
    { name: 'mysql', envVar: 'MR_TEST_MYSQL_URL', target: mysqlTarget(), pkDdl: 'INT AUTO_INCREMENT PRIMARY KEY' },
    { name: 'postgres', envVar: 'MR_TEST_PG_URL', target: postgresTarget(), pkDdl: 'SERIAL PRIMARY KEY' },
];

// Quote a table identifier for HAND-WRITTEN DDL/queries. Postgres folds
// unquoted identifiers to lowercase — and `user` is a reserved word there, so
// `CREATE TABLE User` is a hard syntax error (42601) and `CREATE TABLE Note`
// creates `note` while the engine under test reads/writes the case-preserved
// `"Note"`. MySQL preserves case unquoted, so the bare name is correct there.
const qt = (eng, name) => (eng.name === 'mysql' ? name : `"${name}"`);

// Build a fresh context (and its class, for the migration schema harness) pointed
// at the live engine. MySQL/Postgres init is async, so we await _ensureReady().
async function buildCtx(eng, entities, tag) {
    const master = `xeng_${eng.name}_${tag}`;
    const envDir = path.join(__dirname, 'fixtures', master, 'config', 'environments');
    fs.mkdirSync(envDir, { recursive: true });
    const ctxName = `XCtx_${eng.name}_${tag}`;
    fs.writeFileSync(path.join(envDir, `env.${master}.json`), JSON.stringify({ [ctxName]: eng.target }));
    process.env.master = master;
    // Computed class name so context.env() resolves the matching JSON key.
    const Cls = { [ctxName]: class extends context {
        constructor() { super(); this.env(envDir); for (const e of entities) { this.dbset(e); } }
    } }[ctxName];
    const ctx = new Cls();
    await ctx._ensureReady();
    return { ctx, Cls };
}

for (const eng of ENGINES) {
    const skip = eng.target ? false : `set ${eng.envVar} to run (e.g. ${eng.name}://user:pass@host/db)`;

    test(`[${eng.name}] batch insert (>=2) applies .set() — parity with single path`, { skip }, async () => {
        const { ctx } = await buildCtx(eng, [User], 'setbatch');
        const T = qt(eng, 'User');
        try {
            await ctx.query(`DROP TABLE IF EXISTS ${T}`);
            await ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, role INTEGER NOT NULL)`);

            // Backing holds the RAW label (simulates a construction that didn't run
            // the setter at assignment) — exactly when the raw value used to reach
            // the engine on the batch path.
            const seedRaw = (label) => {
                const e = ctx.User.new();
                Object.getPrototypeOf(e)._role = label;
                ctx.User.add(e);
            };
            seedRaw('operator');
            seedRaw('administrator');
            await ctx.saveChanges();

            const rows = await ctx.query(`SELECT role FROM ${T} ORDER BY id`);
            assert.deepEqual(rows.map(r => Number(r.role)), [2, 1], '.set() must map labels to ints on the multi-row batch path');
        } finally {
            await ctx.close();
        }
    });

    test(`[${eng.name}] multi-row bulkInsert stores all rows and assigns auto IDs`, { skip }, async () => {
        const { ctx } = await buildCtx(eng, [User], 'multibulk');
        const T = qt(eng, 'User');
        try {
            await ctx.query(`DROP TABLE IF EXISTS ${T}`);
            await ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, role INTEGER NOT NULL)`);

            const mk = (label) => { const e = ctx.User.new(); e.role = label; ctx.User.add(e); return e; };
            const a = mk('operator');
            const b = mk('administrator');
            const c = mk('operator');
            await ctx.saveChanges();

            for (const e of [a, b, c]) {
                assert.equal(typeof e.id, 'number', 'each batched row must get a DB-assigned id');
                assert.ok(e.id > 0);
            }
            const count = await ctx.query(`SELECT COUNT(*) AS c FROM ${T}`);
            assert.equal(Number(count[0].c), 3);
        } finally {
            await ctx.close();
        }
    });

    test(`[${eng.name}] heterogeneous batch (different column sets) stays on the bulk path`, { skip }, async () => {
        const { ctx } = await buildCtx(eng, [Profile], 'hetero');
        const T = qt(eng, 'Profile');
        const errors = [];
        const origError = console.error;
        try {
            await ctx.query(`DROP TABLE IF EXISTS ${T}`);
            await ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, name VARCHAR(50), bio VARCHAR(50) DEFAULT 'dft')`);

            // Rows alternate column signatures: {name,bio} vs {name}. Before
            // 1.3.1 this emitted ONE INSERT with the first row's column list →
            // ER_WRONG_VALUE_COUNT_ON_ROW and a silent per-row fallback.
            console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };
            const mk = (name, bio) => {
                const e = ctx.Profile.new();
                e.name = name;
                if (bio !== undefined) e.bio = bio;
                ctx.Profile.add(e);
                return e;
            };
            const a = mk('first', 'custom');
            const b = mk('second');          // bio omitted → must take the DB DEFAULT
            const c = mk('third', 'last');
            await ctx.saveChanges();
            console.error = origError;

            assert.ok(
                !errors.some(m => m.includes('falling back to individual inserts')),
                'heterogeneous batch must NOT fall back to per-row inserts',
            );

            const rows = await ctx.query(`SELECT name, bio FROM ${T} ORDER BY id`);
            assert.deepEqual(
                rows.map(r => [r.name, r.bio]),
                [['first', 'custom'], ['second', 'dft'], ['third', 'last']],
                'omitted column must take its DB-level DEFAULT (no NULL-padding to a column union)',
            );

            // Ids must map back to entities in ORIGINAL input order.
            const idRows = await ctx.query(`SELECT id, name FROM ${T}`);
            const dbIds = Object.fromEntries(idRows.map(r => [r.name, Number(r.id)]));
            assert.equal(Number(a.id), dbIds.first);
            assert.equal(Number(b.id), dbIds.second);
            assert.equal(Number(c.id), dbIds.third);
        } finally {
            console.error = origError;
            await ctx.close();
        }
    });

    test(`[${eng.name}] single and batch store identical values for a .set() field`, { skip }, async () => {
        const T = qt(eng, 'User');

        // single
        let single;
        {
            const built = await buildCtx(eng, [User], 'parity_single');
            try {
                await built.ctx.query(`DROP TABLE IF EXISTS ${T}`);
                await built.ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, role INTEGER NOT NULL)`);
                const e = built.ctx.User.new();
                Object.getPrototypeOf(e)._role = 'operator';
                built.ctx.User.add(e);
                await built.ctx.saveChanges();
                single = Number((await built.ctx.query(`SELECT role FROM ${T}`))[0].role);
            } finally {
                await built.ctx.close();
            }
        }

        // batch
        let batchFirst;
        {
            const built = await buildCtx(eng, [User], 'parity_batch');
            try {
                await built.ctx.query(`DROP TABLE IF EXISTS ${T}`);
                await built.ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, role INTEGER NOT NULL)`);
                for (const label of ['operator', 'administrator']) {
                    const x = built.ctx.User.new();
                    Object.getPrototypeOf(x)._role = label;
                    built.ctx.User.add(x);
                }
                await built.ctx.saveChanges();
                batchFirst = Number((await built.ctx.query(`SELECT role FROM ${T} ORDER BY id`))[0].role);
            } finally {
                await built.ctx.close();
            }
        }

        assert.equal(single, 2);
        assert.equal(batchFirst, single, 'batch must produce the same column value as single');
    });

    test(`[${eng.name}] alterColumn executes the native type change (VARCHAR -> TEXT)`, { skip }, async () => {
        const { ctx, Cls } = await buildCtx(eng, [Note], 'altercol');
        const T = qt(eng, 'Note');
        try {
            await ctx.query(`DROP TABLE IF EXISTS ${T}`);
            await ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, body VARCHAR(50))`);
            await ctx.query(`INSERT INTO ${T} (body) VALUES ('hello')`);

            const sch = new schemaCls(Cls);
            await sch._ensureReady();
            sch.fullTable = {}; // truthy (real migrations set this in init())
            await sch.alterColumn({ tableName: 'Note', table: { name: 'body', type: 'text' }, changes: {} });

            // information_schema reports the live column type cross-engine.
            const typeRows = eng.name === 'mysql'
                ? await ctx.query("SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_NAME = 'Note' AND COLUMN_NAME = 'body' AND TABLE_SCHEMA = DATABASE()")
                : await ctx.query("SELECT data_type AS t FROM information_schema.columns WHERE table_name = 'Note' AND column_name = 'body'");
            assert.match(String(typeRows[0].t).toLowerCase(), /text/, 'body must now be a TEXT type');

            const [row] = await ctx.query(`SELECT body FROM ${T}`);
            assert.equal(row.body, 'hello', 'data must be preserved across the type change');
        } finally {
            await ctx.close();
        }
    });

    test(`[${eng.name}] toList() returns all rows (no implicit 1000 cap) and bare .skip() is valid`, { skip }, async () => {
        const { ctx } = await buildCtx(eng, [Counter], 'tolistcap');
        const T = qt(eng, 'Counter');
        const TOTAL = 1500; // > the old implicit cap
        try {
            await ctx.query(`DROP TABLE IF EXISTS ${T}`);
            await ctx.query(`CREATE TABLE ${T} (id ${eng.pkDdl}, n INTEGER)`);

            // One multi-row INSERT to seed > 1000 rows.
            const values = Array.from({ length: TOTAL }, (_, i) => `(${i + 1})`).join(',');
            await ctx.query(`INSERT INTO ${T} (n) VALUES ${values}`);

            const all = await ctx.Counter.toList();
            assert.equal(all.length, TOTAL, `toList() must return all ${TOTAL} rows, not a capped 1000`);

            // Bare .skip() with no .take() must emit valid SQL on every engine
            // (SQLite/MySQL reject a LIMIT-less OFFSET — the removed implicit
            // cap used to mask that).
            const tail = await ctx.Counter.skip(TOTAL - 10).toList();
            assert.equal(tail.length, 10, 'bare .skip() must page to the end without error');
        } finally {
            await ctx.close();
        }
    });

    test(`[${eng.name}] migration bootstrap AUTO-CREATES a missing database`, { skip }, async () => {
        const autoDb = `mr_autocreate_${eng.name}`;
        const autoTarget = { ...eng.target, database: autoDb };

        // Admin connection (to the existing test DB) to drop/inspect the throwaway DB.
        const admin = (await buildCtx(eng, [User], 'autocreate_admin')).ctx;
        try {
            await admin.query(`DROP DATABASE IF EXISTS ${autoDb}`);

            // Point a context at the NON-EXISTENT database and bootstrap it the
            // way the migration CLI does. Before 1.3.2 this threw "Unknown
            // database" / "does not exist" and never created it.
            const master = `xeng_${eng.name}_autocreate`;
            const envDir = path.join(__dirname, 'fixtures', master, 'config', 'environments');
            fs.mkdirSync(envDir, { recursive: true });
            const ctxName = `XCtx_${eng.name}_autocreate`;
            fs.writeFileSync(path.join(envDir, `env.${master}.json`), JSON.stringify({ [ctxName]: autoTarget }));
            process.env.master = master;
            const Cls = { [ctxName]: class extends context {
                constructor() { super(); this.env(envDir); this.dbset(User); }
            } }[ctxName];

            const ctx = await instantiateReadyContext(Cls);
            try {
                assert.equal(ctx._ready, true, 'bootstrapped context must be ready');
                // The database now exists and is usable.
                await ctx.query(`CREATE TABLE ${qt(eng, 'User')} (id ${eng.pkDdl}, role INTEGER NOT NULL)`);
                const rows = await ctx.query(`SELECT COUNT(*) AS c FROM ${qt(eng, 'User')}`);
                assert.equal(Number(rows[0].c), 0, 'auto-created database must be queryable');
            } finally {
                await ctx.close();
            }

            // Confirm via the admin connection that the database really exists.
            const exists = eng.name === 'mysql'
                ? await admin.query(`SELECT SCHEMA_NAME AS n FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${autoDb}'`)
                : await admin.query(`SELECT datname AS n FROM pg_database WHERE datname = '${autoDb}'`);
            assert.equal(exists.length, 1, 'database must have been auto-created');
        } finally {
            try { await admin.query(`DROP DATABASE IF EXISTS ${autoDb}`); } catch { /* best effort cleanup */ }
            await admin.close();
        }
    });
}
