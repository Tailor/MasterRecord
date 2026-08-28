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

class Tenant {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
}
class Invoice {
    id(db) { db.integer().primary().auto(); }
    total(db) { db.integer(); }
}

function contextFor(config) {
    class EfCtx extends masterrecord.context {
        constructor() { super(); this.env(config); this.dbset(Tenant); this.dbset(Invoice); }
    }
    return new EfCtx();
}

const ENGINES = [
    { name: 'mysql', url: process.env.MR_TEST_MYSQL_URL, type: 'mysql' },
    { name: 'postgres', url: process.env.MR_TEST_PG_URL, type: 'postgres' },
];

for (const engine of ENGINES) {
    const skip = engine.url ? false : `set MR_TEST_${engine.name === 'mysql' ? 'MYSQL' : 'PG'}_URL to run (see docker-compose.test.yml)`;

    test(`${engine.name}: EnsureCreated / HasTables / history / baseline / EnsureDeleted end to end`, { skip }, async () => {
        const dbName = `mr_ef_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
        const ctx = contextFor(configFrom(engine.url, engine.type, dbName));
        let cleaned = false;
        try {
            await ctx._ensureReady();

            // the scratch database does not exist yet -> EnsureCreated creates it AND the schema
            const created = await ctx.database.ensureCreated();
            assert.equal(created, true, 'EnsureCreated reports that it created something');
            assert.equal(await ctx.database.hasTables(), true, 'the model tables exist');
            assert.equal(await ctx.database.canConnect(), true);

            // the tables really work
            const t = ctx.Tenant.new(); t.name = 'acme'; ctx.Tenant.add(t);
            await ctx.saveChanges();
            const rows = await ctx.Tenant.toList();
            assert.equal(rows.length, 1);
            assert.equal(rows[0].name, 'acme');

            // EF semantics: a second call performs nothing
            assert.equal(await ctx.database.ensureCreated(), false, 'second EnsureCreated is a no-op');

            // history table: create, record, read back
            const history = ctx.database.historyRepository;
            assert.equal(await history.createIfNotExists(), true, 'history table created');
            assert.equal(await history.exists(), true);
            await history.recordApplied('1700000000000_Init_migration.js');
            const applied = await history.getAppliedMigrations();
            assert.deepEqual(applied.map(r => r.migrationId), ['1700000000000_Init_migration.js']);
            assert.match(applied[0].productVersion, /^\d+\.\d+\.\d+/, 'ProductVersion recorded');
            assert.ok(applied[0].appliedAt, 'applied_at recorded');

            // baseline records without running DDL
            assert.equal(await ctx.database.baseline('1700000000001_Next_migration.js'), true);
            assert.deepEqual(await ctx.database.getAppliedMigrations(), [
                '1700000000000_Init_migration.js',
                '1700000000001_Next_migration.js',
            ]);
            assert.equal(await ctx.database.baseline('1700000000001_Next_migration.js'), false, 'idempotent');

            await history.recordReverted('1700000000001_Next_migration.js');
            assert.deepEqual(await ctx.database.getAppliedMigrations(), ['1700000000000_Init_migration.js']);

            // EnsureDeleted drops the scratch database through an admin connection
            assert.equal(await ctx.database.ensureDeleted(), true, 'dropped');
            cleaned = true;
        } finally {
            if (!cleaned) {
                // best-effort cleanup so a failing assertion does not leave a stray database
                try { await ctx.database.ensureDeleted(); } catch (_) { /* nothing to drop */ }
            }
            try { await ctx.close(); } catch (_) { /* already closed by delete() */ }
        }
    });
}
