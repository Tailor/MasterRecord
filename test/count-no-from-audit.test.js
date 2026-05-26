/**
 * Verifies the `.count()` without-prior-`.where()` bug is resolved on
 * all three engines. The SQLite bug manifested because SQLite's getEntity
 * returned "" on fallthrough (MySQL/Postgres returned the name), plus
 * queryMethods.count() didn't bootstrap the entityMap like single()/toList()
 * did. Both fixes are engine-agnostic; this test verifies no engine
 * regresses.
 *
 * Strategy: build a query state via the real fluent API, then feed it to
 * each engine's COUNT path. Assert the generated SQL has a FROM clause
 * and includes COUNT(*).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'countfrom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'count-no-from');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'countctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.countfrom.json'),
    JSON.stringify({
        CountFromCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');
const { default: SQLiteEngine } = await import('../SQLLiteEngine.js');
const { default: MySQLEngine } = await import('../mySQLEngine.js');
const { default: PostgresEngine } = await import('../postgresEngine.js');

class Thing {
    id(db) { db.integer().primary().auto(); }
    label(db) { db.string(); }
}

class CountFromCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Thing);
    }
}

{
    const ctx = new CountFromCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Thing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT
        );
    `);
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Thing (label) VALUES (?)');
    insert.run('a'); insert.run('b'); insert.run('c'); insert.run('d');
    await ctx.close();
}

// End-to-end SQLite test — the only engine we can actually run.
test('SQLite: .count() with no prior .where() returns the correct row count (not 1)', async () => {
    const db = new CountFromCtx();
    const n = await db.Thing.count();
    assert.equal(n, 4, 'count() must reflect actual row count, not silently return 1');
    await db.close();
});

// For MySQL and Postgres, we snapshot the SQL that getCount would build.
// We can't run them without a connection, but the string output is enough
// to prove the FROM clause and COUNT(*) are present.
function snapshotFluentState() {
    const ctx = new CountFromCtx();
    // Mirror what `.count()` does internally: bootstrap entityMap via skipClause
    // when the user calls count() without a prior .where().
    const builder = ctx.Thing;
    if (builder.__queryObject.script.entityMap.length === 0) {
        builder.__queryObject.skipClause(ctx.Thing.__entity.__name);
    }
    const script = builder.__queryObject.script;
    script.count = 'none';  // matches what getCount sets when count is undefined
    const entity = ctx.Thing.__entity;
    ctx.close();
    return { script, entity };
}

test('MySQL: COUNT SQL has a FROM clause even with no prior .where()', () => {
    const { script, entity } = snapshotFluentState();
    const engine = new MySQLEngine();
    const sql = `SELECT ${engine.buildCount(script, entity)} ${engine.buildFrom(script, entity)} ${engine.buildWhere(script, entity)} ${engine.buildAnd(script, entity)}`;
    assert.match(sql, /SELECT\s+COUNT\(\*\)/, 'emits COUNT(*)');
    assert.match(sql, /FROM\s+`Thing`/, 'has FROM clause with backtick-quoted table');
});

test('Postgres: COUNT SQL has a FROM clause even with no prior .where()', () => {
    const { script, entity } = snapshotFluentState();
    const engine = new PostgresEngine();
    const sql = `SELECT ${engine.buildCount(script, entity)} ${engine.buildFrom(script, entity)} ${engine.buildWhere(script, entity)} ${engine.buildAnd(script, entity)}`;
    // Postgres buildCount emits COUNT(alias.*) when count is 'none' — we
    // accept either shape here since the bug under test is about FROM, not
    // the exact COUNT expression.
    assert.match(sql, /SELECT\s+COUNT\(/, 'emits SELECT COUNT(...)');
    assert.match(sql, /FROM\s+"?Thing"?/, 'has FROM clause naming the table (quoted or unquoted)');
});

test('SQLite engine directly: buildFrom on empty entityMap now produces a valid FROM', () => {
    const engine = new SQLiteEngine();
    const fakeScript = { entityMap: [], parentName: '' };
    const fakeEntity = { __name: 'Thing' };
    const from = engine.buildFrom(fakeScript, fakeEntity);
    assert.match(from, /^FROM\s+Thing\b/, `empty entityMap should now produce a FROM clause; got "${from}"`);
});
