/**
 * FOREIGN KEY constraints — EF Core always creates FK constraints for
 * relationships; MasterRecord now does too.
 *
 *  - belongsTo columns get `FOREIGN KEY (...) REFERENCES parent(pk) ON DELETE X`.
 *    SQLite: inline in CREATE TABLE (it cannot ADD CONSTRAINT later), and the
 *    connection enables PRAGMA foreign_keys so constraints are enforced.
 *    MySQL/Postgres: ALTER TABLE ... ADD CONSTRAINT after the table exists
 *    (immediately, or deferred to finalize() until the referenced table exists).
 *  - ON DELETE follows the model: CASCADE by default; stopCascadeOnDelete() ->
 *    SET NULL (nullable) / RESTRICT (required); onDelete('...') explicit
 *    (EF OnDelete(DeleteBehavior.*)); excludeForeignKeyFromMigrations() emits
 *    no constraint (EF 11).
 *  - An index is created on FK columns (EF does this; MySQL auto-indexes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';

process.env.master = 'development';

class Parent { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class Child  { id(db) { db.integer().primary().auto(); } label(db) { db.string(); } parent(db) { db.belongsTo('Parent'); } }
class Loose  { id(db) { db.integer().primary().auto(); } parent(db) { db.belongsTo('Parent').nullable().stopCascadeOnDelete(); } }
class Strict { id(db) { db.integer().primary().auto(); } parent(db) { db.belongsTo('Parent').onDelete('restrict'); } }
class NoFk   { id(db) { db.integer().primary().auto(); } parent(db) { db.belongsTo('Parent').excludeForeignKeyFromMigrations(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-fk-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-fk-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        FkCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class FkCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Parent); this.dbset(Child); this.dbset(Loose); this.dbset(Strict); this.dbset(NoFk); }
    }
    return { FkCtx, ctx: new FkCtx() };
}
const entityDef = (ctx, name) => ctx.__entities.find(e => e && e.__name === name);

test('SQLite CREATE TABLE emits inline FOREIGN KEY with the configured ON DELETE behavior', async () => {
    const { FkCtx, ctx } = makeCtx();
    const sch = new schemaCls(FkCtx); await sch._ensureReady();
    const q = new SQLiteQuery();

    const child = entityDef(ctx, 'Child');
    child.__foreignKeys = sch._foreignKeysFor(child);
    assert.match(q.createTable(child), /FOREIGN KEY \(\[parent_id\]\) REFERENCES \[Parent\]\(\[id\]\) ON DELETE CASCADE/, 'default is CASCADE');

    const loose = entityDef(ctx, 'Loose');
    loose.__foreignKeys = sch._foreignKeysFor(loose);
    assert.match(q.createTable(loose), /ON DELETE SET NULL/, 'stopCascadeOnDelete + nullable -> SET NULL');

    const strict = entityDef(ctx, 'Strict');
    strict.__foreignKeys = sch._foreignKeysFor(strict);
    assert.match(q.createTable(strict), /ON DELETE RESTRICT/, "onDelete('restrict') honored");

    const nofk = entityDef(ctx, 'NoFk');
    nofk.__foreignKeys = sch._foreignKeysFor(nofk);
    assert.doesNotMatch(q.createTable(nofk), /FOREIGN KEY/, 'excludeForeignKeyFromMigrations emits no constraint');
    await ctx.close();
});

test('MySQL / Postgres emit ADD CONSTRAINT ... FOREIGN KEY (added after the table, deferred if needed)', () => {
    const fk = { tableName: 'Child', column: 'parent_id', refTable: 'Parent', refColumn: 'id', onDelete: 'CASCADE', name: 'fk_Child_parent_id' };
    assert.match(new MySQLQuery().addForeignKey(fk), /ALTER TABLE `Child` ADD CONSTRAINT `fk_Child_parent_id` FOREIGN KEY \(`parent_id`\) REFERENCES `Parent` \(`id`\) ON DELETE CASCADE/);
    assert.match(new MySQLQuery().dropForeignKey(fk), /ALTER TABLE `Child` DROP FOREIGN KEY `fk_Child_parent_id`/);
    assert.match(new PostgresQuery().addForeignKey(fk), /ALTER TABLE "Child" ADD CONSTRAINT "fk_Child_parent_id" FOREIGN KEY \("parent_id"\) REFERENCES "Parent" \("id"\) ON DELETE CASCADE/);
    assert.match(new PostgresQuery().dropForeignKey(fk), /DROP CONSTRAINT IF EXISTS "fk_Child_parent_id"/);
    // MySQL/PG CREATE TABLE itself stays free of inline FKs (they're added after).
    assert.doesNotMatch(new MySQLQuery().createTable({ __name: 'X', id: { name: 'id', type: 'integer', primary: true } }), /FOREIGN KEY/);
});

test('end-to-end on SQLite: constraints are enforced (PRAGMA foreign_keys ON) and CASCADE deletes children', async () => {
    const { FkCtx, ctx } = makeCtx();
    const sch = new schemaCls(FkCtx); await sch._ensureReady();
    await sch.createTable(entityDef(ctx, 'Parent'));
    await sch.createTable(entityDef(ctx, 'Child'));
    await sch.finalize();

    const fkOn = ctx._SQLEngine.db.pragma('foreign_keys', { simple: true });
    assert.equal(fkOn, 1, 'foreign_keys pragma is ON for the connection');

    // The constraint exists in the table DDL ...
    const ddl = ctx._SQLEngine.db.prepare(`SELECT sql FROM sqlite_master WHERE name='Child'`).get().sql;
    assert.match(ddl, /FOREIGN KEY/i);
    // ... and an index was created on the FK column.
    const idx = ctx._SQLEngine.db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Child'`).all().map(r => r.name);
    assert.ok(idx.some(n => /ix_Child_parent_id/i.test(n)), `FK index created: ${idx.join(', ')}`);

    // Orphan insert is rejected.
    assert.throws(() => ctx._SQLEngine.db.prepare(`INSERT INTO Child (label, parent_id) VALUES ('x', 999)`).run(), /FOREIGN KEY/i);

    // Cascade: deleting the parent removes its children.
    ctx._SQLEngine.db.prepare(`INSERT INTO Parent (name) VALUES ('p')`).run();
    ctx._SQLEngine.db.prepare(`INSERT INTO Child (label, parent_id) VALUES ('c', 1)`).run();
    ctx._SQLEngine.db.prepare(`DELETE FROM Parent WHERE id = 1`).run();
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT COUNT(*) AS n FROM Child`).get().n, 0, 'child cascaded');
    await ctx.close();
});

test('finalize() reports a referenced table that never got created (clear model error)', async () => {
    const { FkCtx } = makeCtx();
    const sch = new schemaCls(FkCtx); await sch._ensureReady();
    // Simulate a deferred FK (as MySQL/PG would queue it) whose parent is missing.
    sch._pendingForeignKeys = [{ tableName: 'Child', column: 'parent_id', refTable: 'Ghost', refColumn: 'id', onDelete: 'CASCADE', name: 'fk_Child_parent_id' }];
    // On SQLite addForeignKey is unsupported, so force the engine check path by
    // stubbing tableExists to false — finalize must surface the missing table.
    const eng = sch.context._SQLEngine;
    const orig = eng.tableExists; eng.tableExists = async () => false;
    try {
        await assert.rejects(() => sch.finalize(), /referenced table\(s\) do not exist.*Ghost/);
    } finally { eng.tableExists = orig; }
});
