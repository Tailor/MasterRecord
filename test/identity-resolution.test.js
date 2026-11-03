/**
 * Identity resolution for tracked queries (EF Core's identity map).
 *
 * A tracked query that reads a row this context already tracks returns the
 * tracked instance, not a new copy. Without it a long-lived context (a
 * singleton polled every 30 s, say) kept a new tracked copy of every row on
 * every read, so its memory grew with the number of reads (measured: ~2.1 KB
 * per row read, +423 MB after 1,000 reads of 200 rows).
 *
 * EF semantics: the tracked instance is NOT overwritten with database values,
 * so pending changes on it survive a re-read. asNoTracking() is unchanged.
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

// Every identity-index entry points at an entity this context still tracks.
function assertIndexConsistent(ctx) {
    for (const [key, e] of ctx.__identityIndex) {
        assert.equal(ctx.__trackedEntitiesMap.get(e.__ID), e, `identity entry ${JSON.stringify(key)} is a tracked entity`);
    }
    assert.ok(ctx.__identityIndex.size <= ctx.__trackedEntitiesMap.size, 'index is never larger than the tracked set');
}

test('re-reading the same 200 rows 100 times on one context keeps 200 tracked entities', async () => {
    const { ctx } = await makeCtx({ rows: 200 });
    let first;
    for (let i = 0; i < 100; i++) {
        const list = await ctx.Item.toList();
        assert.equal(list.length, 200);
        if (i === 0) first = list;
        else assert.equal(list[17], first[17], 'same instance on every read');
    }
    assert.equal(ctx.__trackedEntitiesMap.size, 200, 'tracked set is bounded by distinct rows, not reads');
    assert.equal(ctx.__identityIndex.size, 200);
    assert.equal(new Set(first).size, 200, 'one instance per row');
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('the same instance comes back from different query shapes', async () => {
    const { ctx } = await makeCtx({ rows: 10 });
    const list = await ctx.Item.toList();
    const three = list.find(x => x.id === 3);
    assert.equal(await ctx.Item.findById(3), three, 'findById');
    assert.equal(await ctx.Item.find(3), three, 'find');
    assert.equal(await ctx.Item.where('i => i.name == $$', 'item-3').single(), three, 'where().single()');
    const page = await ctx.Item.orderByDescending('i => i.id').take(8).toList();
    assert.equal(page.find(x => x.id === 3), three, 'orderBy/take list');
    assert.equal(ctx.__trackedEntitiesMap.size, 10);
    await ctx.close();
});

test('a re-read does not overwrite a tracked entity: pending changes survive and are saved', async () => {
    const { ctx, db } = await makeCtx({ rows: 3 });
    const a = await ctx.Item.findById(1);
    a.name = 'pending';
    // Someone else changes the row in the database meanwhile.
    db.prepare('UPDATE Item SET name = ?, qty = ? WHERE id = 1').run('external', 999);

    const again = await ctx.Item.findById(1);
    assert.equal(again, a, 'tracked instance returned');
    assert.equal(again.name, 'pending', 'pending change kept');
    assert.equal(again.qty, 1, 'not refreshed from the database (EF identity resolution)');
    assert.equal(ctx.entry(a).state, 'modified');
    assert.equal(ctx.__dirtyEntities.size, 1);

    // asNoTracking still reads the database and never returns the tracked instance.
    const fresh = await ctx.Item.asNoTracking().findById(1);
    assert.notEqual(fresh, a);
    assert.equal(fresh.name, 'external');
    assert.equal(fresh.qty, 999);

    await ctx.saveChanges();
    const row = db.prepare('SELECT name, qty FROM Item WHERE id = 1').get();
    assert.equal(row.name, 'pending', 'the pending change was written');
    assert.equal(row.qty, 999, 'only the changed column was written');
    assertIndexConsistent(ctx);
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
    assert.equal(await ctx.Item.findById(2), a);
    assert.equal(ctx.__trackedEntitiesMap.size, 1, 'reload does not track a second copy');
    await ctx.close();
});

test('deletes: a re-read returns the tracked deleted instance; after save the row and its entry are gone', async () => {
    const { ctx, db } = await makeCtx({ rows: 3 });
    const items = await ctx.Item.orderBy('i => i.id').toList();
    const victim = items[0];
    ctx.Item.remove(victim);
    const again = await ctx.Item.orderBy('i => i.id').toList();
    assert.equal(again[0], victim);
    assert.equal(ctx.entry(victim).state, 'delete', 'still marked for delete');

    await ctx.saveChanges();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Item').get().n, 2);
    const after = await ctx.Item.orderBy('i => i.id').toList();
    assert.deepEqual(after.map(x => x.id), [2, 3]);
    assert.equal(after[0], items[1], 'surviving rows keep their instances');
    assert.equal(ctx.__trackedEntitiesMap.size, 2);
    assert.equal(ctx.__identityIndex.size, 2);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('inserts: auto keys are assigned (single and batch) and re-reads resolve to one instance per row', async () => {
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
    r1.forEach((x, i) => assert.equal(r2[i], x));
    assert.equal(ctx.__trackedEntitiesMap.size, 6);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('an edit through an older, detached instance wins over a clean tracked copy and the next read sees it', async () => {
    const { ctx } = await makeCtx();
    const a = new Item(); a.name = 'v1'; a.qty = 1;
    ctx.Item.add(a);
    await ctx.saveChanges();                       // inserted, then detached
    const copy = await ctx.Item.findById(a.id);    // a new tracked instance of the row
    assert.notEqual(copy, a);

    a.name = 'v2';                                 // re-tracks `a` with a pending change
    assert.equal(await ctx.Item.findById(a.id), a, 'the instance with pending changes is the one returned');
    await ctx.saveChanges();

    const after = await ctx.Item.findById(a.id);
    assert.equal(after.name, 'v2', 'the next read is not the stale clean copy');
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('composite keys: identity by the whole key; update and delete still address the right rows', async () => {
    const { ctx, db } = await makeCtx();
    const mk = (o, l, sku, qty) => { const x = new OrderLine(); x.orderId = o; x.lineNo = l; x.sku = sku; x.qty = qty; return x; };
    ctx.OrderLine.add(mk(1, 1, 'A', 10)); ctx.OrderLine.add(mk(1, 2, 'B', 20)); ctx.OrderLine.add(mk(2, 1, 'C', 30)); ctx.OrderLine.add(mk(2, 2, 'D', 40));
    await ctx.saveChanges();

    for (let i = 0; i < 50; i++) await ctx.OrderLine.toList();
    assert.equal(ctx.__trackedEntitiesMap.size, 4, '(1,2) and (2,1) are different rows; each tracked once');

    const l12 = await ctx.OrderLine.find(1, 2);
    assert.equal(l12.sku, 'B');
    assert.equal(await ctx.OrderLine.findById(1, 2), l12);
    assert.equal(await ctx.OrderLine.where('l => l.orderId == $$', 1).and('l => l.lineNo == $$', 2).single(), l12);
    assert.notEqual(await ctx.OrderLine.findById(2, 1), l12);

    l12.qty = 21;
    assert.equal((await ctx.OrderLine.findById(1, 2)).qty, 21, 'pending change kept on re-read');
    ctx.OrderLine.remove(await ctx.OrderLine.findById(2, 2));
    await ctx.saveChanges();

    assert.deepEqual(db.prepare('SELECT orderId, lineNo, qty FROM OrderLine ORDER BY orderId, lineNo').all().map(r => [r.orderId, r.lineNo, r.qty]),
        [[1, 1, 10], [1, 2, 21], [2, 1, 30]]);
    const rows = await ctx.OrderLine.toList();
    assert.equal(rows.length, 3);
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

test('a select() projection is not identity-resolved and never stands in for the whole entity', async () => {
    const { ctx } = await makeCtx({ rows: 3 });
    const projected = await ctx.Item.select('i => i.name').toList();
    assert.equal(projected.length, 3);
    const full = await ctx.Item.toList();
    assert.notEqual(full[0], projected[0]);
    assert.equal(full[0].qty, 1, 'full read has every column');
    assert.equal(await ctx.Item.findById(1), full[0]);
    assertIndexConsistent(ctx);
    await ctx.close();
});

test('include() on a resolved instance loads the navigation for this query', async () => {
    const { ctx, db } = await makeCtx();
    db.exec(`INSERT INTO Author (name) VALUES ('ann'); INSERT INTO Post (title, author_id) VALUES ('p1', 1), ('p2', 1);`);
    const p1 = await ctx.Post.asSplitQuery().include('p => p.author').where('p => p.id == $$', 1).single();
    assert.equal(p1.author.name, 'ann');
    const posts = await ctx.Post.asSplitQuery().include('p => p.author').orderBy('p => p.id').toList();
    assert.equal(posts[0], p1);
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
