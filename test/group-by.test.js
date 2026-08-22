/**
 * groupBy().aggregate() — Entity Framework Core GroupBy + Select(g => new { g.Key, g.Count(), g.Sum(...) }),
 * translated to GROUP BY / HAVING / ORDER BY SQL with where()/and(), global
 * query filters and take()/skip() applied.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';

process.env.master = 'development';

class Sale { id(db) { db.integer().primary().auto(); } status(db) { db.string(); } region(db) { db.string(); } amount(db) { db.float(); } archived(db) { db.boolean().default(false); } }

async function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-gb-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-gb-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        GbCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class GbCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Sale).queryFilter('live', 'o => o.archived == $$', false); }
    }
    const ctx = new GbCtx();
    const sch = new schemaCls(GbCtx); await sch._ensureReady();
    await sch.createTable(ctx.__entities.find(e => e.__name === 'Sale'));
    ctx._SQLEngine.db.exec(`INSERT INTO "Sale" (status, region, amount, archived) VALUES
        ('paid','eu',100,0), ('paid','eu',50,0), ('paid','us',25,0), ('open','eu',10,0), ('open','us',5,0), ('paid','eu',999,1)`);
    return ctx;
}

test('groupBy + aggregate: count/sum/avg/min/max per group, filters + where applied, having/orderBy/take', async () => {
    const ctx = await makeCtx();
    const byStatus = await ctx.Sale.groupBy('o => o.status').aggregate({ n: 'count', total: ['sum', 'amount'], avg: ['avg', 'amount'], lo: ['min', 'amount'], hi: ['max', 'amount'] });
    assert.deepEqual(byStatus, [
        { status: 'open', n: 2, total: 15, avg: 7.5, lo: 5, hi: 10 },
        { status: 'paid', n: 3, total: 175, avg: 58.333333333333336, lo: 25, hi: 100 },   // archived 999 excluded by the query filter
    ]);

    const eu = await ctx.Sale.where('o => o.region == $$', 'eu').groupBy('status', 'region').aggregate({ n: 'count', total: ['sum', 'amount'] });
    assert.deepEqual(eu, [{ status: 'open', region: 'eu', n: 1, total: 10 }, { status: 'paid', region: 'eu', n: 2, total: 150 }]);

    const big = await ctx.Sale.groupBy('o => o.region').aggregate({ n: 'count', total: ['sum', 'amount'] }, { having: { total: ['>', 100] }, orderBy: [['total', 'desc']] });
    assert.deepEqual(big, [{ region: 'eu', n: 3, total: 160 }]);

    const top1 = await ctx.Sale.groupBy('region').take(1).aggregate({ total: ['sum', 'amount'] }, { orderBy: [['total', 'desc']] });
    assert.deepEqual(top1, [{ region: 'eu', total: 160 }]);

    const all = await ctx.Sale.ignoreQueryFilters().groupBy('status').aggregate({ n: 'count' });
    assert.deepEqual(all, [{ status: 'open', n: 2 }, { status: 'paid', n: 4 }], 'ignoreQueryFilters() lifts the filter');

    // Misuse is loud
    assert.throws(() => ctx.Sale.groupBy('o => o.nope'), /is not a column of Sale/);
    await assert.rejects(() => ctx.Sale.aggregate({ n: 'count' }), /must follow groupBy\(\)/);
    await assert.rejects(() => ctx.Sale.groupBy('status').aggregate({ x: ['median', 'amount'] }), /unknown aggregate 'median'/);
    await assert.rejects(() => ctx.Sale.groupBy('status').aggregate({ n: 'count' }, { having: { zzz: ['>', 1] } }), /unknown aggregate 'zzz'/);
});
