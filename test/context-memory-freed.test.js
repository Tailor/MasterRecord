/**
 * A context's memory is freed as soon as nothing uses it, even while the same
 * job is still running.
 *
 * Every context used to register `new WeakRef(this)` for the cross-context
 * dirty check. Creating a WeakRef puts its target on V8's "kept during job"
 * list, which holds it strongly until control returns to the event loop. A
 * chain of awaits that never does (synchronous SQLite, a worker run driven in
 * microtasks) therefore kept every context it created, closed or not, with all
 * of its dbsets: about 3 MB per context for CodeBook's 311-table KanbanContext,
 * 289 MB after one of its tests. The registry now points at a small entry that
 * shares only the context's dirty index.
 *
 * The measurement runs in a child process started with --expose-gc, so it can
 * force a full collection without leaving the current job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function measure({ contexts, close, write }) {
    const script = `
        process.env.master = 'development';
        process.env.MASTERRECORD_SILENCE_CROSS_CONTEXT = '1';
        const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
        const { default: mr } = await import(${JSON.stringify(path.join(root, 'MasterRecord.js'))});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-memory-'));
        fs.writeFileSync(path.join(dir, 'env.development.json'), JSON.stringify({
            memoryContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite' },
        }));
        // A context about the size of a real application's: many tables, a few columns each.
        const models = [];
        for (let i = 0; i < 120; i++) {
            models.push({ ['Table' + i]: class {
                id(db) { db.integer().primary().auto(); }
                name(db) { db.string(); }
                body(db) { db.string(); }
                state(db) { db.string(); }
                created_at(db) { db.string(); }
            } }['Table' + i]);
        }
        class memoryContext extends mr.context {
            constructor() { super(); this.env(dir); for (const M of models) this.dbset(M); }
        }
        let finalized = 0;
        const registry = new FinalizationRegistry(() => { finalized++; });
        async function use(first) {
            const ctx = new memoryContext();
            registry.register(ctx, null);
            if (first) ctx._execute('CREATE TABLE IF NOT EXISTS "Table0" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "body" TEXT, "state" TEXT, "created_at" TEXT)');
            if (${write}) { const row = new models[0](); row.name = 'n'; row.body = 'b'; row.state = 's'; row.created_at = 'c'; ctx.Table0.add(row); await ctx.saveChanges(); }
            await ctx.Table0.where(r => r.id > $$, 0).take(3).toList();
            if (${close}) await ctx.close();
        }
        await use(true);
        global.gc(); global.gc();
        const before = process.memoryUsage().heapUsed;
        // Everything below runs in one job: no timer, no I/O, nothing returns to the event loop.
        for (let i = 0; i < ${contexts}; i++) await use(false);
        global.gc(); global.gc();
        const sameJob = process.memoryUsage().heapUsed - before;
        await new Promise(r => setTimeout(r, 20));
        global.gc(); global.gc();
        await new Promise(r => setTimeout(r, 20));
        console.log('RESULT=' + JSON.stringify({ perContextSameJob: sameJob / ${contexts}, finalized }));
        await mr.context.closeAll();
    `;
    const res = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env } });
    const m = /RESULT=(.*)/.exec(res.stdout || '');
    assert.ok(m, `child printed no result: ${res.stderr}`);
    return JSON.parse(m[1]);
}

// A context of this size holds well over 300 KB while alive; a freed one leaves
// next to nothing behind. The bound sits far from both.
const BOUND = 100 * 1024;

for (const [label, options] of [
    ['closed after a read', { close: true, write: false }],
    ['dropped without close() after a read', { close: false, write: false }],
    ['closed after a write', { close: true, write: true }],
    ['dropped without close() after a write', { close: false, write: true }],
]) {
    test(`a context ${label} is freed within the same job`, () => {
        const { perContextSameJob, finalized } = measure({ contexts: 40, ...options });
        assert.ok(perContextSameJob < BOUND,
            `each context left ${Math.round(perContextSameJob / 1024)} KB on the heap within one job (bound ${BOUND / 1024} KB)`);
        assert.ok(finalized >= 40, `only ${finalized} of 41 contexts were collected once the job ended`);
    });
}

test('the live-context registry never points at a context', async () => {
    const { default: mr } = await import(path.join(root, 'MasterRecord.js'));
    class registryContext extends mr.context { constructor() { super(); } }
    const ctx = new registryContext();
    const target = ctx.__liveRef.deref();
    assert.notEqual(target, ctx, 'the WeakRef target must not be the context');
    assert.equal(target.dirty, ctx.__dirtyEntities, 'the entry shares the context dirty index');
    for (const value of Object.values(target)) assert.notEqual(value, ctx);
});
