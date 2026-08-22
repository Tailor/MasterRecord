/**
 * ContextPool (EF Core AddDbContextPool equivalent) + context.reset().
 *
 * A context is a unit of work scoped per request. Constructing one per request
 * is correct but pays connection setup each time; the pool keeps instances warm
 * and lends an exclusive, reset instance per request. reset() clears the unit of
 * work (tracked entities, dirty index, query cache) WITHOUT closing the
 * connection, so a pooled instance behaves like a fresh scoped context.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import ContextPool from '../ContextPool.js';

process.env.master = 'development';

class Row { id(db) { db.integer().primary().auto(); } val(db) { db.string(); } }

// One shared DB file so pooled instances reuse the same connection.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-pool-db-'));
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-pool-env-'));
fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
    AppContext: { env: 'development', connection: path.join(dbDir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
}));
class AppContext extends masterrecord.context {
    constructor() { super(); this.env(envDir); this.dbset(Row); }
}

async function ensureTable() {
    const c = new AppContext();
    await c._ensureReady();
    c._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
    // keep it open so the pooled connection stays warm for the test
    return c;
}

test('reset() clears the unit of work but keeps the connection usable', async () => {
    const ctx = await ensureTable();
    const r = new Row(); r.val = 'x'; ctx.Row.add(r);
    assert.equal(ctx.__dirtyEntities.size, 1);

    ctx.reset();                                   // drop the pending unit of work
    assert.equal(ctx.__dirtyEntities.size, 0, 'dirty index cleared');
    assert.equal(ctx.__trackedEntitiesMap.size, 0, 'tracked entities detached');

    // Connection still works: a query and a save both succeed after reset().
    const again = new Row(); again.val = 'after-reset'; ctx.Row.add(again);
    await ctx.saveChanges();
    assert.ok((await ctx.Row.toList()).some(x => x.val === 'after-reset'), 'connection is still usable after reset()');
    await ctx.close();
});

test('ContextPool.use() lends a reset instance and returns it; writes persist', async () => {
    const seed = await ensureTable();
    await seed.close();

    const pool = new ContextPool(AppContext, { maxSize: 8 });

    // "Request 1": insert.
    let id;
    await pool.use(async (db) => {
        const r = new Row(); r.val = 'from-pool'; db.Row.add(r);
        await db.saveChanges();
        id = r.id;
    });
    assert.equal(pool.rented, 0, 'instance returned to the pool');
    assert.ok(pool.size >= 1, 'a warm instance is retained for reuse');

    // "Request 2": a NEW rental must not see request 1's tracked entities
    // (reset on release), and its own write persists.
    await pool.use(async (db) => {
        assert.equal(db.__dirtyEntities.size, 0, 'rented instance starts with an empty unit of work');
        const found = (await db.Row.toList()).find(r => r.id === id);
        assert.equal(found.val, 'from-pool', 'request-1 write is visible');
        found.val = 'updated-in-request-2';
        await db.saveChanges();
    });

    await pool.use(async (db) => {
        assert.equal((await db.Row.toList()).find(r => r.id === id).val, 'updated-in-request-2');
    });

    await pool.drain();
    assert.equal(pool.size, 0, 'drain closes idle instances');
});

test('ContextPool.use() releases the instance even when the body throws', async () => {
    const pool = new ContextPool(AppContext, { maxSize: 4 });
    await assert.rejects(() => pool.use(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(pool.rented, 0, 'instance was released despite the error');
    await pool.drain();
});
