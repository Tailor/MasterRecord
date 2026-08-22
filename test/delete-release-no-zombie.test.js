/**
 * A committed DELETE releases its entity — it must not become a replaying
 * "zombie" that re-issues its DELETE and poisons every later save.
 *
 * Regression (1.5.10): saveChanges() released an entity only if its state was
 * back to 'track'. Inserts/updates were reset to 'track' by the batch
 * processors, but a delete stays in state 'delete' after _processBatchDeletes,
 * so it failed the release filter and was never untracked. It then stayed in the
 * change set forever: every subsequent save re-included it and re-issued its
 * DELETE (hundreds of redundant deletes), the cross-context "unsaved changes"
 * warning fired forever, and — because the unit of work was permanently
 * non-empty and stuck — real writes (e.g. a User UPDATE) stopped persisting a
 * couple of rounds in.
 *
 * Fix: lifecycle transitions are centralized in _reconcileFlushed with one rule
 * for insert/update/delete — a committed, not-re-mutated entity is detached
 * (deletes included).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class User { id(db) { db.integer().primary().auto(); } blocked(db) { db.integer().default(0); } }
class Session { id(db) { db.integer().primary().auto(); } uid(db) { db.integer(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-zombie-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-zombie-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(User); this.dbset(Session); }
    }
    const ctx = new testContext();
    return ctx;
}

test('a deleted entity is released after save — no replaying zombie', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Session" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "uid" INTEGER)`);

    const s = new Session(); s.uid = 1; ctx.Session.add(s);
    await ctx.saveChanges();
    const row = (await ctx.Session.toList())[0];

    ctx.Session.remove(row);
    await ctx.saveChanges();                       // DELETE issued

    assert.equal((await ctx.Session.toList()).length, 0, 'row is deleted');
    assert.ok(!ctx.__trackedEntitiesMap.has(row.__ID),
        'the deleted entity must be detached, not left tracked as a zombie');

    // A subsequent save must be a genuine no-op (nothing dirty to replay).
    await ctx.saveChanges();
    assert.equal(ctx.__trackedEntities.filter(e => e && e.__state === 'delete').length, 0,
        'no delete-state zombies remain in the tracked list');
});

test('update-then-delete repeated does not latch: UPDATEs keep persisting', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "User" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "blocked" INTEGER DEFAULT 0)`);
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Session" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "uid" INTEGER)`);

    const u = new User(); u.blocked = 0; ctx.User.add(u); await ctx.saveChanges();
    const uid = (await ctx.User.toList())[0].id;

    for (let r = 0; r < 6; r++) {
        const want = r % 2 === 0 ? 1 : 0;
        const user = (await ctx.User.toList()).find(x => x.id === uid);
        user.blocked = want;
        await ctx.saveChanges();                   // UPDATE User

        const s = new Session(); s.uid = uid; ctx.Session.add(s);
        await ctx.saveChanges();                   // INSERT Session
        for (const sess of await ctx.Session.toList()) { ctx.Session.remove(sess); }
        await ctx.saveChanges();                   // DELETE Session(s)

        assert.equal((await ctx.User.toList()).find(x => x.id === uid).blocked, want,
            `round ${r}: the User UPDATE must persist (no latch)`);
        assert.equal((await ctx.Session.toList()).length, 0, `round ${r}: sessions revoked`);
    }

    // No zombie deletes accumulated across the rounds.
    assert.equal(ctx.__trackedEntities.filter(e => e && e.__state === 'delete').length, 0,
        'no delete zombies accumulate over repeated cycles');
});

test('a mixed change set (insert + update + delete) reconciles all three', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Session" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "uid" INTEGER)`);

    // Seed two rows.
    const a = new Session(); a.uid = 1; ctx.Session.add(a);
    const b = new Session(); b.uid = 2; ctx.Session.add(b);
    await ctx.saveChanges();

    const rows = await ctx.Session.toList();
    const toUpdate = rows.find(r => r.uid === 1);
    const toDelete = rows.find(r => r.uid === 2);
    const toInsert = new Session(); toInsert.uid = 3;

    toUpdate.uid = 11;
    ctx.Session.remove(toDelete);
    ctx.Session.add(toInsert);
    await ctx.saveChanges();                        // one mixed unit of work

    const after = await ctx.Session.toList();
    assert.deepEqual(after.map(r => r.uid).sort((x, y) => x - y), [3, 11],
        'insert applied, update applied, delete applied');
    // Every committed entity was detached; nothing dirty lingers.
    assert.equal(ctx.__trackedEntities.filter(e => e && e.__state && e.__state !== 'track').length, 0,
        'no dirty entities remain after a mixed save');
});
