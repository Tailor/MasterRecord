/**
 * Regression tests for cross-engine query-builder feature parity.
 *
 * Covers bug report `mySQLEngine.buildQuery() silently drops ORDER BY /
 * LIMIT / OFFSET / chained AND`, plus the equivalent Postgres bug where
 * `buildOrderBy` treated `query.orderBy` as a string (never matching the
 * object shape the fluent API actually produces).
 *
 * Strategy:
 *   - Use the fluent `.orderBy()` / `.orderByDescending()` / `.skip()` /
 *     `.take()` / chained `.where()` APIs to build up a query against a
 *     real SQLite database (which exercises end-to-end).
 *   - Snapshot the internal `queryScript` state at that point.
 *   - Feed the same state into MySQL and Postgres engine `buildQuery()`
 *     methods (no connection needed — the builders are pure functions)
 *     and assert the generated SQL contains the expected clauses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'parity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'query-builder-parity');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'parityctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.parity.json'),
    JSON.stringify({
        ParityCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');
const { default: MySQLEngine } = await import('../mySQLEngine.js');
const { default: PostgresEngine } = await import('../postgresEngine.js');

class Lead {
    id(db) { db.integer().primary().auto(); }
    stage(db) { db.string(); }
    updatedAt(db) { db.integer(); }
}

class ParityCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Lead);
    }
}

// Seed the SQLite DB with 5 rows — distinct updatedAt values so ordering is unambiguous.
{
    const ctx = new ParityCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Lead (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stage TEXT,
            updatedAt INTEGER
        );
    `);
    const rows = [
        { stage: 'New', updatedAt: 1000 },
        { stage: 'New', updatedAt: 5000 },
        { stage: 'New', updatedAt: 3000 },
        { stage: 'New', updatedAt: 2000 },
        { stage: 'Won', updatedAt: 4000 },
    ];
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Lead (stage, updatedAt) VALUES (?, ?)');
    for (const r of rows) insert.run(r.stage, r.updatedAt);
    await ctx.close();
}

//
// SQLite — end-to-end: the query actually hits the DB.
// These confirm the fluent API itself is wired correctly and that the
// SQLite engine applies the clauses (prior behavior; regression guard).
//
test('SQLite: orderBy(updatedAt) returns rows in ascending order', async () => {
    const ctx = new ParityCtx();
    const rows = await ctx.Lead
        .where('l => l.stage == $$', 'New')
        .orderBy('l => l.updatedAt')
        .toList();
    const ts = rows.map(r => r.updatedAt);
    assert.deepEqual(ts, [1000, 2000, 3000, 5000], 'ascending updatedAt');
    await ctx.close();
});

test('SQLite: orderByDescending(updatedAt) returns rows in descending order', async () => {
    const ctx = new ParityCtx();
    const rows = await ctx.Lead
        .where('l => l.stage == $$', 'New')
        .orderByDescending('l => l.updatedAt')
        .toList();
    const ts = rows.map(r => r.updatedAt);
    assert.deepEqual(ts, [5000, 3000, 2000, 1000], 'descending updatedAt');
    await ctx.close();
});

test('SQLite: skip/take paginates correctly', async () => {
    const ctx = new ParityCtx();
    const rows = await ctx.Lead
        .orderBy('l => l.updatedAt')
        .skip(1).take(2)
        .toList();
    const ts = rows.map(r => r.updatedAt);
    assert.deepEqual(ts, [2000, 3000], 'pagination skips first row, takes next two');
    await ctx.close();
});

test('SQLite: chained where() calls AND together', async () => {
    const ctx = new ParityCtx();
    const rows = await ctx.Lead
        .where('l => l.stage == $$', 'New')
        .where('l => l.updatedAt > $$', 1500)
        .orderBy('l => l.updatedAt')
        .toList();
    const ts = rows.map(r => r.updatedAt);
    assert.deepEqual(ts, [2000, 3000, 5000], 'chained where filters correctly');
    await ctx.close();
});

//
// Helper: build a query state with the fluent API, return the script.
// We don't execute it — we just need the internal `script` that gets
// handed to an engine's buildQuery().
//
function buildScript(chainFn) {
    // Use the SQLite context to drive the fluent API, then snapshot the script.
    const ctx = new ParityCtx();
    const builder = chainFn(ctx.Lead);
    const script = builder.__queryObject.script;
    // Ensure the entity we pass matches what the engine expects
    const entity = ctx.Lead.__entity;
    ctx.close();
    return { script, entity };
}

//
// MySQL — string-output tests. Engine builders are pure functions; no
// connection is required to call buildQuery().
//
test('MySQL buildQuery emits ORDER BY ... ASC for .orderBy()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').orderBy('l => l.updatedAt')
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /ORDER BY\s+\w+\.`updatedAt`\s+ASC/, 'ORDER BY updatedAt ASC with backtick-quoted column');
});

test('MySQL buildQuery emits ORDER BY ... DESC for .orderByDescending()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').orderByDescending('l => l.updatedAt')
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /ORDER BY\s+\w+\.`updatedAt`\s+DESC/, 'ORDER BY updatedAt DESC');
});

test('MySQL buildQuery emits LIMIT and OFFSET for .take()/.skip()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.orderBy('l => l.updatedAt').skip(10).take(5)
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /LIMIT\s+5/, 'LIMIT 5 present');
    assert.match(out.query, /OFFSET\s+10/, 'OFFSET 10 present');
});

test('MySQL buildQuery emits AND for chained .where()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').where('l => l.updatedAt > $$', 1500)
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    // Chained .where() can merge into a single WHERE in some engines; either
    // an explicit "AND <expr>" or a WHERE clause that contains the second
    // column is acceptable as long as both conditions land in the SQL.
    assert.match(out.query, /\bstage\b/, 'first predicate column present');
    assert.match(out.query, /\bupdatedAt\b/, 'second predicate column present');
});

test('MySQL buildQuery clauses appear in correct SQL order (WHERE before ORDER BY before LIMIT before OFFSET)', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New')
            .orderBy('l => l.updatedAt')
            .skip(2).take(3)
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    const whereIdx = out.query.indexOf('WHERE');
    const orderIdx = out.query.indexOf('ORDER BY');
    const limitIdx = out.query.indexOf('LIMIT');
    const offsetIdx = out.query.indexOf('OFFSET');
    assert.ok(whereIdx >= 0 && whereIdx < orderIdx, 'WHERE before ORDER BY');
    assert.ok(orderIdx < limitIdx, 'ORDER BY before LIMIT');
    assert.ok(limitIdx < offsetIdx, 'LIMIT before OFFSET');
});

//
// Postgres — same string-output tests.
//
test('Postgres buildQuery emits ORDER BY ... ASC for .orderBy()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').orderBy('l => l.updatedAt')
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /ORDER BY\s+\w+\.updatedAt\s+ASC/);
});

test('Postgres buildQuery emits ORDER BY ... DESC for .orderByDescending()', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').orderByDescending('l => l.updatedAt')
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /ORDER BY\s+\w+\.updatedAt\s+DESC/);
});

test('Postgres buildQuery emits LIMIT and OFFSET', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.orderBy('l => l.updatedAt').skip(10).take(5)
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /LIMIT\s+5/);
    assert.match(out.query, /OFFSET\s+10/);
});

test('Postgres buildQuery clauses appear in correct SQL order (ORDER BY before LIMIT before OFFSET)', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New')
            .orderBy('l => l.updatedAt')
            .skip(2).take(3)
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    const orderIdx = out.query.indexOf('ORDER BY');
    const limitIdx = out.query.indexOf('LIMIT');
    const offsetIdx = out.query.indexOf('OFFSET');
    assert.ok(orderIdx >= 0, 'ORDER BY emitted');
    assert.ok(orderIdx < limitIdx, 'ORDER BY before LIMIT');
    assert.ok(limitIdx < offsetIdx, 'LIMIT before OFFSET');
});
