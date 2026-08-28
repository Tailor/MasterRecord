/**
 * 1.24.0 — EF Core's database-creation + history object model, ported:
 * RelationalDatabaseCreator (EnsureCreated/EnsureDeleted/HasTables/CreateTables),
 * HistoryRepository (the migrations history table) and context.database
 * (EF's DatabaseFacade).
 *
 * The behaviour that matters most is EF's: EnsureCreated is ALL-OR-NOTHING —
 * it creates the model's tables only when the database has no tables at all, and
 * never alters an existing one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import { createDatabaseCreator, SqliteDatabaseCreator } from '../Migrations/RelationalDatabaseCreator.js';
import { createHistoryRepository, SqliteHistoryRepository } from '../Migrations/HistoryRepository.js';
import HistoryRow from '../Migrations/HistoryRow.js';

process.env.master = 'development';

class Tenant {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
}
class Invoice {
    id(db) { db.integer().primary().auto(); }
    amount(db) { db.integer(); }
}

function makeCtx(dir) {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-efc-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Tenant); this.dbset(Invoice); }
    }
    return new testContext();
}
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mr-efc-'));

test('provider resolution picks the SQLite creator and history repository', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    assert.ok(createDatabaseCreator(ctx) instanceof SqliteDatabaseCreator);
    assert.ok(createHistoryRepository(ctx) instanceof SqliteHistoryRepository);
    assert.equal(createHistoryRepository(ctx).tableName, '_masterrecord_migrations', 'keeps the existing history table name');
    await ctx.close();
});

test('EnsureCreated creates every table on an empty database and is a no-op afterwards', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();

    assert.equal(await ctx.database.hasTables(), false, 'a brand new database has no tables');
    assert.equal(await ctx.database.ensureCreated(), true, 'first call creates the schema');
    assert.equal(await ctx.database.hasTables(), true);

    const names = ctx._SQLEngine.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    assert.ok(names.includes('Tenant'), 'Tenant created');
    assert.ok(names.includes('Invoice'), 'Invoice created');

    // the tables really work
    const t = ctx.Tenant.new(); t.name = 'acme'; ctx.Tenant.add(t);
    await ctx.saveChanges();
    assert.equal((await ctx.Tenant.toList()).length, 1);

    assert.equal(await ctx.database.ensureCreated(), false, 'second call performs no operations');
    await ctx.close();
});

test('EnsureCreated is all-or-nothing: it never adds a missing table to a database that already has tables', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    // A legacy hand-made table, as a database that predates migrations would have.
    ctx._execute(`CREATE TABLE "Tenant" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)`);
    ctx._execute(`INSERT INTO "Tenant" ("name") VALUES ('legacy-row')`);

    assert.equal(await ctx.database.hasTables(), true);
    assert.equal(await ctx.database.ensureCreated(), false, 'EF does nothing when any table exists');

    const names = ctx._SQLEngine.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    assert.ok(!names.includes('Invoice'), 'the missing table is NOT created — this is not a per-table sync');
    const rows = ctx._SQLEngine.db.prepare(`SELECT name FROM "Tenant"`).all();
    assert.deepEqual(rows.map(r => r.name), ['legacy-row'], 'the populated table is untouched');
    await ctx.close();
});

test('generateCreateScript emits the DDL without executing it', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    const script = await ctx.database.generateCreateScript();
    assert.match(script, /CREATE TABLE IF NOT EXISTS "Tenant"/);
    assert.match(script, /CREATE TABLE IF NOT EXISTS "Invoice"/);
    assert.equal(await ctx.database.hasTables(), false, 'generating a script creates nothing');
    await ctx.close();
});

test('HistoryRepository: create, record, read back, insert/delete scripts', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    const history = ctx.database.historyRepository;

    assert.equal(await history.exists(), false);
    assert.equal(await history.createIfNotExists(), true, 'created');
    assert.equal(await history.exists(), true);
    assert.equal(await history.createIfNotExists(), false, 'already present');

    await history.recordApplied('1700000000000_Init_migration.js');
    await history.recordApplied('1700000000001_AddInvoices_migration.js');
    const rows = await history.getAppliedMigrations();
    assert.deepEqual(rows.map(r => r.migrationId), [
        '1700000000000_Init_migration.js',
        '1700000000001_AddInvoices_migration.js',
    ], 'ordered by migration id');
    assert.ok(rows[0] instanceof HistoryRow);
    assert.match(rows[0].productVersion, /^\d+\.\d+\.\d+/, 'product version recorded (EF ProductVersion)');
    assert.ok(rows[0].appliedAt, 'applied_at preserved');

    assert.match(history.getInsertScript(new HistoryRow('x', '1.0.0', 'now')),
        /INSERT INTO "_masterrecord_migrations" \("migration_name", "product_version", "applied_at"\) VALUES \('x', '1\.0\.0', 'now'\)/);
    assert.match(history.getDeleteScript("it's"), /DELETE FROM "_masterrecord_migrations" WHERE "migration_name" = 'it''s'/);

    await history.recordReverted('1700000000001_AddInvoices_migration.js');
    assert.deepEqual((await history.getAppliedMigrations()).map(r => r.migrationId), ['1700000000000_Init_migration.js']);
    await ctx.close();
});

test('a history table written by an older masterrecord (no product_version) is upgraded and still readable', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    // exactly what pre-1.24 masterrecord created
    ctx._execute(`CREATE TABLE [_masterrecord_migrations] (migration_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    ctx._execute(`INSERT INTO [_masterrecord_migrations] (migration_name, applied_at) VALUES ('1_Old_migration.js', '2026-01-01')`);

    const applied = await ctx.database.getAppliedMigrations();
    assert.deepEqual(applied, ['1_Old_migration.js'], 'legacy rows still read');
    const rows = await ctx.database.getAppliedMigrationRows();
    assert.equal(rows[0].productVersion, null, 'legacy row has no product version');

    let cols = ctx._SQLEngine.db.prepare(`PRAGMA table_info([_masterrecord_migrations])`).all().map(c => c.name);
    assert.ok(!cols.includes('product_version'), 'reading never alters the table');

    // writing history upgrades the table in place, and new rows carry the version
    await ctx.database.baseline('2_New_migration.js');
    cols = ctx._SQLEngine.db.prepare(`PRAGMA table_info([_masterrecord_migrations])`).all().map(c => c.name);
    assert.ok(cols.includes('product_version'), 'the column was added in place on first write');
    const after = await ctx.database.getAppliedMigrationRows();
    assert.deepEqual(after.map(r => r.migrationId), ['1_Old_migration.js', '2_New_migration.js']);
    assert.equal(after[0].productVersion, null, 'legacy row keeps a null version');
    assert.match(after[1].productVersion, /^\d+\.\d+\.\d+/, 'new row records the product version');
    await ctx.close();
});

test('baseline() records a migration as applied without running it (EF: bring an existing database under migration control)', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE "Tenant" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)`);

    assert.equal(await ctx.database.baseline('1700000000000_Init_migration.js'), true);
    assert.deepEqual(await ctx.database.getAppliedMigrations(), ['1700000000000_Init_migration.js']);
    assert.equal(await ctx.database.baseline('1700000000000_Init_migration.js'), false, 'already baselined');

    const names = ctx._SQLEngine.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    assert.ok(!names.includes('Invoice'), 'baselining runs no DDL');
    assert.match(ctx.database.getBaselineScript('abc'), /^INSERT INTO "_masterrecord_migrations"/);
    await ctx.close();
});

test('canConnect and EnsureDeleted', async () => {
    const dir = freshDir();
    const ctx = makeCtx(dir);
    await ctx._ensureReady();
    assert.equal(await ctx.database.canConnect(), true);
    await ctx.database.ensureCreated();

    const file = path.join(dir, 'db.sqlite3');
    assert.equal(fs.existsSync(file), true);
    assert.equal(await ctx.database.ensureDeleted(), true, 'dropped');
    assert.equal(fs.existsSync(file), false, 'the SQLite file is gone');
    assert.equal(await ctx.database.ensureDeleted(), false, 'nothing left to drop');
});

test('SQLite refuses idempotent script fragments, exactly as EF does', async () => {
    const ctx = makeCtx(freshDir());
    await ctx._ensureReady();
    assert.throws(() => ctx.database.historyRepository.getBeginIfNotExistsScript('x'), /does not support idempotent migration scripts/);
    await ctx.close();
});
