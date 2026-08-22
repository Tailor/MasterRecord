/**
 * Change-tracking identity must be collision-free, and the tracked list must
 * always equal the identity map (single source of truth).
 *
 * Regression (write loss with monotonic decay in long-lived contexts): queried
 * entities were assigned a RANDOM __ID in [1,100000] (entityTrackerModel
 * buildObject). As a read-heavy singleton context's tracked set grew toward
 * tens of thousands, birthday-paradox collisions became frequent: a new entity
 * whose random __ID already existed hit __track's `if (!map.has(id))` dedup
 * guard, was never added to the tracked set, and its UPDATE was silently dropped
 * (saveChanges still returned true). A fresh process passed; the same process
 * degraded run over run as the set filled.
 *
 * Fix: every entity gets a process-unique sequential id (assigned in __track),
 * and the tracked list is a derived view over the map, so the two can never
 * desynchronise.
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ident-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ident-env-'));
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

test('queried entities get unique ids — no __ID collisions even in a large tracked set', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    const K = 3000;                                 // >> the old [1,100000] birthday threshold
    await seed(ctx, K);

    const rows = await ctx.Row.toList();            // K entities auto-tracked
    assert.equal(rows.length, K);

    // Every queried entity is the object its own __ID maps to (none dropped).
    const dropped = rows.filter(r => ctx.__trackedEntitiesMap.get(r.__ID) !== r);
    assert.equal(dropped.length, 0, 'no entity is dropped by an id collision');
    assert.equal(ctx.__trackedEntitiesMap.size, K, 'the map holds every distinct entity');

    // Single source of truth: the derived list exactly equals the map.
    assert.equal(ctx.__trackedEntities.length, ctx.__trackedEntitiesMap.size,
        'tracked list length equals map size');
    const ids = new Set(ctx.__trackedEntities.map(e => e.__ID));
    assert.equal(ids.size, ctx.__trackedEntitiesMap.size, 'no duplicate ids in the tracked set');
});

test('writes do not decay as the tracked set grows (no lost UPDATE)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    const K = 3000;
    await seed(ctx, K);

    // Repeated load -> mutate -> save. Each toList() re-tracks the whole table,
    // so the tracked set is large; every write must still persist.
    let lost = 0;
    for (let n = 0; n < 40; n++) {
        const id = (n % K) + 1;
        const row = (await ctx.Row.toList()).find(r => r.id === id);
        row.val = 'edit-' + n;
        await ctx.saveChanges();
        const got = (await ctx.Row.toList()).find(r => r.id === id).val;
        if (got !== 'edit-' + n) lost++;
    }
    assert.equal(lost, 0, 'no write is silently dropped regardless of tracked-set size');
});
