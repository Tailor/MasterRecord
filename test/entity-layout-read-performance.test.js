/**
 * 1.23.0 — entity memory layout: every entity of a type shares ONE prototype and
 * keeps its backing slots (`_<col>`, `_<nav>`, `__loading_<nav>`) as NON-ENUMERABLE
 * OWN properties. Before, each row got a fresh `{}` prototype holding its slots, so
 * every entity had its own V8 hidden class and `entity.col` was a megamorphic
 * accessor read (~300 ns — an O(n²) loop over two 2k-row tables took minutes).
 * EF Core entities are POCOs: a property read must cost about what a plain
 * object read costs. Public shape (keys / JSON / spread / clean-model writes)
 * is unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import tools from '../Tools.js';

process.env.master = 'development';

class Tenant {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    plan(db) { db.string(); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-layout-'));
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-layout-env-'));
fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
    testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
}));
class testContext extends masterrecord.context {
    constructor() { super(); this.env(envDir); this.dbset(Tenant); }
}

test('tools.slotOwner/getSlot/setSlot/hasSlot/deleteSlot: non-enumerable own slots, owner resolved through __self', () => {
    const entity = {};
    Object.defineProperty(entity, '__self', { value: entity, enumerable: false });
    const clean = Object.create(entity);                 // what the engines build
    tools.setSlot(clean, '_x', 1);                       // write through a derived object lands on the OWNER
    assert.equal(Object.prototype.hasOwnProperty.call(entity, '_x'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(clean, '_x'), false);
    assert.equal(Object.keys(entity).length, 0, 'slots are not enumerable');
    assert.equal(tools.getSlot(clean, '_x'), 1);
    assert.equal(tools.hasSlot(clean, '_x'), true);
    tools.deleteSlot(clean, '_x');
    assert.equal(tools.hasSlot(entity, '_x'), false);
    assert.equal(tools.slotOwner(null), null);
});

test('query-built entities share one prototype, expose only columns as enumerable keys, and stay JSON/spread-friendly', async () => {
    const ctx = new testContext();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Tenant" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "plan" TEXT)`);
    for (let i = 0; i < 50; i++) { const t = new Tenant(); t.name = 't' + i; t.plan = i % 2 ? 'pro' : 'free'; ctx.Tenant.add(t); }
    await ctx.saveChanges();

    const fresh = new testContext();
    await fresh._ensureReady();
    const list = await fresh.Tenant.toList();
    assert.equal(list.length, 50);
    const protos = new Set(list.map(e => Object.getPrototypeOf(e)));
    assert.equal(protos.size, 1, 'all entities of a type share ONE prototype (monomorphic hidden class)');
    assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'name', 'plan'], 'only columns are enumerable');
    assert.equal(Object.prototype.hasOwnProperty.call(list[0], '_name'), true, 'backing slot is an own property');
    assert.equal(Object.getOwnPropertyDescriptor(list[0], '_name').enumerable, false);
    assert.deepEqual(JSON.parse(JSON.stringify(list[0])), { id: list[0].id, name: 't0', plan: 'free' });
    assert.deepEqual({ ...list[0] }, { id: list[0].id, name: 't0', plan: 'free' });

    // a derived clean model (engine idiom) reads through the chain and writes to the owner
    const clean = Object.create(list[1]);
    assert.equal(clean.name, 't1');
    clean.name = 'renamed';
    assert.equal(list[1].name, 'renamed', 'write through the clean model updates the entity');
    assert.equal(Object.prototype.hasOwnProperty.call(clean, '_name'), false, 'no shadowing slot on the derived object');

    // .new() entities use the same layout
    const n = fresh.Tenant.new(); n.name = 'x';
    assert.equal(Object.prototype.hasOwnProperty.call(n, '_name'), true);
    assert.deepEqual(Object.keys(n).sort(), ['id', 'name', 'plan']);
});

test('property reads on tracked entities are cheap (guard against the per-row-prototype regression)', async () => {
    const ctx = new testContext();
    await ctx._ensureReady();
    const list = await ctx.Tenant.toList();
    assert.ok(list.length >= 50);
    // warm up, then measure 2M reads; the old layout measured ~300 ns/read, the new one ~20 ns.
    let s = 0;
    for (let k = 0; k < 200; k++) for (const e of list) s += e.name.length;
    const t0 = process.hrtime.bigint();
    const R = Math.ceil(2_000_000 / list.length);
    for (let k = 0; k < R; k++) for (const e of list) s += e.name.length;
    const nsPerRead = Number(process.hrtime.bigint() - t0) / (R * list.length);
    assert.ok(s > 0);
    assert.ok(nsPerRead < 150, `entity property read costs ${nsPerRead.toFixed(1)} ns (expected well under 150 ns)`);
});
