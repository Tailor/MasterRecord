/**
 * Security hardening (1.4.0).
 *
 * Covers the fixes from the production/enterprise security audit:
 *
 *  1. LIMIT/OFFSET injection — `.take()` / `.skip()` are interpolated into
 *     LIMIT/OFFSET (which cannot be parameterized). Pagination values are the
 *     most common place an app forwards raw user input, so a non-numeric value
 *     is a direct injection vector. The setter and every engine now reject
 *     anything that isn't a non-negative integer.
 *
 *  2. Operator whitelist — the SQL operator (`func`) emitted into a WHERE/AND
 *     clause is re-asserted against a fixed allowlist at the SQL boundary, so a
 *     hand-built query object can never smuggle SQL in via the operator slot.
 *
 *  3. Literal escaping — inline lambda literals (the non-parameterized `'${arg}'`
 *     branch) now double the single quote (ANSI escape), so a literal value
 *     containing `'` can't break out of the string literal. This is both a
 *     correctness fix (values like `O'Brien`) and defense-in-depth for
 *     string-built queries. Runtime user values should still use `$$`/`$`.
 *
 *  4. Atomic saveChanges — a failed multi-row write rolls the whole batch back
 *     (verified on SQLite; the same start/end/errorTransaction + savepoint
 *     contract now backs MySQL and Postgres).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Tools from '../Tools.js';
import SQLiteEngine from '../SQLLiteEngine.js';
import MySQLEngine from '../mySQLEngine.js';
import PostgresEngine from '../postgresEngine.js';
import queryScript from '../QueryLanguage/queryScript.js';

process.env.master = 'sec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'security');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.sec.json'),
    JSON.stringify({ SecCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Rec {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    n(db) { db.integer(); }
}
class SecCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Rec); }
}

// Fresh table with a UNIQUE(name) constraint so we can force a mid-batch failure.
function freshCtx() {
    const ctx = new SecCtx();
    ctx._SQLEngine.db.exec(
        'DROP TABLE IF EXISTS Rec; CREATE TABLE Rec (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, n INTEGER);'
    );
    return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. take()/skip() LIMIT/OFFSET injection
// ─────────────────────────────────────────────────────────────────────────────

test('take()/skip() reject non-integer / injection strings', async () => {
    const ctx = freshCtx();
    try {
        assert.throws(() => ctx.Rec.take('10; DROP TABLE Rec'), /non-negative integer/);
        assert.throws(() => ctx.Rec.skip('1 UNION SELECT password FROM users'), /non-negative integer/);
        assert.throws(() => ctx.Rec.take(-1), /non-negative integer/);
        assert.throws(() => ctx.Rec.skip(-5), /non-negative integer/);
        assert.throws(() => ctx.Rec.take(1.5), /non-negative integer/);
        assert.throws(() => ctx.Rec.take(Number.MAX_SAFE_INTEGER + 1), /non-negative integer/);
        // A clean numeric string coerces safely (common for `?limit=10` params);
        // only strings that don't parse to a whole number are rejected.
        assert.doesNotThrow(() => ctx.Rec.take('5'));
        // Valid values are accepted and chainable (returns the same builder)
        const q = ctx.Rec;
        assert.equal(q.take(5), q);
        assert.equal(q.skip(2), q);
    } finally {
        await ctx.close();
    }
});

test('engine buildTake/buildLimit + buildSkip coerce or throw on all engines', () => {
    const sqlite = new SQLiteEngine();
    const mysql = new MySQLEngine();
    const pg = new PostgresEngine();

    // valid
    assert.equal(sqlite.buildTake({ take: 5 }), 'LIMIT 5');
    assert.equal(mysql.buildTake({ take: 5 }), 'LIMIT 5');
    assert.equal(pg.buildLimit({ take: 5 }), 'LIMIT 5');

    // injection strings must throw, not reach the SQL string
    assert.throws(() => sqlite.buildTake({ take: '5; DROP TABLE x' }), /Invalid take/);
    assert.throws(() => mysql.buildTake({ take: '5 UNION SELECT 1' }), /Invalid take/);
    assert.throws(() => pg.buildLimit({ take: '5; DELETE FROM x' }), /Invalid take/);

    assert.throws(() => sqlite.buildSkip({ skip: '1 OR 1=1' }), /Invalid skip/);
    assert.throws(() => mysql.buildSkip({ skip: '1; DROP' }), /Invalid skip/);
    assert.throws(() => pg.buildSkip({ skip: '1; DROP' }), /Invalid skip/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Operator whitelist
// ─────────────────────────────────────────────────────────────────────────────

test('Tools.assertSafeOperator accepts known operators, rejects injection', () => {
    for (const op of ['=', '!=', '<>', '<', '>', '<=', '>=', 'is', 'is not', 'IN', 'IS NOT', 'like']) {
        assert.doesNotThrow(() => Tools.assertSafeOperator(op), `should accept ${op}`);
    }
    assert.throws(() => Tools.assertSafeOperator('; DROP TABLE users; --'), /Unsupported SQL operator/);
    assert.throws(() => Tools.assertSafeOperator('= 1 OR 1=1 --'), /Unsupported SQL operator/);
    assert.throws(() => Tools.assertSafeOperator('UNION SELECT'), /Unsupported SQL operator/);
    assert.throws(() => Tools.assertSafeOperator(''), /Unsupported SQL operator/);
    assert.throws(() => Tools.assertSafeOperator(null), /Unsupported SQL operator/);
});

test('each engine buildWhere rejects a tampered (non-whitelisted) operator', () => {
    for (const Engine of [SQLiteEngine, MySQLEngine, PostgresEngine]) {
        const engine = new Engine();
        const qs = new queryScript();
        // A parameterized expression; then tamper the operator as a hand-built
        // query object might.
        qs.where('u => u.name == ?', 'Rec');
        const script = qs.getScript();
        script.where['Rec'].query.expressions[0].func = '; DROP TABLE Rec; --';
        assert.throws(
            () => engine.buildWhere(script, { __name: 'Rec' }),
            /Unsupported SQL operator/,
            `${Engine.name} should reject a tampered operator`
        );
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Literal escaping
// ─────────────────────────────────────────────────────────────────────────────

test('Tools.escapeSqlLiteral doubles single quotes', () => {
    assert.equal(Tools.escapeSqlLiteral("O'Brien"), "O''Brien");
    assert.equal(Tools.escapeSqlLiteral("x' OR '1'='1"), "x'' OR ''1''=''1");
    assert.equal(Tools.escapeSqlLiteral('plain'), 'plain');
});

test('each engine buildWhere escapes an inline literal (no break-out)', () => {
    for (const Engine of [SQLiteEngine, MySQLEngine, PostgresEngine]) {
        const engine = new Engine();
        const qs = new queryScript();
        qs.where('u => u.name == "x\' OR 1=1 --"', 'Rec');
        const script = qs.getScript();
        const sql = engine.buildWhere(script, { __name: 'Rec' });
        // The dangerous single quote must be doubled — the value stays a single
        // string literal rather than terminating it early.
        assert.ok(sql.includes("''"), `${Engine.name} must double-escape the quote: ${sql}`);
        assert.ok(!/OR 1=1[^']*$/.test(sql.replace(/''/g, '')), `${Engine.name} must not leave a bare OR: ${sql}`);
    }
});

test('SQLite end-to-end: an inline literal with an apostrophe round-trips correctly', async () => {
    const ctx = freshCtx();
    try {
        const r = ctx.Rec.new(); r.name = "O'Brien"; r.n = 1;
        await ctx.saveChanges();

        // Inline literal (non-parameterized path). Before the escaping fix this
        // produced `'O'Brien'` → a SQL syntax error.
        const found = await ctx.Rec.where(u => u.name == "O'Brien").toList();
        assert.equal(found.length, 1);
        assert.equal(found[0].name, "O'Brien");
    } finally {
        await ctx.close();
    }
});

test('SQLite end-to-end: a malicious inline literal matches nothing (neutralized)', async () => {
    const ctx = freshCtx();
    try {
        const a = ctx.Rec.new(); a.name = 'alice'; a.n = 1;
        const b = ctx.Rec.new(); b.name = 'bob'; b.n = 2;
        await ctx.saveChanges();

        // If the quote weren't escaped this would become `... = 'x' OR 1=1`
        // and return every row. Escaped, it's a literal that matches no name.
        const rows = await ctx.Rec.where(u => u.name == "x' OR 1=1 --").toList();
        assert.equal(rows.length, 0, 'injection literal must not match all rows');
    } finally {
        await ctx.close();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Atomic saveChanges (verified on SQLite; same contract backs MySQL/PG)
// ─────────────────────────────────────────────────────────────────────────────

test('SQLite: a failed multi-row saveChanges rolls back the entire batch', async () => {
    const ctx = freshCtx();
    try {
        const a = ctx.Rec.new(); a.name = 'dup'; a.n = 1;
        const b = ctx.Rec.new(); b.name = 'unique'; b.n = 2;
        const c = ctx.Rec.new(); c.name = 'dup'; c.n = 3; // violates UNIQUE(name)

        await assert.rejects(() => ctx.saveChanges(), /UNIQUE|constraint/i);

        // Nothing should have been persisted — the whole transaction rolled back.
        const rows = await ctx.Rec.toList();
        assert.equal(rows.length, 0, 'a partial batch must not survive a failed saveChanges');
    } finally {
        await ctx.close();
    }
});

test('SQLite: a fully valid multi-row saveChanges commits all rows', async () => {
    const ctx = freshCtx();
    try {
        for (let i = 0; i < 5; i++) {
            const r = ctx.Rec.new(); r.name = `n${i}`; r.n = i;
        }
        await ctx.saveChanges();
        const rows = await ctx.Rec.toList();
        assert.equal(rows.length, 5);
    } finally {
        await ctx.close();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Transaction/savepoint contract exists on every engine
// ─────────────────────────────────────────────────────────────────────────────

test('every engine exposes the transaction + savepoint contract', () => {
    for (const Engine of [SQLiteEngine, MySQLEngine, PostgresEngine]) {
        const e = new Engine();
        for (const m of ['startTransaction', 'endTransaction', 'errorTransaction',
                         'inTransaction', 'savepoint', 'releaseSavepoint', 'rollbackToSavepoint']) {
            assert.equal(typeof e[m], 'function', `${Engine.name}.${m} must be a function`);
        }
        // Not in a transaction by default.
        assert.equal(e.inTransaction(), false, `${Engine.name} should not start in a transaction`);
    }
});
