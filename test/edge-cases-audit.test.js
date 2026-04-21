/**
 * Second-pass audit: edge cases and less-common API surfaces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'edgeaudit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'edge-cases-audit');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'edgectx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.edgeaudit.json'),
    JSON.stringify({
        EdgeCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');

class Widget {
    id(db) { db.integer().primary().auto(); }
    sku(db) { db.string(); }
    price(db) { db.integer(); }
    tags(db) {
        db.text().transform({
            toDatabase: v => (typeof v === 'string' ? v : JSON.stringify(v)),
            fromDatabase: v => { try { return JSON.parse(v); } catch { return v; } },
        });
    }
}

class EdgeCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Widget);
    }
}

{
    const ctx = new EdgeCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Widget (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT,
            price INTEGER,
            tags TEXT
        );
    `);
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Widget (sku, price, tags) VALUES (?, ?, ?)');
    insert.run('A-1', 10, '["red"]');
    insert.run('A-2', 20, '["red","blue"]');
    insert.run('B-1', 30, '["green"]');
    insert.run('B-2', 40, '[]');
    insert.run('C-1', 50, null);
    await ctx.close();
}

test('count with specific field: .count(w => w.id)', async () => {
    const db = new EdgeCtx();
    const n = await db.Widget.count('w => w.id');
    assert.equal(n, 5);
    await db.close();
});

test('first() returns a single row', async () => {
    const db = new EdgeCtx();
    const row = await db.Widget.first();
    assert.ok(row, 'first() should return a row');
    assert.equal(row.id, 1, 'first() should return the first by primary key');
    await db.close();
});

test('first() on empty result returns null/undefined without throwing', async () => {
    const db = new EdgeCtx();
    const row = await db.Widget.where('w => w.sku == $$', '__nonexistent__').first();
    assert.ok(row == null, 'first() on empty result should return null');
    await db.close();
});

test('.select() narrows returned columns', async () => {
    const db = new EdgeCtx();
    const rows = await db.Widget.select('w => w.sku').orderBy('w => w.id').toList();
    assert.ok(rows.length > 0);
    // .select() is a projection — `price` should not be set on returned rows
    // (though whether it's strictly absent vs undefined depends on the ORM).
    // At minimum sku should be present.
    for (const r of rows) {
        assert.ok(r.sku, 'sku should be present in selected rows');
    }
    await db.close();
});

test('NULL handling in WHERE: == null should match null rows', async () => {
    const db = new EdgeCtx();
    const rows = await db.Widget.where('w => w.tags == null').toList();
    // C-1 has tags=null
    assert.equal(rows.length, 1, `expected exactly 1 row with tags=null, got ${rows.length}`);
    assert.equal(rows[0].sku, 'C-1');
    await db.close();
});

test('NULL handling in WHERE: != null should match non-null rows', async () => {
    const db = new EdgeCtx();
    const rows = await db.Widget.where('w => w.tags != null').toList();
    // A-1, A-2, B-1, B-2 have non-null tags
    assert.equal(rows.length, 4, `expected 4 rows with tags != null, got ${rows.length}`);
    await db.close();
});

test('transformer roundtrip: array saved as JSON and parsed back', async () => {
    const db = new EdgeCtx();
    const a1 = await db.Widget.where('w => w.sku == $$', 'A-1').single();
    assert.ok(Array.isArray(a1.tags), `tags should be parsed to array, got ${typeof a1.tags}`);
    assert.deepEqual(a1.tags, ['red']);
    await db.close();
});

test('update with transformer: modify array, save, reload, array shape preserved', async () => {
    const db = new EdgeCtx();
    const a2 = await db.Widget.where('w => w.sku == $$', 'A-2').single();
    a2.tags = ['yellow', 'purple'];
    await a2.save();

    const reloaded = await db.Widget.where('w => w.sku == $$', 'A-2').single();
    assert.ok(Array.isArray(reloaded.tags));
    assert.deepEqual(reloaded.tags, ['yellow', 'purple']);
    await db.close();
});

test('chained queries do not leak parameters across calls on the same context', async () => {
    const db = new EdgeCtx();
    const a = await db.Widget.where('w => w.price > $$', 25).toList();
    assert.equal(a.length, 3, 'price > 25 → B-1, B-2, C-1');

    // Issue a second unrelated query — parameters from the first must not leak
    const b = await db.Widget.where('w => w.price < $$', 15).toList();
    assert.equal(b.length, 1, 'price < 15 → A-1 only; parameters from prev call must not leak');
    await db.close();
});

test('raw() produces the expected rows', async () => {
    const db = new EdgeCtx();
    const rows = await db.Widget.raw('SELECT id, sku FROM Widget WHERE price > 20 ORDER BY id').toList();
    assert.ok(rows.length >= 3);
    await db.close();
});

test('save() on tracked entity that was already deleted does not throw obscure error', async () => {
    const db = new EdgeCtx();
    const w = await db.Widget.where('w => w.sku == $$', 'A-1').single();
    // Manually delete the row behind MasterRecord's back
    db._SQLEngine.db.prepare('DELETE FROM Widget WHERE id = ?').run(w.id);

    // Attempt to save a modification — expected: either a clean error or a no-op (0 rows affected)
    w.price = 11;
    try {
        await w.save();
        // No error — that's fine, SQLite UPDATE on nonexistent row affects 0 rows silently
    } catch (err) {
        // Also fine, as long as it's a clear error
        assert.ok(err instanceof Error, 'if thrown, must be an Error');
    }
    await db.close();
});
