/**
 * Table-per-hierarchy inheritance — Entity Framework Core's default mapping.
 *
 *  - dbset(Cat, { extends: Animal }) maps Cat onto the Animal table; the table
 *    gains a 'discriminator' column (values = model names) and the derived
 *    columns (nullable).
 *  - ctx.Cat / ctx.Dog query with the discriminator predicate (always applied,
 *    even with ignoreQueryFilters()); inserts stamp the discriminator.
 *  - ctx.Animal returns every row, each materialized as its derived type.
 *  - Migrations see a single table; base query filters apply to derived sets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import Migration from '../Migrations/migrations.js';

process.env.master = 'development';

class Animal { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } archived(db) { db.boolean().default(false); } }
class Cat extends Animal { lives(db) { db.integer(); } }
class Dog extends Animal { barks(db) { db.boolean(); } }

function makeCtx({ filter = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-tph-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-tph-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        TphCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class TphCtx extends masterrecord.context {
        constructor() {
            super(); this.env(envDir);
            const base = this.dbset(Animal);
            if (filter) base.queryFilter('notArchived', 'a => a.archived == $$', false);
            this.dbset(Cat, { extends: Animal });
            this.dbset(Dog, { extends: Animal });
        }
    }
    return { TphCtx, ctx: new TphCtx(), envDir };
}
const entityDef = (ctx, name) => ctx.__entities.find(e => e && e.__name === name);

test('model: one table with discriminator + derived columns; derived sets exist; migrations see a single table; misuse rejected', () => {
    const { ctx, envDir } = makeCtx();
    assert.deepEqual(ctx.__entities.map(e => e.__name), ['Animal'], 'derived types are not separate tables');
    const animal = entityDef(ctx, 'Animal');
    assert.equal(animal.discriminator.type, 'string'); assert.equal(animal.discriminator.nullable, false); assert.equal(animal.discriminator.default, 'Animal');
    assert.equal(animal.lives.nullable, true, 'derived column lives in the base table, nullable');
    assert.equal(animal.barks.nullable, true);
    const ddl = new SQLiteQuery().createTable(animal);
    assert.match(ddl, /discriminator TEXT NOT NULL DEFAULT 'Animal'/);
    assert.match(ddl, /lives INTEGER/); assert.match(ddl, /barks INTEGER/);
    assert.ok(ctx.Cat && ctx.Dog && typeof ctx.Cat.toList === 'function');
    assert.equal(ctx.Cat.__entity.__name, 'Animal', 'derived set queries the base table');
    assert.equal(ctx.Cat.__entity.__tph.value, 'Cat');
    assert.equal(new Migration().cleanEntities(ctx.__entities).length, 1);

    class Orphan extends Animal { x(db) { db.string(); } }
    class BadPk extends Animal { key(db) { db.integer().primary(); } }
    const c = ctx;
    assert.throws(() => c.dbset(BadPk, { extends: Animal }), /cannot declare its own primary key/);
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        TphCtx: { env: 'development', connection: path.join(envDir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
        Lonely: { env: 'development', connection: path.join(envDir, 'db2.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class Lonely extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Orphan, { extends: 'Nope' }); } }
    assert.throws(() => new Lonely(), /register the base entity with dbset\(\) first/);
});

test('insert/query/update/delete through derived sets; base set materializes derived types; discriminator predicate survives ignoreQueryFilters', async () => {
    const { TphCtx, ctx } = makeCtx({ filter: true });
    const sch = new schemaCls(TphCtx); await sch._ensureReady();
    await sch.createTable(entityDef(ctx, 'Animal'));
    const db = ctx._SQLEngine.db;

    const tom = new Cat(); tom.name = 'tom'; tom.lives = 9; ctx.Cat.add(tom);
    const rex = new Dog(); rex.name = 'rex'; rex.barks = true; ctx.Dog.add(rex);
    const gen = new Animal(); gen.name = 'generic'; ctx.Animal.add(gen);
    const kit = ctx.Cat.new(); kit.name = 'kit'; kit.lives = 7;           // .new() on a derived set
    await ctx.saveChanges();
    assert.deepEqual(db.prepare(`SELECT name, discriminator, lives, barks FROM Animal ORDER BY name`).all(), [
        { name: 'generic', discriminator: 'Animal', lives: null, barks: null },
        { name: 'kit', discriminator: 'Cat', lives: 7, barks: null },
        { name: 'rex', discriminator: 'Dog', lives: null, barks: 1 },
        { name: 'tom', discriminator: 'Cat', lives: 9, barks: null },
    ]);

    const cats = await ctx.Cat.orderBy('c => c.name').toList();
    assert.deepEqual(cats.map(c => c.name), ['kit', 'tom'], 'derived set is filtered by discriminator');
    assert.equal(await ctx.Dog.count(), 1);
    assert.equal((await ctx.Cat.ignoreQueryFilters().toList()).length, 2, 'ignoreQueryFilters() never removes the discriminator predicate');

    const all = await ctx.Animal.orderBy('a => a.name').toList();
    assert.equal(all.length, 4, 'base set returns the whole hierarchy');
    const byName = Object.fromEntries(all.map(a => [a.name, a]));
    assert.equal(byName.tom.__entity.__tph.value, 'Cat', 'materialized as Cat');
    assert.equal(byName.tom.lives, 9);
    assert.equal(byName.rex.__entity.__tph.value, 'Dog');
    assert.equal(byName.generic.__entity.__tph.isDerived, false, 'plain base row stays Animal');

    // Update through the derived set persists (same table)
    const tomE = await ctx.Cat.where('c => c.name == $$', 'tom').single();
    tomE.lives = 8; await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT lives FROM Animal WHERE name = 'tom'`).get().lives, 8);
    // A Cat materialized from the base set updates as a Cat too
    byName.kit.lives = 6; await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT lives FROM Animal WHERE name = 'kit'`).get().lives, 6);

    // Base-type query filter applies to derived sets (EF)
    db.exec(`UPDATE Animal SET archived = 1 WHERE name = 'kit'`);
    assert.deepEqual((await ctx.Cat.toList()).map(c => c.name), ['tom'], 'archived cat hidden by the base filter');
    assert.equal((await ctx.Cat.ignoreQueryFilters().toList()).length, 2);

    // Set-based delete through the derived set touches only that type
    await ctx.Dog.where('d => d.barks == $$', true).executeDelete();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Animal`).get().n, 3);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Animal WHERE discriminator = 'Dog'`).get().n, 0);
});
