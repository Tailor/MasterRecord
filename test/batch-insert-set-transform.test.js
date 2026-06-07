/**
 * Batch-insert / single-insert parity for .set() setters (1.2.10).
 *
 * Bug: masterrecord had two write paths that didn't agree.
 *   - Single insert (1 entity) -> insertManager, which applies .set() setters,
 *     default values, auto timestamps and belongsTo FK resolution.
 *   - Batch insert (>1 entity) -> engine.bulkInsert(entities) DIRECTLY, bypassing
 *     insertManager entirely.
 * So when >=2 entities were saved at once, the batch path handed the raw,
 * un-transformed model values to the engine. A field whose .set() maps a label
 * to an int (e.g. "operator" -> 2) reached an INTEGER column as the string
 * "operator", the engine's type validator threw, and the whole batch fell back
 * to slow per-row inserts (correct data, but the "100x faster" optimization was
 * defeated and the log was noisy).
 *
 * Fix: insertManager exposes prepareInsertModel() — the exact clean/validate/
 * normalize/belongsTo pipeline runQueries uses — and the context batch path runs
 * every entity through it before building the bulk INSERT. Both paths now produce
 * identical column values. Entities carrying child-relationship data go through
 * the full single-insert path so their children are still inserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'batchset';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'batch-set');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.batchset.json'),
    JSON.stringify({ BatchCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

const ROLE_MAP = { operator: 2, administrator: 1 };

// Non-nullable INTEGER column with a label->int .set() — the reported shape.
class User {
    id(db) { db.integer().primary().auto(); }
    role(db) { db.integer().notNullable(); db.set(v => (typeof v === 'string' ? ROLE_MAP[v] : v)); }
}
class BatchCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(User); }
}

const freshCtx = () => {
    const c = new BatchCtx();
    c._SQLEngine.db.exec('DROP TABLE IF EXISTS User; CREATE TABLE User (id INTEGER PRIMARY KEY AUTOINCREMENT, role INTEGER NOT NULL);');
    return c;
};

// Capture a "[Context] Bulk insert failed, falling back" message without losing
// real errors. Returns a restore() and a fellBack() probe.
const watchFallback = () => {
    const original = console.error;
    let fellBack = false;
    console.error = (...m) => {
        if (/Bulk insert failed, falling back/i.test(String(m[0]))) { fellBack = true; }
        original(...m);
    };
    return { fellBack: () => fellBack, restore: () => { console.error = original; } };
};

// Seed an entity whose backing field holds the RAW (un-transformed) label.
// This faithfully simulates a construction path that did not run the .set()
// setter at assignment time (e.g. a re-inserted detached/loaded entity) — which
// is exactly when the raw value used to reach the engine on the batch path.
const seedRaw = (ctx, label) => {
    const e = ctx.User.new();
    Object.getPrototypeOf(e)._role = label;
    ctx.User.add(e);
    return e;
};

test('batch insert (>=2) applies .set() and uses the fast path (no fallback)', async () => {
    const ctx = freshCtx();
    seedRaw(ctx, 'operator');
    seedRaw(ctx, 'administrator');

    const w = watchFallback();
    await ctx.saveChanges();
    w.restore();

    const rows = ctx._SQLEngine.db.prepare('SELECT id, role FROM User ORDER BY id').all();
    assert.deepEqual(rows.map(r => r.role), [2, 1], '.set() must map labels to ints on the batch path');
    assert.equal(w.fellBack(), false, 'the fast batch path must handle it — no fallback to per-row inserts');
    await ctx.close();
});

test('single and batch inserts store identical values for a .set() field', async () => {
    // single
    let ctx = freshCtx();
    seedRaw(ctx, 'operator');
    await ctx.saveChanges();
    const single = ctx._SQLEngine.db.prepare('SELECT role FROM User').get().role;
    await ctx.close();

    // batch
    ctx = freshCtx();
    seedRaw(ctx, 'operator');
    seedRaw(ctx, 'administrator');
    await ctx.saveChanges();
    const batchFirst = ctx._SQLEngine.db.prepare('SELECT role FROM User ORDER BY id').get().role;
    await ctx.close();

    assert.equal(single, 2);
    assert.equal(batchFirst, single, 'batch path must produce the same column value as the single path');
});

test('prepareInsertModel applies .set() and returns a clean, set-once model', async () => {
    const { default: insertManager } = await import('../insertManager.js');
    const ctx = freshCtx();
    const entity = seedRaw(ctx, 'operator');

    const manager = new insertManager(ctx._SQLEngine, ctx._isModelValid, ctx.__entities);
    const clean = await manager.prepareInsertModel(entity);

    assert.equal(clean.role, 2, 'clean model must carry the .set()-transformed value');
    assert.ok(clean.__entity, 'clean model must carry its entity definition for the engine');
    await ctx.close();
});

test('_batchEntityHasChildren routes only entities with assigned child data', () => {
    const ctx = new BatchCtx();
    // Flat entity: no relationship keys assigned.
    const flat = { __entity: { id: { type: 'integer' }, role: { type: 'integer' } }, role: 2 };
    assert.equal(ctx._batchEntityHasChildren(flat), false);

    // Entity with an assigned hasMany child array.
    const withChildren = {
        __entity: { id: { type: 'integer' }, posts: { type: 'hasMany' } },
        posts: [{ title: 'a' }],
    };
    assert.equal(ctx._batchEntityHasChildren(withChildren), true);

    // hasOne relationship key present but unset (null) — treated as no children.
    const emptyRel = { __entity: { profile: { type: 'hasOne' } }, profile: null };
    assert.equal(ctx._batchEntityHasChildren(emptyRel), false);
});
