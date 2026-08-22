/**
 * Explicit transactions on the context — EF Core Database.BeginTransaction /
 * Commit / Rollback / savepoints.
 *
 *  - transaction(fn): begin -> fn -> commit; rollback + rethrow if fn throws.
 *  - beginTransaction()/commit()/rollback() for manual control.
 *  - saveChanges() inside a user transaction does NOT commit on its own; it is
 *    protected by a SAVEPOINT, so a failed save leaves the outer transaction
 *    usable (EF semantics).
 *  - createSavepoint / rollbackToSavepoint / releaseSavepoint.
 *  - The transaction holds the engine lock, so another unit of work on the
 *    shared connection waits instead of interleaving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Item { id(db) { db.integer().primary().auto(); } val(db) { db.string(); } }

function makeCtxFactory() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-tx-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-tx-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Item); }
    }
    return () => new testContext();
}
async function prep(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
}
const count = async (ctx) => (await ctx.Item.asNoTracking().toList()).length;

test('transaction(fn) commits multiple saveChanges atomically', async () => {
    const make = makeCtxFactory(); const ctx = make(); await prep(ctx);
    const out = await ctx.transaction(async (tx) => {
        assert.equal(tx, ctx);
        assert.equal(ctx.inTransaction, true);
        const a = new Item(); a.val = 'a'; tx.Item.add(a); await tx.saveChanges();
        const b = new Item(); b.val = 'b'; tx.Item.add(b); await tx.saveChanges();
        return 'done';
    });
    assert.equal(out, 'done', 'transaction returns the body result');
    assert.equal(ctx.inTransaction, false);
    assert.equal(await count(ctx), 2);
});

test('transaction(fn) rolls back everything when the body throws (incl. already-saved changes)', async () => {
    const make = makeCtxFactory(); const ctx = make(); await prep(ctx);
    await assert.rejects(() => ctx.transaction(async (tx) => {
        const a = new Item(); a.val = 'a'; tx.Item.add(a); await tx.saveChanges();   // saved inside tx
        throw new Error('business rule failed');
    }), /business rule failed/);
    assert.equal(ctx.inTransaction, false, 'transaction closed');
    assert.equal(await count(ctx), 0, 'the saved row was rolled back with the transaction');
});

test('beginTransaction/commit and beginTransaction/rollback (manual control)', async () => {
    const make = makeCtxFactory(); const ctx = make(); await prep(ctx);

    await ctx.beginTransaction();
    const a = new Item(); a.val = 'a'; ctx.Item.add(a); await ctx.saveChanges();
    await ctx.execute(`INSERT INTO "Item" ("val") VALUES ('raw-in-tx')`);   // raw SQL joins the tx
    await ctx.commit();
    assert.equal(await count(ctx), 2);

    await ctx.beginTransaction();
    const b = new Item(); b.val = 'b'; ctx.Item.add(b); await ctx.saveChanges();
    await ctx.rollback();
    assert.equal(await count(ctx), 2, 'rolled-back save is gone');

    await assert.rejects(() => ctx.commit(), /no open transaction/);
    await assert.rejects(() => ctx.rollback(), /no open transaction/);
});

test('nested beginTransaction is rejected; savepoints provide nesting', async () => {
    const make = makeCtxFactory(); const ctx = make(); await prep(ctx);
    await ctx.beginTransaction();
    await assert.rejects(() => ctx.beginTransaction(), /already open/);

    const a = new Item(); a.val = 'keep'; ctx.Item.add(a); await ctx.saveChanges();
    await ctx.createSavepoint('beforeMore');
    const b = new Item(); b.val = 'discard'; ctx.Item.add(b); await ctx.saveChanges();
    await ctx.rollbackToSavepoint('beforeMore');         // undo only 'discard'
    await ctx.commit();

    const vals = (await ctx.Item.asNoTracking().toList()).map(i => i.val);
    assert.deepEqual(vals, ['keep'], 'work after the savepoint was undone, work before it committed');

    await assert.rejects(() => ctx.createSavepoint('bad name!'), /invalid savepoint name/);
    await assert.rejects(() => ctx.createSavepoint('x'), /requires an open transaction/);
});

test('a failed saveChanges inside a transaction leaves the transaction usable (savepoint)', async () => {
    const make = makeCtxFactory(); const ctx = make(); await prep(ctx);
    class Strict { id(db) { db.integer().primary().auto(); } name(db) { db.string().notNullable(); } }
    ctx.dbset(Strict);
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Strict" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL)`);

    await ctx.transaction(async (tx) => {
        const ok = new Item(); ok.val = 'ok'; tx.Item.add(ok); await tx.saveChanges();
        const bad = new Strict(); tx.Strict.add(bad);               // required field missing
        await assert.rejects(() => tx.saveChanges(), /required Field/);
        tx.detach(bad);
        // The outer transaction is still alive; more work commits normally.
        const more = new Item(); more.val = 'more'; tx.Item.add(more); await tx.saveChanges();
    });
    assert.deepEqual((await ctx.Item.asNoTracking().toList()).map(i => i.val), ['ok', 'more']);
});

test('a transaction holds the engine lock: a concurrent save on a sibling context waits, then lands', async () => {
    const make = makeCtxFactory(); const a = make(); await prep(a); const b = make(); await b._ensureReady();
    const order = [];
    const tx = a.transaction(async (t) => {
        order.push('tx-start');
        const x = new Item(); x.val = 'in-tx'; t.Item.add(x); await t.saveChanges();
        await new Promise(r => setTimeout(r, 40));
        order.push('tx-end');
    });
    // Started while the transaction is open -> must wait for it (no interleaving).
    const y = new Item(); y.val = 'sibling'; b.Item.add(y);
    const sib = b.saveChanges().then(() => order.push('sibling-saved'));
    await Promise.all([tx, sib]);
    assert.deepEqual(order, ['tx-start', 'tx-end', 'sibling-saved'], 'sibling save waited for the transaction');
    assert.equal(await count(a), 2);
});
