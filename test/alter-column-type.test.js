/**
 * alterColumn type changes across engines (1.2.9).
 *
 * Bug: on SQLite, schema.alterColumn emitted invalid SQL ("near )") — SQLite
 * has no ALTER/MODIFY COLUMN, and the builder path was handed an empty/missing
 * schema. Also, string->text is a no-op on SQLite (both TEXT affinity) yet it
 * still tried to rebuild.
 *
 * Fix:
 *  - SQLite alterColumn reconciles the table to its entity via syncTable's
 *    proven rebuild (rename → recreate → copy common columns → drop), which
 *    no-ops when the resolved type is unchanged (string->text) and rebuilds on
 *    a real affinity change (integer->text), preserving data.
 *  - needRebuildSQLite now compares resolved SQLite affinity (catching ALL
 *    real type changes, not just 3 hardcoded ones).
 *  - MySQL (MODIFY COLUMN) and Postgres (ALTER COLUMN ... TYPE) keep their
 *    native type-change DDL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';

process.env.master = 'altercol';
process.env.MR_SILENT_MIGRATIONS = 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'alter-column');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.altercol.json'),
    JSON.stringify({ AlterCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');

// Entities declare the DESIRED (new) types — the table starts with the OLD type.
class Note { id(db) { db.integer().primary().auto(); } body(db) { db.text(); } }       // body: string -> text
class Score { id(db) { db.integer().primary().auto(); } value(db) { db.text(); } }      // value: integer -> text
class AlterCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Note); this.dbset(Score); }
}

test('SQLite: string -> text is a no-op (no broken DDL, data intact)', async () => {
    const ctx = new AlterCtx();
    // body created as TEXT (string -> TEXT)
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Note; CREATE TABLE Note (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);');
    ctx._SQLEngine.db.prepare('INSERT INTO Note (body) VALUES (?)').run('hello');

    const sch = new schemaCls(AlterCtx);
    await sch._ensureReady();
    sch.fullTable = {}; // truthy (init() sets this in real migrations)
    // Must not throw "near )"
    await sch.alterColumn({ tableName: 'Note', table: { name: 'body', type: 'text' }, changes: {} });

    const rows = await ctx._SQLEngine.getTableInfo('Note');
    assert.equal(rows.find(c => c.name === 'body').type.toUpperCase(), 'TEXT');
    const [row] = ctx._SQLEngine.db.prepare('SELECT body FROM Note').all();
    assert.equal(row.body, 'hello', 'data must be preserved');
    await ctx.close();
});

test('SQLite: integer -> text rebuilds the table and preserves data', async () => {
    const ctx = new AlterCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Score; CREATE TABLE Score (id INTEGER PRIMARY KEY AUTOINCREMENT, value INTEGER);');
    ctx._SQLEngine.db.prepare('INSERT INTO Score (value) VALUES (?)').run(41);
    ctx._SQLEngine.db.prepare('INSERT INTO Score (value) VALUES (?)').run(42);

    const sch = new schemaCls(AlterCtx);
    await sch._ensureReady();
    sch.fullTable = {};
    await sch.alterColumn({ tableName: 'Score', table: { name: 'value', type: 'text' }, changes: {} });

    const cols = await ctx._SQLEngine.getTableInfo('Score');
    assert.equal(cols.find(c => c.name === 'value').type.toUpperCase(), 'TEXT', 'value must now be TEXT');
    const vals = ctx._SQLEngine.db.prepare('SELECT value FROM Score ORDER BY id').all().map(r => r.value);
    assert.deepEqual(vals.map(String), ['41', '42'], 'rows must survive the rebuild');
    await ctx.close();
});

test('MySQL: alterColumn emits MODIFY COLUMN with the new type', () => {
    const sql = new MySQLQuery().alterColumn({ tableName: 'Note', table: { name: 'body', type: 'text' } });
    assert.match(sql, /ALTER TABLE `Note` MODIFY COLUMN `body` TEXT/);
});

test('Postgres: alterColumn emits ALTER COLUMN ... TYPE with the new type', () => {
    const sql = new PostgresQuery().alterColumn({ tableName: 'Note', table: { name: 'body', type: 'text' } });
    assert.match(sql, /ALTER TABLE "Note" ALTER COLUMN "body" TYPE TEXT/);
});
