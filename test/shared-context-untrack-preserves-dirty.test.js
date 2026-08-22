/**
 * A save must not untrack an entity that became dirty after the save snapshotted
 * the tracked list — the silent-lost-write bug on a shared/singleton context.
 *
 * Repro of the production failure: a context shared across requests keeps ONE
 * tracked-entity list, and queried rows are auto-tracked into it. saveChanges()
 * snapshots that whole list, writes the dirty rows, and untracks the snapshot.
 * If request A's save snapshots a row that request B loaded (clean), B mutates
 * it while A's save is in flight, and A then untracks the snapshot, B's row is
 * dropped from tracking — so B's own saveChanges() finds nothing tracked and the
 * UPDATE is never issued (observed as an admin plan change round-tripping back to
 * `free`). The tracked batch wasn't empty, so the "no tracked entities" warning
 * never fired and the handler returned success.
 *
 * Fix: __untrack() drops only CLEAN ('track') entities; an entity that is dirty
 * at untrack time is preserved so its pending write still lands.
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-shared-untrack-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-shared-untrack-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Widget); }
    }
    return new testContext();
}

test('a concurrent save does not sweep away an entity mutated mid-save; its write still lands', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Widget" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    // Seed one row.
    const seed = new Widget(); seed.label = 'orig'; ctx.Widget.add(seed);
    await ctx.saveChanges();

    // "Request B" loads the row — it is auto-tracked, clean.
    const rowB = (await ctx.Widget.toList())[0];
    assert.equal(rowB.label, 'orig');
    assert.ok(ctx.__trackedEntitiesMap.has(rowB.__ID), 'queried row is tracked');

    // "Request A" begins a save: it snapshots the shared tracked list (which
    // includes B's clean row), writes its own dirty rows, then untracks the
    // snapshot. Reproduce that snapshot-then-untrack around B's mutation.
    const aSnapshot = ctx.__trackedEntities.slice();       // A snapshots (rowB clean here)

    rowB.label = 'updated-by-B';                           // B mutates mid-save -> dirty

    ctx.__untrack(aSnapshot);                              // A finishes and untracks its snapshot

    // The fix: B's now-dirty row must NOT have been swept out.
    assert.ok(ctx.__trackedEntitiesMap.has(rowB.__ID),
        "B's row was mutated after the snapshot and must remain tracked");

    // B saves — the UPDATE must actually be issued.
    await ctx.saveChanges();
    const after = (await ctx.Widget.toList())[0];
    assert.equal(after.label, 'updated-by-B', "B's write must persist (not silently dropped)");
});

test('clean entities are still untracked by a save (no unbounded growth)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Widget" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);
    const seed = new Widget(); seed.label = 'x'; ctx.Widget.add(seed);
    await ctx.saveChanges();

    const row = (await ctx.Widget.toList())[0];            // clean, tracked
    assert.ok(ctx.__trackedEntitiesMap.has(row.__ID));
    ctx.__untrack(ctx.__trackedEntities.slice());          // a save with this clean row in its batch
    assert.ok(!ctx.__trackedEntitiesMap.has(row.__ID),
        'a clean (unmodified) entity is released on untrack, so the tracked list does not grow unbounded');
});
