/**
 * DDL modeling parity with Entity Framework Core:
 *   HasDefaultValueSql   -> db.defaultSql('CURRENT_TIMESTAMP')
 *   HasComputedColumnSql -> db.computed('CAST(price * 100 AS INTEGER)')   (GENERATED ALWAYS AS … STORED|VIRTUAL)
 *   HasCheckConstraint   -> db.check('qty >= 0', 'CK_Product_qty')
 *
 *  - All three engines' builders render the clauses (unit).
 *  - SQLite end-to-end: the default expression is applied by the DB, the
 *    computed column is derived, read back onto the entity after INSERT,
 *    never written on INSERT/UPDATE (even when every column is marked
 *    modified), recomputed on UPDATE; CHECK is enforced; schema sync sees
 *    the generated column (table_xinfo) and stays idempotent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';

process.env.master = 'development';

class Product {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    price(db) { db.float(); }
    qty(db) { db.integer().default(0).check('qty >= 0', 'CK_Product_qty'); }
    createdAt(db) { db.datetime().defaultSql('CURRENT_TIMESTAMP'); }
    priceCents(db) { db.integer().computed('CAST(ROUND(price * 100) AS INTEGER)'); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ddl-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ddl-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        DdlCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class DdlCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Product); }
    }
    return { DdlCtx, ctx: new DdlCtx() };
}
const entityDef = (ctx, name) => ctx.__entities.find(e => e && e.__name === name);

test('builders render DEFAULT <expr>, GENERATED ALWAYS AS (…) STORED|VIRTUAL and CHECK on all three engines', () => {
    const { ctx } = makeCtx();
    const def = entityDef(ctx, 'Product');

    const sqlite = new SQLiteQuery().createTable(def);
    assert.match(sqlite, /createdAt TEXT DEFAULT CURRENT_TIMESTAMP/);
    assert.match(sqlite, /priceCents INTEGER GENERATED ALWAYS AS \(CAST\(ROUND\(price \* 100\) AS INTEGER\)\) STORED/);
    assert.match(sqlite, /qty INTEGER DEFAULT 0 CONSTRAINT CK_Product_qty CHECK \(qty >= 0\)/);

    const mysql = new MySQLQuery().createTable(def);
    assert.match(mysql, /`createdAt` TEXT DEFAULT \(CURRENT_TIMESTAMP\)/, 'MySQL: expression defaults on TEXT must be parenthesized');
    assert.match(mysql, /`priceCents` INTEGER GENERATED ALWAYS AS \(CAST\(ROUND\(price \* 100\) AS INTEGER\)\) STORED/);
    assert.match(mysql, /`qty` INTEGER DEFAULT 0 CONSTRAINT `CK_Product_qty` CHECK \(qty >= 0\)/);

    const pg = new PostgresQuery().createTable(def);
    assert.match(pg, /"createdAt" TEXT DEFAULT CURRENT_TIMESTAMP/);
    assert.match(pg, /"priceCents" INTEGER GENERATED ALWAYS AS \(CAST\(ROUND\(price \* 100\) AS INTEGER\)\) STORED/);
    assert.match(pg, /"qty" INTEGER DEFAULT 0 CONSTRAINT "CK_Product_qty" CHECK \(qty >= 0\)/);

    // VIRTUAL where supported; Postgres supports STORED only. Non-literal
    // expressions are parenthesized in DEFAULT.
    const virt = { tableName: 'T', name: 'a', type: 'integer', nullable: true, computedSql: 'b + 1', computedStored: false };
    assert.match(new SQLiteQuery().addColum(virt), /GENERATED ALWAYS AS \(b \+ 1\) VIRTUAL/);
    assert.match(new MySQLQuery().addColum(virt), /GENERATED ALWAYS AS \(b \+ 1\) VIRTUAL/);
    assert.match(new PostgresQuery().addColum(virt), /GENERATED ALWAYS AS \(b \+ 1\) STORED/);
    const expr = { tableName: 'T', name: 'u', type: 'uuid', nullable: true, defaultSql: 'gen_random_uuid()' };
    assert.match(new PostgresQuery().addColum(expr), /DEFAULT \(gen_random_uuid\(\)\)/);
    assert.match(new PostgresQuery().alterColumn({ tableName: 'T', name: 'u', type: 'uuid', nullable: true, defaultSql: 'gen_random_uuid()' }), /SET DEFAULT \(gen_random_uuid\(\)\)/);

    // Contradictory modeling fails loudly, naming the column.
    assert.throws(() => new SQLiteQuery().addColum({ tableName: 'T', name: 'c', type: 'integer', computedSql: '1', default: 5 }), /column 'c' cannot have both computed\(\) and default\(\)/);
    assert.throws(() => new SQLiteQuery().addColum({ tableName: 'T', name: 'c', type: 'integer', computedSql: '1', primary: true }), /cannot be the primary key/);
});

test('SQLite end-to-end: DB default applied, computed column derived/read back/never written/recomputed, CHECK enforced, sync idempotent', async () => {
    const { DdlCtx, ctx } = makeCtx();
    const sch = new schemaCls(DdlCtx); await sch._ensureReady();
    await sch.createTable(entityDef(ctx, 'Product'));
    const db = ctx._SQLEngine.db;

    const statements = [];
    ctx.on('command', c => { if (/^\s*(INSERT|UPDATE)/i.test(c.sql)) statements.push(c.sql.replace(/\s+/g, ' ')); });

    const p = new Product(); p.name = 'Widget'; p.price = 19.99; p.qty = 3;
    ctx.Product.add(p);
    await ctx.saveChanges();
    assert.ok(!/priceCents/.test(statements.at(-1)), `INSERT must not write the computed column: ${statements.at(-1)}`);
    const row = db.prepare(`SELECT * FROM Product`).get();
    assert.ok(row.createdAt, 'defaultSql(CURRENT_TIMESTAMP) applied by the database');
    assert.equal(row.priceCents, 1999, 'computed column derived by the database');
    assert.equal(p.priceCents, 1999, 'computed value read back onto the entity after INSERT (EF fetches generated values)');
    assert.equal(p.createdAt, row.createdAt, 'DB default read back onto the entity too (EF reads generated values after SaveChanges)');

    // UPDATE: recomputed by the DB, never in the SET — even when EVERY column is marked modified.
    ctx.entry(p).state = 'modified';                  // no dirty fields yet -> marks all scalar columns (EF Update())
    p.price = 5;
    await ctx.saveChanges();
    const upd = statements.at(-1);
    assert.match(upd, /^\s*UPDATE/i);
    assert.match(upd, /\[createdAt\]/, 'a full Update() writes the other columns');
    assert.ok(!/priceCents/.test(upd), `UPDATE must not write the computed column: ${upd}`);
    const after1 = db.prepare(`SELECT priceCents, createdAt FROM Product`).get();
    assert.equal(after1.priceCents, 500);
    assert.equal(after1.createdAt, row.createdAt, 'the DB default value was preserved, not overwritten with NULL');
    const fresh = await ctx.Product.asNoTracking().where('x => x.name == $$', 'Widget').single();
    assert.equal(fresh.priceCents, 500, 'computed column is read like any other column');

    // CHECK constraint enforced by the database.
    const bad = new Product(); bad.name = 'neg'; bad.price = 1; bad.qty = -1;
    ctx.Product.add(bad);
    await assert.rejects(() => ctx.saveChanges(), /CHECK constraint failed/);
    ctx.clearChangeTracker();

    // Schema sync sees the generated column (table_xinfo) and is idempotent.
    const before = db.prepare(`PRAGMA table_xinfo(Product)`).all().map(c => c.name).sort();
    await sch.syncTable(entityDef(ctx, 'Product'));
    await sch.syncTable(entityDef(ctx, 'Product'));
    const after = db.prepare(`PRAGMA table_xinfo(Product)`).all().map(c => c.name).sort();
    assert.deepEqual(after, before);
    assert.ok(after.includes('priceCents'));
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Product`).get().n, 1, 'sync did not lose rows');
});
