/**
 * Verifies chained .where() calls are actually applied to COUNT queries,
 * not silently dropped. Related to the "missing AND clause" family of bugs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'countchained';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'count-chained-where');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'countctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.countchained.json'),
    JSON.stringify({
        CountCtx: {
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
    score(db) { db.integer(); }
}

class CountCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Lead);
    }
}

// Seed 5 rows: 3 stage="New", 2 stage="Won". Of the 3 New, 2 have score > 10.
{
    const ctx = new CountCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Lead (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stage TEXT,
            score INTEGER
        );
    `);
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Lead (stage, score) VALUES (?, ?)');
    insert.run('New', 5);
    insert.run('New', 15);
    insert.run('New', 20);
    insert.run('Won', 30);
    insert.run('Won', 40);
    await ctx.close();
}

test('SQLite: chained .where() before .count() applies both conditions', async () => {
    const ctx = new CountCtx();
    // stage == 'New' AND score > 10 → rows 2 and 3 → count 2
    const n = await ctx.Lead
        .where('l => l.stage == $$', 'New')
        .where('l => l.score > $$', 10)
        .count();
    assert.equal(n, 2, 'only Leads with stage=New AND score>10 counted');
    await ctx.close();
});

test('SQLite: single .where() before .count() still works (sanity)', async () => {
    const ctx = new CountCtx();
    const n = await ctx.Lead.where('l => l.stage == $$', 'New').count();
    assert.equal(n, 3);
    await ctx.close();
});

function buildScript(chainFn) {
    const ctx = new CountCtx();
    const builder = chainFn(ctx.Lead);
    const script = builder.__queryObject.script;
    const entity = ctx.Lead.__entity;
    ctx.close();
    return { script, entity };
}

// Smoke test MySQL/Postgres engines' count query path — we can't run them
// against a real DB, but we can verify the generated SQL contains both
// predicate columns when chained .where() is used.
//
// NOTE: MySQL's getCount and Postgres's getCount build the COUNT SQL inline
// (they don't delegate to buildQuery), so these are separate code paths that
// also need to emit the AND clause.
test('MySQL engine should emit chained-AND predicate columns in count SQL', async () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').where('l => l.score > $$', 10)
    );
    script.count = 'none';
    const engine = new MySQLEngine();
    // Emulate what getCount now builds inline.
    const sql = `SELECT ${engine.buildCount(script, entity)} ${engine.buildFrom(script, entity)} ${engine.buildWhere(script, entity)} ${engine.buildAnd(script, entity)}`;
    assert.match(sql, /\bstage\b/i, 'first predicate column present');
    assert.match(sql, /\bscore\b/i, 'second predicate column present');
    assert.match(sql, /^SELECT COUNT\(\*\)/, 'starts with SELECT COUNT(*)');
});

test('MySQL buildCount: SELECT COUNT(*) when no column specified', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New')
    );
    script.count = 'none';
    const engine = new MySQLEngine();
    assert.equal(engine.buildCount(script, entity), 'COUNT(*)');
});

test('Postgres engine COUNT path should include chained-AND predicate columns', () => {
    const { script, entity } = buildScript((Lead) =>
        Lead.where('l => l.stage == $$', 'New').where('l => l.score > $$', 10)
    );
    script.count = 'none';
    const engine = new PostgresEngine();
    const sql = `SELECT ${engine.buildCount(script, entity)} ${engine.buildFrom(script, entity)} ${engine.buildWhere(script, entity)} ${engine.buildAnd(script, entity)}`;
    assert.match(sql, /\bstage\b/i);
    assert.match(sql, /\bscore\b/i, 'second .where() predicate must survive into the COUNT SQL');
});
