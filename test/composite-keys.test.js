/**
 * Composite primary keys — Entity Framework Core HasKey(a, b).
 *
 *  - Two (or more) `.primary()` columns -> table-level PRIMARY KEY (a, b) on all
 *    three engines (no inline PRIMARY KEY / auto-increment).
 *  - UPDATE / DELETE address the row by ALL key columns; bulk deletes of
 *    composite-key entities go per row.
 *  - find(a, b) / find({ a, b }) / findById(a, b), identity-map first; reload,
 *    entry().getDatabaseValues() use every key.
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

class OrderLine {
    orderId(db) { db.integer().primary(); }
    lineNo(db) { db.integer().primary(); }
    sku(db) { db.string(); }
    qty(db) { db.integer(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ck-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ck-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        CkCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class CkCtx extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(OrderLine); } }
    return { CkCtx, ctx: new CkCtx() };
}
const entityDef = (ctx, name) => ctx.__entities.find(e => e && e.__name === name);

test('DDL: table-level PRIMARY KEY (orderId, lineNo), NOT NULL key columns, no inline PK/autoincrement; auto on a composite key is rejected', () => {
    const { ctx } = makeCtx();
    const def = entityDef(ctx, 'OrderLine');
    const sqlite = new SQLiteQuery().createTable(def);
    assert.match(sqlite, /PRIMARY KEY \(orderId, lineNo\)/);
    assert.match(sqlite, /orderId INTEGER NOT NULL/); assert.match(sqlite, /lineNo INTEGER NOT NULL/);
    assert.equal((sqlite.match(/PRIMARY KEY/g) || []).length, 1, 'no inline PRIMARY KEY');
    assert.ok(!/AUTOINCREMENT/.test(sqlite));
    assert.match(new MySQLQuery().createTable(def), /PRIMARY KEY \(`orderId`, `lineNo`\)/);
    const pg = new PostgresQuery().createTable(def);
    assert.match(pg, /PRIMARY KEY \("orderId", "lineNo"\)/); assert.ok(!/SERIAL/.test(pg));
    const bad = { __name: 'Bad', a: { name: 'a', type: 'integer', primary: true, auto: true, nullable: false }, b: { name: 'b', type: 'integer', primary: true, nullable: false } };
    assert.throws(() => new SQLiteQuery().createTable(bad), /cannot include the auto-increment column 'a'/);
});

test('insert / find / update / delete / reload / getDatabaseValues address rows by the whole key; bulk delete per row', async () => {
    const { CkCtx, ctx } = makeCtx();
    const sch = new schemaCls(CkCtx); await sch._ensureReady();
    await sch.createTable(entityDef(ctx, 'OrderLine'));
    const db = ctx._SQLEngine.db;
    const mk = (o, l, sku, qty) => { const x = new OrderLine(); x.orderId = o; x.lineNo = l; x.sku = sku; x.qty = qty; return x; };
    ctx.OrderLine.add(mk(1, 1, 'A', 10)); ctx.OrderLine.add(mk(1, 2, 'B', 20)); ctx.OrderLine.add(mk(2, 1, 'C', 30)); ctx.OrderLine.add(mk(2, 2, 'D', 40));
    await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM OrderLine`).get().n, 4);
    // duplicate composite key rejected by the database
    ctx.OrderLine.add(mk(1, 1, 'dup', 1));
    await assert.rejects(() => ctx.saveChanges(), /UNIQUE constraint failed|PRIMARY KEY/);
    ctx.clearChangeTracker();

    const statements = [];
    ctx.on('command', c => { if (/^\s*(UPDATE|DELETE)/i.test(c.sql)) statements.push({ sql: c.sql.replace(/\s+/g, ' '), params: c.params }); });

    // find(a, b) — database, then identity map; object form too
    const l12 = await ctx.OrderLine.find(1, 2);
    assert.equal(l12.sku, 'B');
    assert.equal(await ctx.OrderLine.find({ orderId: 1, lineNo: 2 }), l12, 'identity map hit with object form');
    assert.equal((await ctx.OrderLine.findById(2, 1)).sku, 'C');
    await assert.rejects(() => ctx.OrderLine.find(1), /takes 2 key values \(orderId, lineNo\)/);

    // UPDATE only that row
    l12.qty = 21; await ctx.saveChanges();
    assert.match(statements.at(-1).sql, /UPDATE .* WHERE .*orderId.* AND .*lineNo/i);
    assert.deepEqual(db.prepare(`SELECT orderId, lineNo, qty FROM OrderLine ORDER BY orderId, lineNo`).all().map(r => r.qty), [10, 21, 30, 40]);

    // reload / getDatabaseValues use every key
    db.exec(`UPDATE OrderLine SET qty = 99 WHERE orderId = 1 AND lineNo = 2`);
    assert.equal((await ctx.entry(l12).getDatabaseValues()).qty, 99);
    await l12.reload(); assert.equal(l12.qty, 99);

    // single DELETE only that row; bulk delete of composite-key rows goes per row
    ctx.OrderLine.remove(l12); await ctx.saveChanges();
    assert.match(statements.at(-1).sql, /DELETE .* WHERE .*orderId.* AND .*lineNo/i);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM OrderLine`).get().n, 3);
    const rest = await ctx.OrderLine.where('r => r.orderId == $$', 2).toList();
    ctx.OrderLine.removeRange(rest); await ctx.saveChanges();
    assert.deepEqual(db.prepare(`SELECT orderId, lineNo FROM OrderLine`).all(), [{ orderId: 1, lineNo: 1 }]);
    assert.ok(statements.slice(-2).every(s => /DELETE .* WHERE .*orderId.* AND .*lineNo/i.test(s.sql)), 'per-row deletes with both keys');
});
