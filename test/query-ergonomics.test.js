/**
 * Query ergonomics (EF Core parity): Find (identity-map first), Entry/Entries/
 * HasChanges, Sum/Avg/Min/Max, ThenBy, Distinct, Any(predicate), DTO list,
 * pluck as a SQL projection, and loud NotSupported for join/groupBy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Item {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    cat(db) { db.string(); }
    price(db) { db.integer(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-erg-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-erg-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Item); } }
    return new testContext();
}
async function seed(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "cat" TEXT, "price" INTEGER)`);
    ctx._execute(`INSERT INTO "Item" ("name","cat","price") VALUES ('b','x',20),('a','x',10),('c','y',30),('d','y',30)`);
}

test('find() returns the tracked instance without a query; falls back to the database', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const sqls = []; ctx.on('command', c => sqls.push(c.sql));
    const loaded = await ctx.Item.where('i => i.name == $$', 'a').single();
    const before = sqls.length;
    const found = await ctx.Item.find(loaded.id);
    assert.equal(found, loaded, 'same tracked instance (identity map)');
    assert.equal(sqls.length, before, 'no SQL issued for an identity-map hit');
    const other = await ctx.Item.find(999);
    assert.equal(other, null);
    assert.ok(sqls.length > before, 'a miss queries the database');
});

test('entry(): state, original/current values, isModified, getDatabaseValues, detach; hasChanges(); entries()', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const it = await ctx.Item.where('i => i.name == $$', 'a').single();
    const e = ctx.entry(it);
    assert.equal(e.state, 'track');
    assert.equal(ctx.hasChanges(), false);
    it.price = 11;
    assert.equal(e.state, 'modified');
    assert.equal(e.isModified('price'), true);
    assert.equal(e.isModified('name'), false);
    assert.equal(e.originalValues.price, 10, 'original value as loaded');
    assert.equal(e.currentValues.price, 11, 'current value');
    assert.equal(ctx.hasChanges(), true);
    assert.equal(ctx.entries('Item').length, 1);

    ctx._execute(`UPDATE "Item" SET "price" = 99 WHERE "id" = ?`, [it.id]);   // someone else
    const dbv = await e.getDatabaseValues();
    assert.equal(dbv.price, 99, 'getDatabaseValues reads the live row without touching the entity');
    assert.equal(it.price, 11, 'entity untouched');

    e.state = 'track';                    // discard the pending change (EF: State = Unchanged)
    assert.equal(ctx.hasChanges(), false);
    e.state = 'modified';                 // EF Update(): all columns marked modified
    assert.ok(it.__dirtyFields.includes('name') && it.__dirtyFields.includes('price'));
    e.detach();
    assert.equal(e.state, 'detached');
    assert.equal(ctx.entries('Item').length, 0);
});

test('sum/avg/min/max aggregate over the (filtered) query; empty sets return 0 / null', async () => {
    const ctx = makeCtx(); await seed(ctx);
    assert.equal(await ctx.Item.sum('price'), 90);
    assert.equal(await ctx.Item.where('i => i.cat == $$', 'x').sum('price'), 30);
    assert.equal(await ctx.Item.avg('price'), 22.5);
    assert.equal(await ctx.Item.min('price'), 10);
    assert.equal(await ctx.Item.max('price'), 30);
    assert.equal(await ctx.Item.where('i => i.cat == $$', 'none').sum('price'), 0, 'sum of nothing is 0 (EF)');
    assert.equal(await ctx.Item.where('i => i.cat == $$', 'none').max('price'), null, 'max of nothing is null');
    await assert.rejects(() => ctx.Item.sum('nope'), /not a column/);
});

test('orderBy + thenBy / thenByDescending; distinct; any(predicate); toObjectList; pluck projects one column', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const rows = await ctx.Item.orderBy('i => i.cat').thenByDescending('i => i.price').thenBy('name').toList();
    assert.deepEqual(rows.map(r => r.name), ['b', 'a', 'c', 'd'], 'cat asc, then price desc, then name asc');

    const cats = await ctx.Item.select('i => i.cat').distinct().orderBy('i => i.cat').toList();
    assert.deepEqual(cats.map(r => r.cat), ['x', 'y'], 'DISTINCT applied');

    assert.equal(await ctx.Item.any('i => i.price > $$', 25), true);
    assert.equal(await ctx.Item.any('i => i.price > $$', 100), false);
    assert.equal(await ctx.Item.any(), true);

    const dtos = await ctx.Item.where('i => i.cat == $$', 'x').orderBy('i => i.name').toObjectList();
    assert.ok(dtos.every(d => Object.getPrototypeOf(d) === Object.prototype || !d.__context), 'plain objects');
    assert.deepEqual(dtos.map(d => d.name), ['a', 'b']);

    const sqls = []; ctx.on('command', c => sqls.push(c.sql));
    const names = await ctx.Item.orderBy('i => i.name').pluck('name');
    assert.deepEqual(names, ['a', 'b', 'c', 'd']);
    const sel = sqls.find(s => /^\s*SELECT/i.test(s));
    assert.ok(sel && !/price/.test(sel), `pluck selects only the plucked column: ${sel}`);
    assert.throws(() => ctx.Item.thenBy('nope'), /not a column/);
});

test('context.add / remove / addRange / removeRange (EF DbContext.Add/Remove) resolve the owning dbset', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const n = new Item(); n.name = 'z'; n.cat = 'z'; n.price = 1;
    ctx.add(n);                                   // by constructor name
    await ctx.saveChanges();
    assert.ok((await ctx.Item.asNoTracking().toList()).some(r => r.name === 'z'));
    const loaded = await ctx.Item.where('i => i.name == $$', 'z').single();
    ctx.remove(loaded);                            // by entity metadata
    await ctx.saveChanges();
    assert.ok(!(await ctx.Item.asNoTracking().toList()).some(r => r.name === 'z'));
    assert.throws(() => ctx.add({}), /cannot determine which registered entity/);
});

test('join() / groupBy() fail loudly instead of returning undefined', () => {
    const ctx = makeCtx();
    assert.throws(() => ctx.Item.join(), /not supported yet/);
    assert.throws(() => ctx.Item.groupBy(), /not supported yet/);
    assert.throws(() => ctx.Item.leftJoin(), /not supported yet/);
});
