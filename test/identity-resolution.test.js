/**
 * Re-reads on a tracked context: current data, one clean copy per row.
 *
 * A tracked query returns the row as the database has it now, as a new object,
 * and releases the clean copy of that row the context already holds. So a read
 * sees writes made another way (executeUpdate, another context, another process),
 * and a long-lived context's memory follows its distinct rows, not its reads
 * (without this: ~2.1 KB per row read, +423 MB after 1,000 reads of 200 rows).
 *
 * 1.32.0 and 1.32.1 returned the tracked instance without refreshing it, so a read
 * after such a write answered with the old row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';

process.env.master = 'development';

class Item { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } qty(db) { db.integer(); } }
class OrderLine { orderId(db) { db.integer().primary(); } lineNo(db) { db.integer().primary(); } sku(db) { db.string(); } qty(db) { db.integer(); } }
class Author { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } posts(db) { db.hasMany('Post'); } }
class Post { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } author(db) { db.belongsTo('Author').nullable(); } }

let seq = 0;
async function makeCtx({ rows = 0 } = {}) {
    const name = `IdCtx${++seq}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-idr-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-idr-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        [name]: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    const Ctx = { [name]: class extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Item); this.dbset(OrderLine); this.dbset(Author); this.dbset(Post); }
    } }[name];
    const ctx = new Ctx();
    const sch = new schemaCls(Ctx); await sch._ensureReady();
    for (const n of ['Item', 'OrderLine', 'Author', 'Post']) await sch.createTable(ctx.__entities.find(e => e && e.__name === n));
    const db = ctx._SQLEngine.db;
    if (rows) {
        const ins = db.prepare('INSERT INTO Item (name, qty) VALUES (?, ?)');
        db.transaction(() => { for (let i = 1; i <= rows; i++) ins.run(`item-${i}`, i); })();
    }
    return { Ctx, ctx, db };
}

// Every index entry points at an entity this context still tracks.
function assertIndexConsistent(ctx) {
    for (const map of [ctx.__identityIndex, ctx.__identityCopies]) {
        for (const [key, e] of map) {
            assert.equal(ctx.__trackedEntitiesMap.get(e.__ID), e, `entry ${JSON.stringify(key)} is a tracked entity`);
        }
    }
    assert.ok(ctx.__identityIndex.size + ctx.__identityCopies.size <= ctx.__trackedEntitiesMap.size, 'the indexes are never larger than the tracked set');
}

test('re-reading the same 200 rows 100 times on one context keeps 200 tracked entities', async () => {
    const { ctx } = await makeCtx({ rows: 200 });
    let list;
    for (let i = 0; i < 100; i++) {
        list = await ctx.Item.toList();
        assert.equal(list.length, 200);
    }
    assert.equal(ctx.__trackedEntitiesMap.size, 200, 'tracked set is bounded by distinct rows, not reads');
    assert.equal(ctx.__identityIndex.size, 200);
    for (const e of list) assert.equal(ctx.__trackedEntitiesMap.get(e.__ID), e, 'the latest read is the tracked copy');
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('every query shape keeps one tracked copy per row', async () => {
    const { ctx } = await makeCtx({ rows: 10 });
    await ctx.Item.toList();
    assert.equal((await ctx.Item.findById(3)).name, 'item-3', 'findById');
    assert.equal((await ctx.Item.where('i => i.name == $$', 'item-3').single()).id, 3, 'where().single()');
    const page = await ctx.Item.orderByDescending('i => i.id').take(8).toList();
    assert.equal(page.length, 8, 'orderBy/take list');
    assert.equal(ctx.__trackedEntitiesMap.size, 10);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('a re-read sees a conditional executeUpdate on the same context', async () => {
    // The shape that broke on 1.32.0: UPDATE ... WHERE, then read the row to answer the caller.
    const { ctx } = await makeCtx({ rows: 3 });
    const before = await ctx.Item.findById(1);
    assert.equal(before.qty, 1);
    const n = await ctx.Item.where('i => i.id == $$', 1).and('i => i.qty == $$', 1).executeUpdate({ qty: 2 });
    assert.equal(n, 1);
    const after = await ctx.Item.findById(1);
    assert.equal(after.qty, 2, 'the read answers with the row as written');
    assert.equal((await ctx.Item.where('i => i.id == $$', 1).single()).qty, 2);
    assert.equal(before.qty, 1, 'an object read earlier keeps what it read');
    await ctx.close();
});

test('a re-read sees a write from another context and from outside', async () => {
    const { Ctx, ctx, db } = await makeCtx({ rows: 3 });
    assert.equal((await ctx.Item.findById(2)).name, 'item-2');

    const other = new Ctx();
    const theirs = await other.Item.findById(2);
    theirs.name = 'other-context';
    await other.saveChanges();
    assert.equal((await ctx.Item.findById(2)).name, 'other-context');

    db.prepare('UPDATE Item SET name = ? WHERE id = 2').run('outside');
    const [row] = (await ctx.Item.toList()).filter(x => x.id === 2);
    assert.equal(row.name, 'outside', 'a list read too');
    await other.close();
    await ctx.close();
});

test('an object read earlier can still be edited and saved after a re-read released it', async () => {
    const { ctx, db } = await makeCtx({ rows: 2 });
    const first = await ctx.Item.findById(1);
    const second = await ctx.Item.findById(1);
    assert.notEqual(second, first);
    first.name = 'edited-through-the-first';
    assert.equal(ctx.entry(first).state, 'modified');
    await ctx.saveChanges();
    assert.equal(db.prepare('SELECT name FROM Item WHERE id = 1').get().name, 'edited-through-the-first');
    assert.equal((await ctx.Item.findById(1)).name, 'edited-through-the-first');
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('a re-read leaves pending changes alone, answers with the database, and stays bounded', async () => {
    const { ctx, db } = await makeCtx({ rows: 3 });
    const a = await ctx.Item.findById(1);
    a.name = 'pending';
    // Someone else changes the row in the database meanwhile.
    db.prepare('UPDATE Item SET name = ?, qty = ? WHERE id = 1').run('external', 999);

    let again;
    for (let i = 0; i < 50; i++) again = await ctx.Item.findById(1);
    assert.notEqual(again, a, 'a query answers with the row, not the pending edit');
    assert.equal(again.name, 'external');
    assert.equal(again.qty, 999);
    assert.equal(a.name, 'pending', 'pending change kept');
    assert.equal(ctx.entry(a).state, 'modified');
    assert.equal(ctx.__dirtyEntities.size, 1);
    assert.equal(ctx.__trackedEntitiesMap.size, 2, 'the edited instance and one clean copy, however many reads');

    await ctx.saveChanges();
    const row = db.prepare('SELECT name, qty FROM Item WHERE id = 1').get();
    assert.equal(row.name, 'pending', 'the pending change was written');
    assert.equal(row.qty, 999, 'only the changed column was written');
    assertIndexConsistent(ctx);
    assert.equal((await ctx.Item.findById(1)).name, 'pending', 'the next read is not the stale clean copy');
    assert.equal(ctx.__trackedEntitiesMap.size, 1);
    await ctx.close();
});

test('reload() still reads the database values', async () => {
    const { ctx, db } = await makeCtx({ rows: 2 });
    const a = await ctx.Item.findById(2);
    db.prepare('UPDATE Item SET name = ? WHERE id = 2').run('changed');
    await a.reload();
    assert.equal(a.name, 'changed');
    a.name = 'mine';
    await ctx.entry(a).reload();
    assert.equal(a.name, 'changed', 'entry().reload() discards the pending change');
    assert.equal(ctx.__trackedEntitiesMap.size, 1, 'reload does not track a second copy');
    assert.equal(ctx.__trackedEntitiesMap.get(a.__ID), a, 'reload does not release the instance');
    await ctx.close();
});

test('deletes: a pending delete survives a re-read; after save the row and its entries are gone', async () => {
    const { ctx, db } = await makeCtx({ rows: 3 });
    const items = await ctx.Item.orderBy('i => i.id').toList();
    const victim = items[0];
    ctx.Item.remove(victim);
    const again = await ctx.Item.orderBy('i => i.id').toList();
    assert.equal(again[0].id, victim.id, 'the row is still there until the save');
    assert.equal(ctx.entry(victim).state, 'delete', 'still marked for delete');

    await ctx.saveChanges();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Item').get().n, 2);
    const after = await ctx.Item.orderBy('i => i.id').toList();
    assert.deepEqual(after.map(x => x.id), [2, 3]);
    assert.equal(ctx.__trackedEntitiesMap.size, 2, 'no copy of the deleted row stays tracked');
    assert.equal(ctx.__identityIndex.size, 2);
    assert.equal(ctx.__identityCopies.size, 0);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('inserts: auto keys are assigned (single and batch) and re-reads keep one tracked copy per row', async () => {
    const { ctx, db } = await makeCtx();
    const one = new Item(); one.name = 'one'; one.qty = 1;
    ctx.Item.add(one);
    await ctx.saveChanges();
    assert.ok(one.id, 'key assigned by the single insert');

    const batch = [];
    for (let i = 0; i < 5; i++) { const x = new Item(); x.name = `b${i}`; x.qty = i; ctx.Item.add(x); batch.push(x); }
    await ctx.saveChanges();
    assert.ok(batch.every(x => x.id), 'keys assigned by the batch insert');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Item').get().n, 6);

    const r1 = await ctx.Item.toList();
    const r2 = await ctx.Item.toList();
    assert.equal(r1.length, 6);
    assert.deepEqual(r2.map(x => x.id), r1.map(x => x.id));
    assert.equal(ctx.__trackedEntitiesMap.size, 6);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('an edit through an older, detached instance is saved and the next read sees it', async () => {
    const { ctx } = await makeCtx();
    const a = new Item(); a.name = 'v1'; a.qty = 1;
    ctx.Item.add(a);
    await ctx.saveChanges();                       // inserted, then detached
    const copy = await ctx.Item.findById(a.id);    // a new tracked instance of the row
    assert.notEqual(copy, a);

    a.name = 'v2';                                 // re-tracks `a` with a pending change
    assert.equal((await ctx.Item.findById(a.id)).name, 'v1', 'not saved yet');
    await ctx.saveChanges();

    const after = await ctx.Item.findById(a.id);
    assert.equal(after.name, 'v2', 'the next read is not a stale clean copy');
    assert.equal(ctx.__trackedEntitiesMap.size, 1);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('composite keys: copies follow the whole key; update and delete still address the right rows', async () => {
    const { ctx, db } = await makeCtx();
    const mk = (o, l, sku, qty) => { const x = new OrderLine(); x.orderId = o; x.lineNo = l; x.sku = sku; x.qty = qty; return x; };
    ctx.OrderLine.add(mk(1, 1, 'A', 10)); ctx.OrderLine.add(mk(1, 2, 'B', 20)); ctx.OrderLine.add(mk(2, 1, 'C', 30)); ctx.OrderLine.add(mk(2, 2, 'D', 40));
    await ctx.saveChanges();

    for (let i = 0; i < 50; i++) await ctx.OrderLine.toList();
    assert.equal(ctx.__trackedEntitiesMap.size, 4, '(1,2) and (2,1) are different rows; each tracked once');

    const l12 = await ctx.OrderLine.findById(1, 2);
    assert.equal(l12.sku, 'B');
    assert.equal((await ctx.OrderLine.where('l => l.orderId == $$', 1).and('l => l.lineNo == $$', 2).single()).sku, 'B');
    assert.equal((await ctx.OrderLine.findById(2, 1)).sku, 'C');

    l12.qty = 21;
    assert.equal((await ctx.OrderLine.findById(1, 2)).qty, 20, 'a read answers with the row until the save');
    ctx.OrderLine.remove(await ctx.OrderLine.findById(2, 2));
    await ctx.saveChanges();

    assert.deepEqual(db.prepare('SELECT orderId, lineNo, qty FROM OrderLine ORDER BY orderId, lineNo').all().map(r => [r.orderId, r.lineNo, r.qty]),
        [[1, 1, 10], [1, 2, 21], [2, 1, 30]]);
    const rows = await ctx.OrderLine.toList();
    assert.equal(rows.length, 3);
    assert.equal(rows.find(r => r.orderId === 1 && r.lineNo === 2).qty, 21);
    assert.equal(ctx.__trackedEntitiesMap.size, 3);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('asNoTracking() is unchanged: new instances, database values, nothing tracked', async () => {
    const { ctx } = await makeCtx({ rows: 200 });
    const a = await ctx.Item.asNoTracking().toList();
    const b = await ctx.Item.asNoTracking().toList();
    assert.notEqual(a[0], b[0]);
    assert.equal(ctx.__trackedEntitiesMap.size, 0);
    assert.equal(ctx.__identityIndex.size, 0);

    const tracked = await ctx.Item.findById(1);
    tracked.name = 'pending';
    const nt = await ctx.Item.asNoTracking().findById(1);
    assert.notEqual(nt, tracked, 'asNoTracking never returns the tracked instance');
    assert.equal(nt.name, 'item-1');
    await ctx.close();
});

test('a select() projection does not replace the whole entity', async () => {
    const { ctx } = await makeCtx({ rows: 3 });
    const full = await ctx.Item.toList();
    await ctx.Item.select('i => i.name').toList();
    assert.equal(ctx.__trackedEntitiesMap.get(full[0].__ID), full[0], 'the whole entity is still the tracked copy');
    const again = await ctx.Item.toList();
    assert.equal(again[0].qty, 1, 'full read has every column');
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('include() loads the navigation on every read and keeps one tracked copy per row', async () => {
    const { ctx, db } = await makeCtx();
    db.exec(`INSERT INTO Author (name) VALUES ('ann'); INSERT INTO Post (title, author_id) VALUES ('p1', 1), ('p2', 1);`);
    const p1 = await ctx.Post.asSplitQuery().include('p => p.author').where('p => p.id == $$', 1).single();
    assert.equal(p1.author.name, 'ann');
    db.prepare('UPDATE Author SET name = ? WHERE id = 1').run('anne');
    const posts = await ctx.Post.asSplitQuery().include('p => p.author').orderBy('p => p.id').toList();
    assert.equal(posts[0].author.name, 'anne', 'the included row is current too');
    assert.equal(posts[0].author, posts[1].author, 'one Author instance for both posts');
    assert.equal(ctx.__trackedEntitiesMap.size, 3, '2 posts + 1 author');
    await ctx.close();
});

test('one-time warning when the tracked set reaches the threshold', async () => {
    const warnings = [];
    const capture = { debug() {}, info() {}, warn: (m) => warnings.push(String(m)), error() {} };
    masterrecord.configureLogging({ logger: capture });
    try {
        const { ctx } = await makeCtx({ rows: 200 });
        ctx.setTrackedEntityWarningThreshold(50);
        await ctx.Item.toList();
        const mine = () => warnings.filter(w => w.includes('is tracking'));
        assert.equal(mine().length, 1, 'warned once');
        assert.match(mine()[0], /asNoTracking\(\)/);
        assert.match(mine()[0], /clearChangeTracker\(\)/);
        assert.match(mine()[0], /per request/);
        ctx.clearChangeTracker();
        await ctx.Item.toList();
        assert.equal(mine().length, 1, 'not repeated on the same context');

        const { ctx: quiet } = await makeCtx({ rows: 200 });
        quiet.setTrackedEntityWarningThreshold(0);
        await quiet.Item.toList();
        assert.equal(mine().length, 1, '0 turns it off');

        const { ctx: dflt } = await makeCtx({ rows: 200 });
        await dflt.Item.toList();
        assert.equal(mine().length, 1, 'default threshold (10,000) not reached by 200 rows');

        process.env.MASTERRECORD_TRACKED_WARN_THRESHOLD = '100';
        try {
            const { ctx: env } = await makeCtx({ rows: 200 });
            await env.Item.toList();
            assert.equal(mine().length, 2, 'MASTERRECORD_TRACKED_WARN_THRESHOLD sets the default');
            await env.close();
        } finally {
            delete process.env.MASTERRECORD_TRACKED_WARN_THRESHOLD;
        }
        assert.throws(() => ctx.setTrackedEntityWarningThreshold(-1), /non-negative number/);
        await ctx.close(); await quiet.close(); await dflt.close();
    } finally {
        masterrecord.configureLogging({ logger: null });
    }
});
