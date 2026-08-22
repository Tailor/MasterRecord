/**
 * Context events / interceptors — EF Core SavingChanges / SavedChanges /
 * SaveChangesFailed, ChangeTracker.Tracked / StateChanged, and a 'command'
 * observer (IDbCommandInterceptor / CommandExecuted).
 *
 *  - 'savingChanges' runs BEFORE the flush; handlers may mutate entities (audit
 *    columns) or convert a delete into a soft-delete; the change set is
 *    re-collected afterwards so those edits are included in the same save.
 *  - 'savedChanges' after commit; 'saveChangesFailed' before the error is rethrown.
 *  - 'tracked' when an entity enters tracking; 'stateChanged' when it becomes dirty.
 *  - 'command' for every SQL statement: { sql, params, durationMs, engine, error? }.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Note {
    id(db) { db.integer().primary().auto(); }
    body(db) { db.string().notNullable(); }
    updatedAt(db) { db.string().nullable(); }
    deletedAt(db) { db.string().nullable(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ev-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ev-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Note); }
    }
    return new testContext();
}
async function prep(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Note" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "body" TEXT NOT NULL, "updatedAt" TEXT, "deletedAt" TEXT)`);
}

test("savingChanges can stamp audit columns and is followed by savedChanges", async () => {
    const ctx = makeCtx(); await prep(ctx);
    const seen = [];
    ctx.on('savingChanges', ({ entries }) => {
        seen.push('saving:' + entries.map(e => e.state).join(','));
        for (const { entity, state } of entries) if (state === 'modified') entity.updatedAt = 'STAMPED';
    });
    ctx.on('savedChanges', ({ entries }) => seen.push('saved:' + entries.length));

    const n = new Note(); n.body = 'x'; ctx.Note.add(n); await ctx.saveChanges();
    const row = (await ctx.Note.toList())[0];
    row.body = 'y'; await ctx.saveChanges();

    assert.deepEqual(seen, ['saving:insert', 'saved:1', 'saving:modified', 'saved:1']);
    assert.equal((await ctx.Note.asNoTracking().toList())[0].updatedAt, 'STAMPED', 'audit column set by the handler was persisted in the same save');
});

test("savingChanges can convert a delete into a soft-delete (EF's canonical recipe)", async () => {
    const ctx = makeCtx(); await prep(ctx);
    ctx.on('savingChanges', ({ entries }) => {
        for (const { entity, state } of entries) {
            if (state === 'delete') { entity.__state = 'modified'; entity.deletedAt = '2026-08-22'; }
        }
    });
    const n = new Note(); n.body = 'keep-me'; ctx.Note.add(n); await ctx.saveChanges();
    const row = (await ctx.Note.toList())[0];
    ctx.Note.remove(row);
    await ctx.saveChanges();
    const rows = await ctx.Note.asNoTracking().toList();
    assert.equal(rows.length, 1, 'row was NOT physically deleted');
    assert.equal(rows[0].deletedAt, '2026-08-22', 'it was soft-deleted instead');
});

test('saveChangesFailed fires with the error before it is rethrown; tracked/stateChanged fire', async () => {
    const ctx = makeCtx(); await prep(ctx);
    let failed = null; const tracked = []; const states = [];
    ctx.on('saveChangesFailed', ({ error, entries }) => { failed = { error, n: entries.length }; });
    ctx.on('tracked', ({ entity }) => tracked.push(entity.__name || (entity.__entity && entity.__entity.__name)));
    ctx.on('stateChanged', ({ state }) => states.push(state));

    const bad = new Note(); ctx.Note.add(bad);                  // body is required -> validation failure
    await assert.rejects(() => ctx.saveChanges(), /required Field/);
    assert.ok(failed && /required Field/.test(failed.error.message), 'saveChangesFailed received the error');
    assert.equal(failed.n, 1);
    assert.ok(tracked.length >= 1, "'tracked' fired for the added entity");
    assert.ok(states.includes('insert'), "'stateChanged' fired with the new state");
});

test("'command' observer sees every SQL statement with timing; once()/unsubscribe work", async () => {
    const ctx = makeCtx(); await prep(ctx);
    const cmds = [];
    const off = ctx.on('command', (c) => cmds.push(c));
    const n = new Note(); n.body = 'q'; ctx.Note.add(n); await ctx.saveChanges();
    await ctx.Note.toList();
    assert.ok(cmds.some(c => /INSERT/i.test(c.sql)), 'INSERT observed');
    assert.ok(cmds.some(c => /SELECT/i.test(c.sql)), 'SELECT observed');
    assert.ok(cmds.every(c => typeof c.durationMs === 'number' && c.engine === 'sqlite'), 'payload has durationMs + engine');
    off();
    const before = cmds.length;
    await ctx.Note.toList();
    assert.equal(cmds.length, before, 'unsubscribed listener no longer receives commands');

    let onceCount = 0;
    ctx.once('savedChanges', () => onceCount++);
    const a = new Note(); a.body = 'a'; ctx.Note.add(a); await ctx.saveChanges();
    const b = new Note(); b.body = 'b'; ctx.Note.add(b); await ctx.saveChanges();
    assert.equal(onceCount, 1, 'once() fires a single time');
});
