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
 * retrieval, and executed alterColumn type change (1.2.9).
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

const ENGINES = [
    { name: 'mysql', envVar: 'MR_TEST_MYSQL_URL', target: mysqlTarget(), pkDdl: 'INT AUTO_INCREMENT PRIMARY KEY' },
    { name: 'postgres', envVar: 'MR_TEST_PG_URL', target: postgresTarget(), pkDdl: 'SERIAL PRIMARY KEY' },
];

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
        await ctx.query('DROP TABLE IF EXISTS User');
        await ctx.query(`CREATE TABLE User (id ${eng.pkDdl}, role INTEGER NOT NULL)`);

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

        const rows = await ctx.query('SELECT role FROM User ORDER BY id');
        assert.deepEqual(rows.map(r => Number(r.role)), [2, 1], '.set() must map labels to ints on the multi-row batch path');
        await ctx.close();
    });

    test(`[${eng.name}] multi-row bulkInsert stores all rows and assigns auto IDs`, { skip }, async () => {
        const { ctx } = await buildCtx(eng, [User], 'multibulk');
        await ctx.query('DROP TABLE IF EXISTS User');
        await ctx.query(`CREATE TABLE User (id ${eng.pkDdl}, role INTEGER NOT NULL)`);

        const mk = (label) => { const e = ctx.User.new(); e.role = label; ctx.User.add(e); return e; };
        const a = mk('operator');
        const b = mk('administrator');
        const c = mk('operator');
        await ctx.saveChanges();

        for (const e of [a, b, c]) {
            assert.equal(typeof e.id, 'number', 'each batched row must get a DB-assigned id');
            assert.ok(e.id > 0);
        }
        const count = await ctx.query('SELECT COUNT(*) AS c FROM User');
        assert.equal(Number(count[0].c), 3);
        await ctx.close();
    });

    test(`[${eng.name}] single and batch store identical values for a .set() field`, { skip }, async () => {
        // single
        let built = await buildCtx(eng, [User], 'parity_single');
        await built.ctx.query('DROP TABLE IF EXISTS User');
        await built.ctx.query(`CREATE TABLE User (id ${eng.pkDdl}, role INTEGER NOT NULL)`);
        let e = built.ctx.User.new();
        Object.getPrototypeOf(e)._role = 'operator';
        built.ctx.User.add(e);
        await built.ctx.saveChanges();
        const single = Number((await built.ctx.query('SELECT role FROM User'))[0].role);
        await built.ctx.close();

        // batch
        built = await buildCtx(eng, [User], 'parity_batch');
        await built.ctx.query('DROP TABLE IF EXISTS User');
        await built.ctx.query(`CREATE TABLE User (id ${eng.pkDdl}, role INTEGER NOT NULL)`);
        for (const label of ['operator', 'administrator']) {
            const x = built.ctx.User.new();
            Object.getPrototypeOf(x)._role = label;
            built.ctx.User.add(x);
        }
        await built.ctx.saveChanges();
        const batchFirst = Number((await built.ctx.query('SELECT role FROM User ORDER BY id'))[0].role);
        await built.ctx.close();

        assert.equal(single, 2);
        assert.equal(batchFirst, single, 'batch must produce the same column value as single');
    });

    test(`[${eng.name}] alterColumn executes the native type change (VARCHAR -> TEXT)`, { skip }, async () => {
        const { ctx, Cls } = await buildCtx(eng, [Note], 'altercol');
        await ctx.query('DROP TABLE IF EXISTS Note');
        await ctx.query(`CREATE TABLE Note (id ${eng.pkDdl}, body VARCHAR(50))`);
        await ctx.query("INSERT INTO Note (body) VALUES ('hello')");

        const sch = new schemaCls(Cls);
        await sch._ensureReady();
        sch.fullTable = {}; // truthy (real migrations set this in init())
        await sch.alterColumn({ tableName: 'Note', table: { name: 'body', type: 'text' }, changes: {} });

        // information_schema reports the live column type cross-engine.
        const typeRows = eng.name === 'mysql'
            ? await ctx.query("SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_NAME = 'Note' AND COLUMN_NAME = 'body' AND TABLE_SCHEMA = DATABASE()")
            : await ctx.query("SELECT data_type AS t FROM information_schema.columns WHERE table_name = 'Note' AND column_name = 'body'");
        assert.match(String(typeRows[0].t).toLowerCase(), /text/, 'body must now be a TEXT type');

        const [row] = await ctx.query('SELECT body FROM Note');
        assert.equal(row.body, 'hello', 'data must be preserved across the type change');
        await ctx.close();
    });
}
