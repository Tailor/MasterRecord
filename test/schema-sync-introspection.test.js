/**
 * Schema sync + introspection hardening (1.2.0).
 *
 * Bug class fixed: introspection (`tableExists`/`getTableInfo`) swallowed
 * ALL errors and returned false/[] — so a real failure looked like "table
 * absent", sending schema.createTable() into a blind `CREATE TABLE IF NOT
 * EXISTS` (a no-op on an existing table). New columns were then silently
 * never added, with no error. (Most visible on MySQL/Postgres, whose
 * introspection hits INFORMATION_SCHEMA over the network.)
 *
 * Fixes asserted here (SQLite — the engine the local suite can execute;
 * the same code shape applies to MySQL/Postgres):
 *   1. createTable() on an EXISTING table syncs missing columns (the path
 *      that previously silently no-op'd).
 *   2. getTableInfo on a non-existent table returns [] (genuine absence),
 *      while a real introspection failure THROWS instead of returning [].
 *   3. tableExists distinguishes present/absent and throws on real failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'schemasync';
process.env.MR_SILENT_MIGRATIONS = 'true'; // keep test output clean

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'schema-sync');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.schemasync.json'),
    JSON.stringify({ SyncCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');
const { default: SQLiteEngine } = await import('../SQLLiteEngine.js');

// Account entity used to drive createTable -> syncTable.
class Account {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    google_sub(db) { db.string(); }   // the "later added" column
}
class SyncCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Account);
    }
}

test('createTable on an EXISTING table syncs a missing column (no silent skip)', async () => {
    const ctx = new SyncCtx();
    // Pre-create the table WITHOUT google_sub (simulates a prod table that
    // predates the new column).
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Account; CREATE TABLE Account (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);');

    const before = (await ctx._SQLEngine.getTableInfo('Account')).map(c => c.name);
    assert.ok(!before.includes('google_sub'), 'precondition: column absent');

    // Run the migration schema op the way a migration would.
    const sch = new schemaCls(SyncCtx);
    await sch._ensureReady();
    await sch.createTable({ __name: 'Account', ...entityShape() });

    const after = (await ctx._SQLEngine.getTableInfo('Account')).map(c => c.name);
    assert.ok(after.includes('google_sub'), `column must be synced onto existing table; got ${after.join(',')}`);
    await ctx.close();
});

// Minimal column-definition shape that createTable/syncTable iterate.
function entityShape() {
    return {
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        name: { name: 'name', type: 'string' },
        google_sub: { name: 'google_sub', type: 'string' },
    };
}

test('getTableInfo: absent table -> [], real failure -> throws (no swallow)', async () => {
    const ctx = new SyncCtx();
    // Absent table is genuine absence (empty), not an error.
    const cols = await ctx._SQLEngine.getTableInfo('NoSuchTable');
    assert.deepEqual(cols, []);

    // A real failure must throw, not return []. Simulate by pointing the
    // engine at a closed DB handle.
    const broken = new SQLiteEngine();
    broken.db = { prepare() { throw new Error('database is locked'); } };
    await assert.rejects(
        () => broken.getTableInfo('Account'),
        /introspection failed/,
        'real introspection error must propagate, not be swallowed into []'
    );
    await ctx.close();
});

test('tableExists: present=true, absent=false, real failure throws', async () => {
    const ctx = new SyncCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Account; CREATE TABLE Account (id INTEGER PRIMARY KEY);');
    assert.equal(await ctx._SQLEngine.tableExists('Account'), true);
    assert.equal(await ctx._SQLEngine.tableExists('NoSuchTable'), false);

    const broken = new SQLiteEngine();
    broken.db = { prepare() { throw new Error('disk I/O error'); } };
    await assert.rejects(() => broken.tableExists('Account'), /introspection failed/);
    await ctx.close();
});
