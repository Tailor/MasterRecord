/**
 * Public engine-agnostic raw-SQL escape hatch (1.2.7).
 *
 * Before: the only raw escape hatch was `ctx.db`, the engine-specific driver.
 * `ctx.db.prepare().get/all/run` is better-sqlite3's synchronous API; mysql2/pg
 * have no `.prepare()`, so app code written against `ctx.db` "works on SQLite,
 * breaks on MySQL". `context._execute` existed but is the private, migration-
 * logging DDL path (and doesn't return rows on SQLite).
 *
 * Now: `ctx.query(sql, params)` / `ctx.execute(sql, params)` run raw SQL on any
 * engine — returning an array of rows for row-returning statements.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'rawquery';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'raw-query');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.rawquery.json'),
    JSON.stringify({ RawCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class RawCtx extends context {
    constructor() { super(); this.env(envDir); }
}

test('ctx.query runs SELECT and returns an array of rows', async () => {
    const ctx = new RawCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS R; CREATE TABLE R (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);');
    await ctx.execute('INSERT INTO R (name) VALUES (?)', ['alice']);
    await ctx.execute('INSERT INTO R (name) VALUES (?)', ['bob']);

    const rows = await ctx.query('SELECT name FROM R ORDER BY id');
    assert.ok(Array.isArray(rows));
    assert.deepEqual(rows.map(r => r.name), ['alice', 'bob']);
    await ctx.close();
});

test('ctx.execute runs a parameterized UPDATE (the legit cross-context raw case)', async () => {
    const ctx = new RawCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS R; CREATE TABLE R (id INTEGER PRIMARY KEY, name TEXT);');
    await ctx.execute('INSERT INTO R (id, name) VALUES (?, ?)', [1, 'x']);

    await ctx.execute('UPDATE R SET name = ? WHERE id = ?', ['y', 1]);

    const [row] = await ctx.query('SELECT name FROM R WHERE id = ?', [1]);
    assert.equal(row.name, 'y');
    await ctx.close();
});

test('ctx.query/execute are awaitable and engine-agnostic (no ctx.db reach-through)', async () => {
    const ctx = new RawCtx();
    assert.equal(typeof ctx.query, 'function');
    assert.equal(typeof ctx.execute, 'function');
    // On SQLite, ctx.db IS the real (better-sqlite3) driver and is NOT guarded —
    // .prepare() must still work (the guard only applies to MySQL/Postgres).
    assert.equal(typeof ctx.db.prepare, 'function');
    await ctx.close();
});
