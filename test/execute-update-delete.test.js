/**
 * executeUpdate / executeDelete — EF Core's ExecuteUpdate / ExecuteDelete.
 *
 *  - One SQL statement over the rows the query selects; no loading, no
 *    change tracker; returns rows affected.
 *  - Setter values are parameterized; `sql\`col + 1\`` references existing
 *    values (EF SetProperty(b => b.X, b => b.X + 1)); interpolations in the
 *    tagged template are refused (injection-safe by construction).
 *  - Inside ctx.transaction() they join the transaction (rolled back with it).
 *  - The query cache for the table is invalidated.
 *  - bulkUpdate / bulkDelete are now set-based (no N+1 SELECTs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import { sql } from '../QueryLanguage/rawSql.js';

process.env.master = 'development';

class Blog {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    rating(db) { db.integer(); }
    views(db) { db.integer(); }
    hidden(db) { db.boolean(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-exec-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-exec-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Blog); }
    }
    return new testContext();
}
async function seed(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Blog" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "rating" INTEGER, "views" INTEGER, "hidden" INTEGER)`);
    for (const [t, r] of [['a', 1], ['b', 2], ['c', 5], ['d', 9]]) {
        const b = new Blog(); b.title = t; b.rating = r; b.views = 10; b.hidden = false; ctx.Blog.add(b);
    }
    await ctx.saveChanges();
}
const all = (ctx) => ctx.Blog.asNoTracking().orderBy('b => b.id').toList();

test('executeUpdate updates exactly the selected rows in one statement and returns rows affected', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const n = await ctx.Blog.where('b => b.rating < $$', 3).executeUpdate({ hidden: true, views: sql`views + 1` });
    assert.equal(n, 2, 'two rows have rating < 3');
    const rows = await all(ctx);
    assert.deepEqual(rows.map(r => [r.title, !!r.hidden, r.views]), [['a', true, 11], ['b', true, 11], ['c', false, 10], ['d', false, 10]]);
    assert.equal(ctx.__dirtyEntities.size, 0, 'nothing went through the change tracker');
});

test('executeUpdate with no where updates all rows; sql`` refuses interpolation; validates columns', async () => {
    const ctx = makeCtx(); await seed(ctx);
    assert.equal(await ctx.Blog.executeUpdate({ views: 0 }), 4);
    assert.ok((await all(ctx)).every(r => r.views === 0));
    const x = 5;
    assert.throws(() => sql`views + ${x}`, /does not accept interpolated values/);
    await assert.rejects(() => ctx.Blog.executeUpdate({ nope: 1 }), /not a column/);
    await assert.rejects(() => ctx.Blog.executeUpdate({ id: 99 }), /primary key/);
    await assert.rejects(() => ctx.Blog.executeUpdate({}), /non-empty object/);
});

test('executeDelete deletes exactly the selected rows and returns rows affected', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const n = await ctx.Blog.where('b => b.rating >= $$', 5).executeDelete();
    assert.equal(n, 2);
    assert.deepEqual((await all(ctx)).map(r => r.title), ['a', 'b']);
});

test('inside transaction(): execute ops join the transaction and roll back with it', async () => {
    const ctx = makeCtx(); await seed(ctx);
    await assert.rejects(() => ctx.transaction(async (tx) => {
        await tx.Blog.where('b => b.rating < $$', 3).executeDelete();
        assert.equal((await tx.Blog.toList()).length, 2, 'visible inside the transaction');
        throw new Error('abort');
    }), /abort/);
    assert.equal((await all(ctx)).length, 4, 'the delete was rolled back with the transaction');
});

test('execute ops invalidate the query cache for the table', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const before = await ctx.Blog.cache().toList();
    assert.equal(before.length, 4);
    await ctx.Blog.where('b => b.rating > $$', 1).executeDelete();
    const after = await ctx.Blog.cache().toList();
    assert.equal(after.length, 1, 'cached result was invalidated, not served stale');
});

test('bulkUpdate / bulkDelete are set-based (no per-row SELECT) and still fail loudly on a missing id', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const ids = (await all(ctx)).map(r => r.id);
    const eng = ctx._SQLEngine;
    const origPrepare = eng.db.prepare.bind(eng.db);
    const selects = [];
    eng.db.prepare = (s) => { if (/^\s*SELECT/i.test(s)) selects.push(s); return origPrepare(s); };
    try {
        await ctx.bulkUpdate('Blog', [{ id: ids[0], title: 'A!' }, { id: ids[1], title: 'B!' }]);
        const affected = await ctx.bulkDelete('Blog', [ids[2], ids[3]]);
        assert.equal(affected, 2, 'bulkDelete returns rows affected');
    } finally { eng.db.prepare = origPrepare; }
    assert.equal(selects.filter(s => /FROM\s+\[?Blog\]?|FROM\s+Blog/i.test(s)).length, 0, 'no SELECTs issued by bulkUpdate/bulkDelete');
    assert.deepEqual((await all(ctx)).map(r => r.title), ['A!', 'B!']);
    await assert.rejects(() => ctx.bulkUpdate('Blog', [{ id: 9999, title: 'x' }]), /not found/);
});
