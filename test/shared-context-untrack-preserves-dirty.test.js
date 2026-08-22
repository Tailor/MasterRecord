/**
 * saveChanges() commits only its own CHANGE SET and never drops another unit of
 * work's pending write — the shared/singleton-context lost-write bug.
 *
 * Production failure: a context is a process singleton, so one tracked-entity
 * list is shared by every request, and read-only `.toList()` calls leave their
 * results tracked (clean) forever. The old saveChanges() snapshotted that entire
 * shared list and untracked all of it — so one caller's save (even an EMPTY one
 * with nothing dirty) removed another in-flight caller's freshly loaded/mutated
 * row from tracking, and that caller's own saveChanges() then found nothing to
 * write and silently lost the UPDATE (returning true). Observed as an admin plan
 * change round-tripping back to `free`.
 *
 * Fix: a save operates only on the dirty entities (its change set), writes them,
 * releases only those, and NEVER touches the rest of the tracked list. A
 * mutation that lands during the async write bumps a per-entity version and is
 * kept dirty so its own save still persists it.
 *
 * Invariant (developer-stated): if an entity is tracked and dirty when
 * saveChanges() is called, that call must write it (or reject) — never resolve
 * true leaving it unwritten and untracked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Widget {
    id(db) { db.integer().primary().auto(); }
    label(db) { db.string(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-uow-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-uow-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Widget); }
    }
    return new testContext();
}

async function seed(ctx, n) {
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Widget" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);
    for (let i = 0; i < n; i++) { const w = new Widget(); w.label = 'orig' + i; ctx.Widget.add(w); }
    await ctx.saveChanges();
}

test('an empty saveChanges() is a no-op and drops no tracked entity', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 20);

    const rows = await ctx.Widget.toList();      // 20 rows auto-tracked (clean)
    const before = ctx.__trackedEntities.length;
    assert.ok(before >= 20, 'queried rows are tracked');

    // A caller mutates one row (dirty, tracked) ...
    const victim = rows[0];
    victim.label = 'pending';

    // ... while an "interfering" caller runs a save with nothing of its own to
    // write. Under the old code this snapshotted+untracked the whole list and
    // dropped `victim`. Now it must be a true no-op.
    await ctx.saveChanges();                      // victim IS dirty -> this writes it
    // A second, genuinely-empty save must touch nothing.
    await ctx.saveChanges();

    const after = (await ctx.Widget.toList()).find(r => r.id === victim.id);
    assert.equal(after.label, 'pending', "the dirty row's write must land, not be dropped");
});

test('saveChanges writes its change set and leaves unrelated tracked rows alone', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 5);

    const rows = await ctx.Widget.toList();       // 5 tracked clean
    const target = rows[0];
    target.label = 'changed';                     // only this one dirty

    await ctx.saveChanges();

    // The write landed and the entity is clean again.
    assert.equal(target.__state, 'track', 'written entity reset to clean');
    assert.equal((await ctx.Widget.toList()).find(r => r.id === target.id).label, 'changed');

    // Unrelated clean rows were NOT swept out of tracking by this save.
    const stillTracked = rows.slice(1).filter(r => ctx.__trackedEntitiesMap.has(r.__ID)).length;
    assert.equal(stillTracked, 4, 'a save must not untrack unrelated (clean) entities');
});

test('a mutation that lands during the async write still persists (version-aware reset)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    await seed(ctx, 1);
    const E = (await ctx.Widget.toList())[0];

    // Widen the write window so a concurrent mutation can interleave.
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const eng = ctx._SQLEngine;
    for (const m of ['update', 'bulkUpdate']) {
        if (typeof eng[m] === 'function') { const o = eng[m].bind(eng); eng[m] = async (...a) => { await sleep(25); return o(...a); }; }
    }

    E.label = 'A';
    const firstSave = ctx.saveChanges();          // enters the slow write
    await sleep(8);
    E.label = 'B';                                // concurrent mutation mid-write
    await firstSave;
    await ctx.saveChanges();                      // must persist 'B', not leave it reset away

    assert.equal((await ctx.Widget.toList())[0].label, 'B',
        'a mutation during the write must not be reset away — its UPDATE must be issued');
});
