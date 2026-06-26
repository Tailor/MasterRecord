/**
 * .toList() must NOT impose an implicit row cap (1.3.3).
 *
 * Bug: toList() injected a default `LIMIT 1000` whenever the caller hadn't
 * chained .take(), so any query matching > 1000 rows silently returned only the
 * first 1000 — no error, no warning, and undocumented. Aggregates derived from
 * the array (counts, sums, "does X exist?") were silently wrong. The cap was
 * also gated on `entityMap.length === 0`, so an .include() query was NOT capped
 * while the same query without an include WAS — identical-looking calls behaved
 * differently.
 *
 * Fix: removed the implicit cap — toList() returns ALL matching rows (like
 * EF/LINQ ToList(), which this API mirrors). .take(n) still limits explicitly.
 *
 * Removing the cap exposed a latent issue: SQLite/MySQL reject a bare OFFSET
 * with no LIMIT, which the implicit LIMIT 1000 used to mask for .skip()-only
 * pagination. buildSkip() on each engine now emits valid SQL:
 *   - SQLite : LIMIT -1 OFFSET n   (-1 = no upper bound)
 *   - MySQL  : LIMIT 18446744073709551615 OFFSET n   (max BIGINT UNSIGNED)
 *   - Postgres: OFFSET n           (bare OFFSET is already valid)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SQLiteEngine from '../SQLLiteEngine.js';
import MySQLEngine from '../mySQLEngine.js';
import PostgresEngine from '../postgresEngine.js';

process.env.master = 'tolistcap';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'tolist-cap');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.tolistcap.json'),
    JSON.stringify({ ListCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Item { id(db) { db.integer().primary().auto(); } n(db) { db.integer(); } }
class ListCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Item); }
}

const TOTAL = 1500; // > the old 1000 cap

function freshCtx() {
    const ctx = new ListCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Item; CREATE TABLE Item (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER);');
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Item (n) VALUES (?)');
    const tx = ctx._SQLEngine.db.transaction(() => {
        for (let i = 1; i <= TOTAL; i++) { insert.run(i); }
    });
    tx();
    return ctx;
}

test('SQLite: toList() returns ALL rows, not a silent 1000', async () => {
    const ctx = freshCtx();
    try {
        const all = await ctx.Item.toList();
        assert.equal(all.length, TOTAL, `expected all ${TOTAL} rows, got ${all.length}`);
    } finally {
        await ctx.close();
    }
});

test('SQLite: where(...).toList() returns ALL matching rows (> 1000)', async () => {
    const ctx = freshCtx();
    try {
        // n > 0 matches every row
        const rows = await ctx.Item.where('x => x.n > $$', 0).toList();
        assert.equal(rows.length, TOTAL);
    } finally {
        await ctx.close();
    }
});

test('SQLite: .take(n) still limits explicitly', async () => {
    const ctx = freshCtx();
    try {
        const five = await ctx.Item.take(5).toList();
        assert.equal(five.length, 5);
    } finally {
        await ctx.close();
    }
});

test('SQLite: .skip() with no .take() is valid SQL and returns the tail', async () => {
    const ctx = freshCtx();
    try {
        const tail = await ctx.Item.skip(TOTAL - 10).toList();
        assert.equal(tail.length, 10, 'bare .skip() must page to the end, not error or cap');
    } finally {
        await ctx.close();
    }
});

test('SQLite: .skip().take() paginates a window', async () => {
    const ctx = freshCtx();
    try {
        const window = await ctx.Item.skip(1495).take(3).toList();
        assert.equal(window.length, 3);
    } finally {
        await ctx.close();
    }
});

// ── buildSkip SQL shape across all three engines ──────────────────────────────

test('SQLite buildSkip: bare OFFSET gets LIMIT -1; with take, plain OFFSET', () => {
    const e = new SQLiteEngine();
    assert.equal(e.buildSkip({ skip: 5 }), 'LIMIT -1 OFFSET 5');
    assert.equal(e.buildSkip({ skip: 5, take: 10 }), 'OFFSET 5');
    assert.equal(e.buildSkip({}), '');
});

test('MySQL buildSkip: bare OFFSET gets max-BIGINT LIMIT; with take, plain OFFSET', () => {
    const e = new MySQLEngine();
    assert.equal(e.buildSkip({ skip: 5 }), 'LIMIT 18446744073709551615 OFFSET 5');
    assert.equal(e.buildSkip({ skip: 5, take: 10 }), 'OFFSET 5');
    assert.equal(e.buildSkip({}), '');
});

test('Postgres buildSkip: bare OFFSET is valid as-is', () => {
    const e = new PostgresEngine();
    assert.equal(e.buildSkip({ skip: 5 }), 'OFFSET 5');
    assert.equal(e.buildSkip({}), '');
});
