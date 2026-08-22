/**
 * Connection resiliency — EF Core EnableRetryOnFailure / execution strategy.
 *
 *  - Transient errors (busy/locked SQLite, deadlocks, dropped connections) are
 *    retried with backoff; non-transient errors are not.
 *  - Applies to queries, saveChanges() and execute ops; NOT inside an explicit
 *    transaction (EF: the transaction is the retry unit).
 *  - A 'retry' event fires before each wait.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import { isTransientError } from '../resilience.js';

process.env.master = 'development';

class Row { id(db) { db.integer().primary().auto(); } val(db) { db.string(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-retry-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-retry-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Row); } }
    return new testContext();
}
const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
async function prep(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
}
/** Make engine[method] fail `times` times with `err`, then behave normally. */
function failFirst(engine, method, times, err) {
    const orig = engine[method].bind(engine);
    let calls = 0;
    engine[method] = function (...a) { calls++; if (calls <= times) throw err(); return orig(...a); };
    return { calls: () => calls, restore: () => { engine[method] = orig; } };
}

test('classifier: transient vs non-transient per engine', () => {
    assert.equal(isTransientError(busy(), 'sqlite'), true);
    assert.equal(isTransientError(Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }), 'mysql'), true);
    assert.equal(isTransientError(Object.assign(new Error('x'), { code: '40P01' }), 'postgres'), true);
    assert.equal(isTransientError(Object.assign(new Error('x'), { code: 'ECONNRESET' }), 'mysql'), true);
    assert.equal(isTransientError(new Error('syntax error'), 'sqlite'), false);
    assert.equal(isTransientError(Object.assign(new Error('c'), { name: 'ConcurrencyError' }), 'postgres'), false, 'conflicts are never retried');
});

test('queries retry on transient errors when enabled, and not when disabled', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const r = new Row(); r.val = 'x'; ctx.Row.add(r); await ctx.saveChanges();

    // Disabled (default): the transient error surfaces.
    let f = failFirst(ctx._SQLEngine, 'all', 1, busy);
    await assert.rejects(() => ctx.Row.toList(), /database is locked/);
    f.restore();

    // Enabled: two failures then success.
    const retries = [];
    ctx.on('retry', (e) => retries.push(e.attempt));
    ctx.setRetryOnFailure({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    f = failFirst(ctx._SQLEngine, 'all', 2, busy);
    const rows = await ctx.Row.toList();
    assert.equal(rows.length, 1, 'query succeeded after retries');
    assert.equal(f.calls(), 3, 'two failed attempts + one success');
    assert.deepEqual(retries, [1, 2], "'retry' event fired before each wait");
    f.restore();

    // Exhausted: 4 failures > maxRetries 3 -> throws.
    f = failFirst(ctx._SQLEngine, 'all', 10, busy);
    await assert.rejects(() => ctx.Row.toList(), /database is locked/);
    assert.equal(f.calls(), 4, 'initial attempt + 3 retries');
    f.restore();
});

test('non-transient errors are not retried; retries are skipped inside an explicit transaction', async () => {
    const ctx = makeCtx(); await prep(ctx);
    ctx.setRetryOnFailure({ maxRetries: 3, baseDelayMs: 1 });

    let f = failFirst(ctx._SQLEngine, 'all', 5, () => new Error('no such column: nope'));
    await assert.rejects(() => ctx.Row.toList(), /no such column/);
    assert.equal(f.calls(), 1, 'non-transient -> single attempt');
    f.restore();

    f = failFirst(ctx._SQLEngine, 'all', 1, busy);
    await assert.rejects(() => ctx.transaction(async (tx) => { await tx.Row.toList(); }), /database is locked/);
    assert.equal(f.calls(), 1, 'inside a transaction the operation is not retried (EF semantics)');
    f.restore();
});

test('saveChanges retries a transient failure and commits exactly once', async () => {
    const ctx = makeCtx(); await prep(ctx);
    ctx.setRetryOnFailure({ maxRetries: 2, baseDelayMs: 1 });
    const f = failFirst(ctx._SQLEngine, 'insert', 1, busy);      // first attempt's INSERT fails (tx rolls back)
    const r = new Row(); r.val = 'once'; ctx.Row.add(r);
    await ctx.saveChanges();
    f.restore();
    const rows = await ctx.Row.asNoTracking().toList();
    assert.equal(rows.length, 1, 'exactly one row after the retried save');
    assert.equal(rows[0].val, 'once');
});

test('global default via masterrecord.configureRetry; per-context false overrides it', async () => {
    masterrecord.configureRetry({ maxRetries: 2, baseDelayMs: 1 });
    try {
        const a = makeCtx(); await prep(a);
        const seed = new Row(); seed.val = 's'; a.Row.add(seed); await a.saveChanges();
        let f = failFirst(a._SQLEngine, 'all', 1, busy);
        assert.equal((await a.Row.toList()).length, 1, 'global default applies');
        f.restore();
        a.setRetryOnFailure(false);
        f = failFirst(a._SQLEngine, 'all', 1, busy);
        await assert.rejects(() => a.Row.toList(), /database is locked/);
        f.restore();
    } finally { masterrecord.configureRetry(false); }
});
