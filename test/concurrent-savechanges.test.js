/**
 * Concurrent saveChanges() calls must serialize, and each call must clear
 * only its own batch.
 *
 * Before 1.5.4 two overlapping calls shared the engine's single transaction
 * client: the first COMMIT/ROLLBACK ended both batches, later statements fell
 * through to autocommit on random pooled connections, and an aborted sibling
 * transaction could take down rows whose ids other rows already referenced
 * (observed in production as vanished parents with orphaned children).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import masterrecord from '../MasterRecord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-concurrent-'));

class Item {
    id(db) { db.integer().primary().auto(); }
    label(db) { db.string(); }
}

function makeContext() {
    const envDir = path.join(TMP, 'environments');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(TMP, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Item);
        }
    }
    return new testContext();
}

test('overlapping saveChanges calls all persist their own batches', async () => {
    const ctx = makeContext();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    // Fire N interleaved add+save pairs WITHOUT awaiting between them — the
    // exact overlap that used to cross-wire transactions.
    const saves = [];
    for (let i = 0; i < 8; i++) {
        const e = new Item();
        e.label = `batch-${i}`;
        ctx.Item.add(e);
        saves.push(ctx.saveChanges());
    }
    const results = await Promise.all(saves);
    assert.ok(results.every(Boolean), 'every save reports success');

    // Nothing left tracked once the queue drains (checked before toList —
    // loading rows re-tracks them as clean entities, which is fine).
    assert.strictEqual(ctx.__trackedEntities.length, 0, 'tracking is empty after all saves');

    const rows = await ctx.Item.toList();
    const labels = rows.map(r => r.label).sort();
    assert.deepStrictEqual(labels, Array.from({ length: 8 }, (_, i) => `batch-${i}`).sort(),
        'every batch reached the database exactly once');
});

test('the save queue survives a no-op and keeps working afterwards', async () => {
    const ctx = makeContext();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    const before = (await ctx.Item.toList()).length;

    await ctx.saveChanges();   // nothing tracked — a no-op success
    const good = new Item();
    good.label = 'after-noop';
    ctx.Item.add(good);
    await ctx.saveChanges();

    const after = await ctx.Item.toList();
    assert.strictEqual(after.length, before + 1, 'later saves still work');
});
