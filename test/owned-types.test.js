/**
 * Owned / complex types stored as JSON — Entity Framework Core
 * OwnsOne(e => e.Address, b => b.ToJson()) / ComplexProperty.
 *
 *  - db.owned(Address): serialized on write, parsed + hydrated into the class on read.
 *  - db.owned(): plain object / array.
 *  - Nested mutations are detected at saveChanges() (EF DetectChanges on
 *    complex properties); whole-value replacement and null work too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';

process.env.master = 'development';

class Address { constructor() { this.street = null; this.city = null; } label() { return `${this.street}, ${this.city}`; } }
class Customer {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    address(db) { db.owned(Address); }
    prefs(db) { db.owned().nullable(); }
}

async function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-own-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-own-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        OwnCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class OwnCtx extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Customer); } }
    const ctx = new OwnCtx();
    const sch = new schemaCls(OwnCtx); await sch._ensureReady();
    await sch.createTable(ctx.__entities.find(e => e.__name === 'Customer'));
    return ctx;
}

test('owned(Class) and owned(): JSON column, hydrated class on read, nested mutation detected, replace and null', async () => {
    const ctx = await makeCtx();
    const def = ctx.__entities.find(e => e.__name === 'Customer');
    assert.equal(def.address.type, 'json'); assert.equal(def.address.owned, true); assert.equal(def.address.ownedType, Address);
    assert.match(new SQLiteQuery().createTable(def), /address TEXT/);
    const db = ctx._SQLEngine.db;

    const c = new Customer(); c.name = 'ann';
    c.address = Object.assign(new Address(), { street: '1 Main', city: 'Oslo' });
    c.prefs = { theme: 'dark', tags: ['a', 'b'] };
    ctx.Customer.add(c); await ctx.saveChanges();
    const raw = db.prepare(`SELECT address, prefs FROM Customer`).get();
    assert.deepEqual(JSON.parse(raw.address), { street: '1 Main', city: 'Oslo' }, 'serialized as JSON');
    assert.deepEqual(JSON.parse(raw.prefs), { theme: 'dark', tags: ['a', 'b'] });

    const loaded = await ctx.Customer.where('x => x.name == $$', 'ann').single();
    assert.ok(loaded.address instanceof Address, 'hydrated into the owned class');
    assert.equal(loaded.address.label(), '1 Main, Oslo');
    assert.deepEqual(loaded.prefs, { theme: 'dark', tags: ['a', 'b'] });

    // Nested mutation: no setter touched — detected at saveChanges (EF DetectChanges)
    loaded.address.city = 'Paris';
    loaded.prefs.tags.push('c');
    assert.equal(ctx.hasChanges(), false, 'not visible until DetectChanges runs at save');
    await ctx.saveChanges();
    const after = db.prepare(`SELECT address, prefs FROM Customer`).get();
    assert.equal(JSON.parse(after.address).city, 'Paris');
    assert.deepEqual(JSON.parse(after.prefs).tags, ['a', 'b', 'c']);

    // No change -> no UPDATE
    const statements = [];
    ctx.on('command', x => { if (/^\s*UPDATE/i.test(x.sql)) statements.push(x.sql); });
    await ctx.saveChanges();
    assert.equal(statements.length, 0, 'unchanged owned values do not produce writes');

    // Replace whole value and set null
    loaded.address = Object.assign(new Address(), { street: '9 Side', city: 'Rome' });
    loaded.prefs = null;
    await ctx.saveChanges();
    const fin = db.prepare(`SELECT address, prefs FROM Customer`).get();
    assert.equal(JSON.parse(fin.address).city, 'Rome'); assert.equal(fin.prefs, null);
    const again = await ctx.Customer.asNoTracking().where('x => x.name == $$', 'ann').single();
    assert.ok(again.address instanceof Address); assert.equal(again.prefs, null);

    assert.throws(() => { class Bad { x(db) { db.owned('nope'); } } ctx.dbset(Bad); }, /owned\(Class\) expects a class/);
});
