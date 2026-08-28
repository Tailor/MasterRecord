/**
 * An entity named with a SQL reserved word must work end to end.
 *
 * `Order` is one of the most common entity names there is. Before 1.24.x the SQLite
 * DDL emitted `CREATE TABLE Order (...)` and the query builder emitted
 * `FROM Order AS ran`, both of which fail with `near "Order": syntax error` — so the
 * table could neither be created nor read. Every other table reference in the SQLite
 * engine was already bracket-quoted; CREATE/DROP/RENAME (1.24.0) and the FROM clause
 * (1.24.2) are now too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Order { id(db) { db.integer().primary().auto(); } total(db) { db.integer(); } }
class Group { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-reserved-'));
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-reserved-env-'));
fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
    testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
}));
class testContext extends masterrecord.context {
    constructor() { super(); this.env(envDir); this.dbset(Order); this.dbset(Group); }
}

test('reserved-word entities: create, insert, query, filter, update and delete', async () => {
    const ctx = new testContext();
    await ctx._ensureReady();

    // ensureCreated emits the DDL (quoted since 1.24.0)
    assert.equal(await ctx.database.ensureCreated(), true);
    const tables = ctx._SQLEngine.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    assert.ok(tables.includes('Order'), 'Order table created');
    assert.ok(tables.includes('Group'), 'Group table created');

    // insert
    const o = ctx.Order.new(); o.total = 100; ctx.Order.add(o);
    const o2 = ctx.Order.new(); o2.total = 250; ctx.Order.add(o2);
    const g = ctx.Group.new(); g.name = 'admins'; ctx.Group.add(g);
    await ctx.saveChanges();

    // read — this is the query path that used to throw
    const orders = await ctx.Order.toList();
    assert.equal(orders.length, 2, 'SELECT ... FROM [Order] works');
    assert.deepEqual(orders.map(r => r.total).sort((a, b) => a - b), [100, 250]);
    assert.equal((await ctx.Group.toList()).length, 1);

    // filtered read, ordering and single
    const big = await ctx.Order.where('o => o.total > $$', 200).toList();
    assert.equal(big.length, 1);
    assert.equal(big[0].total, 250);
    assert.equal(await ctx.Order.count(), 2);
    const found = await ctx.Order.find(orders[0].id);
    assert.ok(found, 'find() works on a reserved-word table');

    // update
    found.total = 999;
    await ctx.saveChanges();
    const fresh = new testContext();
    await fresh._ensureReady();
    assert.equal((await fresh.Order.find(orders[0].id)).total, 999, 'UPDATE [Order] works');

    // delete
    const doomed = await fresh.Order.find(orders[0].id);
    fresh.Order.remove(doomed);
    await fresh.saveChanges();
    assert.equal(await fresh.Order.count(), 1, 'DELETE FROM [Order] works');

    await ctx.close();
    await fresh.close();
});
