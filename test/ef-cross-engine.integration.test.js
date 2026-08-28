/**
 * LIVE MySQL / Postgres coverage for the ported EF classes.
 *
 * Skipped unless a server is configured — bring them up with:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   export MR_TEST_MYSQL_URL=mysql://root:rootpw@127.0.0.1:3306/masterrecord_test
 *   export MR_TEST_PG_URL=postgres://mr:mrpw@127.0.0.1:5432/masterrecord_test
 *   npm test
 *
 * Each engine gets its OWN scratch database (created and dropped by the code under
 * test), so ensureCreated's "only when the database has no tables" gate is exercised
 * honestly instead of against a database that already has tables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import masterrecord from '../MasterRecord.js';

process.env.master = process.env.master || 'development';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

/** masterrecord connection config from a URL, pointed at `database`. */
function configFrom(url, type, database) {
    const u = new URL(url);
    return {
        type,
        host: u.hostname,
        port: Number(u.port || (type === 'mysql' ? 3306 : 5432)),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database,
    };
}

// Deliberately unlikely table names: these run against whatever database the
// URL points at, so they must not collide with anything real.
class MrEfProbeTenant {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
}
class MrEfProbeInvoice {
    id(db) { db.integer().primary().auto(); }
    total(db) { db.integer(); }
}

function contextFor(config) {
    class EfCtx extends masterrecord.context {
        constructor() { super(); this.env(config); this.dbset(MrEfProbeTenant); this.dbset(MrEfProbeInvoice); }
    }
    return new EfCtx();
}

const ENGINES = [
    { name: 'mysql', url: process.env.MR_TEST_MYSQL_URL, type: 'mysql', env: 'MR_TEST_MYSQL_URL' },
    { name: 'postgres', url: process.env.MR_TEST_PG_URL, type: 'postgres', env: 'MR_TEST_PG_URL' },
];

// Creating and dropping a DATABASE needs elevated rights and is far more invasive
// than this coverage needs, so it is OPT-IN. By default the tests use the database
// the URL already points at and only create/drop their own `MrEfProbe*` tables,
// which makes them safe to run against a shared or hosted server.
const ALLOW_CREATE_DB = process.env.MR_TEST_ALLOW_CREATE_DB === '1';

async function dropProbeTables(ctx) {
    for (const t of ['MrEfProbeInvoice', 'MrEfProbeTenant']) {
        const q = ctx.isMySQL ? `DROP TABLE IF EXISTS \`${t}\`` : `DROP TABLE IF EXISTS "${t}"`;
        try { await ctx._execute(q); } catch (_) { /* never existed */ }
    }
}

for (const engine of ENGINES) {
    const skip = engine.url ? false : `set ${engine.env} to run (see docker-compose.test.yml)`;

    test(`${engine.name}: schema creation, history, baseline and migration planning against a live server`, { skip }, async () => {
        const url = new URL(engine.url);
        const dbName = ALLOW_CREATE_DB
            ? `mr_ef_${Date.now()}_${Math.floor(Math.random() * 1e5)}`
            : decodeURIComponent(url.pathname.replace(/^\//, ''));
        assert.ok(dbName, `${engine.env} must include a database name`);

        const ctx = contextFor(configFrom(engine.url, engine.type, dbName));
        try {
            await ctx._ensureReady();

            if (ALLOW_CREATE_DB) {
                assert.equal(await ctx.database.ensureCreated(), true, 'created the scratch database and its schema');
            } else {
                // Never touch tables we did not make.
                await dropProbeTables(ctx);
                assert.equal(await ctx.database.hasTables(), true, 'using an existing database');
                await ctx.database.databaseCreator.createTables();
            }

            assert.equal(await ctx.database.canConnect(), true);

            // the tables really work on this engine
            const t = ctx.MrEfProbeTenant.new(); t.name = 'acme'; ctx.MrEfProbeTenant.add(t);
            await ctx.saveChanges();
            const rows = await ctx.MrEfProbeTenant.toList();
            assert.equal(rows.length, 1);
            assert.equal(rows[0].name, 'acme');

            // history table: create, record, read back with EF's ProductVersion
            const history = ctx.database.historyRepository;
            await history.createIfNotExists();
            assert.equal(await history.exists(), true);
            const probeId = `1700000000000_MrEfProbe_${Date.now()}_migration.js`;
            await history.recordApplied(probeId);
            const applied = await history.getAppliedMigrations();
            const mine = applied.find(r => r.migrationId === probeId);
            assert.ok(mine, 'the migration was recorded');
            assert.match(mine.productVersion, /^\d+\.\d+\.\d+/, 'ProductVersion recorded');
            assert.ok(mine.appliedAt, 'applied_at recorded');

            // baseline is idempotent, and planning reads the live history
            assert.equal(await ctx.database.baseline(probeId), false, 'already applied');
            const secondId = `1700000000001_MrEfProbe_${Date.now()}_migration.js`;
            assert.equal(await ctx.database.baseline(secondId), true);
            const ids = await ctx.database.getAppliedMigrations();
            assert.ok(ids.includes(probeId) && ids.includes(secondId));

            // clean up our history rows
            await history.recordReverted(probeId);
            await history.recordReverted(secondId);
            const after = await ctx.database.getAppliedMigrations();
            assert.ok(!after.includes(probeId) && !after.includes(secondId), 'history rows removed');
        } finally {
            try {
                if (ALLOW_CREATE_DB) await ctx.database.ensureDeleted();
                else { await dropProbeTables(ctx); await ctx.close(); }
            } catch (_) { /* best-effort cleanup */ }
        }
    });
}
