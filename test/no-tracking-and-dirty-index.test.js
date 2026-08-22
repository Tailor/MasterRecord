/**
 * Two EF-Core-style change-tracking mechanisms:
 *
 *  - asNoTracking(): read-only queries do not enter the change tracker, so a
 *    read-heavy endpoint retains nothing (fixes unbounded memory growth in a
 *    long-lived context).
 *  - dirty index: saveChanges() reads only the dirty entities, so a flush is
 *    O(changes) rather than O(total tracked), even with a huge tracked set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Row { id(db) { db.integer().primary().auto(); } val(db) { db.string(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-notrack-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-notrack-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Row); }
    }
    return new testContext();
}

async function seed(ctx, n) {
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
    for (let i = 0; i < n; i++) { const r = new Row(); r.val = 'v'; ctx.Row.add(r); }
    await ctx.saveChanges();
}

test('asNoTracking() retains nothing — a read-heavy query does not grow the tracked set', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 500);
    // Inserts were flushed and detached, so the tracker starts clean.
    const baseline = ctx.__trackedEntitiesMap.size;

    const rows = await ctx.Row.asNoTracking().toList();
    assert.equal(rows.length, 500, 'asNoTracking still returns the rows');
    assert.equal(ctx.__trackedEntitiesMap.size, baseline,
        'asNoTracking results are NOT added to the change tracker (no retention)');

    // Mutating a no-tracking entity does not enqueue a write (EF semantics).
    rows[0].val = 'changed-in-memory';
    assert.equal(ctx.__dirtyEntities.size, 0, 'a no-tracking mutation does not become a pending change');
    await ctx.saveChanges();
    const reloaded = (await ctx.Row.asNoTracking().toList()).find(r => r.id === rows[0].id);
    assert.equal(reloaded.val, 'v', 'no-tracking mutation is not persisted');
});

test('a normal query DOES track (so edits persist)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 5);

    const rows = await ctx.Row.toList();          // tracked
    assert.equal(ctx.__trackedEntitiesMap.size, 5, 'normal query tracks its results');
    rows[0].val = 'edited';
    assert.equal(ctx.__dirtyEntities.size, 1, 'mutation enqueues exactly one dirty entity');
    await ctx.saveChanges();
    assert.equal((await ctx.Row.toList()).find(r => r.id === rows[0].id).val, 'edited');
});

test('dirty index: a save is O(changes), not O(total tracked)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 2000);

    const rows = await ctx.Row.toList();          // 2000 tracked, all clean
    assert.equal(ctx.__trackedEntitiesMap.size, 2000);
    assert.equal(ctx.__dirtyEntities.size, 0, 'clean tracked rows are not in the dirty index');

    // Mutate just three.
    rows[0].val = 'a'; rows[1000].val = 'b'; rows[1999].val = 'c';
    assert.equal(ctx.__dirtyEntities.size, 3,
        'only the mutated rows are in the change set — not the other 1997');

    await ctx.saveChanges();
    // All three persisted; nothing dirty lingers; the 2000 stay tracked (identity map).
    const after = await ctx.Row.toList();
    assert.equal(after.find(r => r.id === rows[0].id).val, 'a');
    assert.equal(after.find(r => r.id === rows[1000].id).val, 'b');
    assert.equal(after.find(r => r.id === rows[1999].id).val, 'c');
    assert.equal(ctx.__dirtyEntities.size, 0, 'dirty index is empty after the flush');
});
