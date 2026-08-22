/**
 * Optimistic concurrency — EF Core concurrency tokens / rowversion semantics.
 *
 *  - A column marked .concurrencyToken() has its ORIGINAL (as-loaded) value
 *    added to the UPDATE/DELETE WHERE clause. If another writer changed the row
 *    in between, 0 rows match and saveChanges() throws ConcurrencyError
 *    (EF: DbUpdateConcurrencyException) — instead of silently overwriting.
 *  - .rowVersion() is an ORM-managed integer token: bumped atomically on every
 *    UPDATE (`SET v = v + 1 WHERE v = original`), mirrored onto the entity, and
 *    refreshed as the new original after a successful save.
 *  - Rows-affected is ALWAYS checked (even without tokens): updating/deleting a
 *    row that was concurrently deleted throws ConcurrencyError rather than
 *    returning true.
 *  - The failed save's transaction is rolled back; the entity stays tracked and
 *    dirty; the caller can reload() and retry (EF's resolution loop).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import { ConcurrencyError } from '../errors.js';

process.env.master = 'development';

class Doc {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    version(db) { db.rowVersion(); }                 // ORM-managed token
}
class Tagged {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    etag(db) { db.string().concurrencyToken(); }      // app-managed token
}
class Plain {
    id(db) { db.integer().primary().auto(); }
    val(db) { db.string(); }                          // no token at all
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cc-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cc-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Doc); this.dbset(Tagged); this.dbset(Plain); }
    }
    const ctx = new testContext();
    return ctx;
}
async function prep(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Doc" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "version" INTEGER NOT NULL DEFAULT 0)`);
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Tagged" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT, "etag" TEXT)`);
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Plain" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
}

test('rowVersion: bumps atomically on each update and is mirrored on the entity', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const d = new Doc(); d.title = 'a'; ctx.Doc.add(d); await ctx.saveChanges();

    const row = (await ctx.Doc.toList())[0];
    assert.equal(row.version, 0, 'starts at the default 0');
    row.title = 'b'; await ctx.saveChanges();
    assert.equal(row.version, 1, 'in-memory version mirrors the atomic bump');
    row.title = 'c'; await ctx.saveChanges();       // uses version=1 in the WHERE
    assert.equal(row.version, 2);
    assert.equal((await ctx.Doc.asNoTracking().toList())[0].version, 2, 'DB has the bumped version');
});

test('rowVersion: a concurrent modification makes saveChanges throw ConcurrencyError (no silent overwrite)', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const d = new Doc(); d.title = 'orig'; ctx.Doc.add(d); await ctx.saveChanges();

    const mine = (await ctx.Doc.toList())[0];          // loaded with version 0
    // "Someone else" updates the row (bumping the version) behind our back.
    ctx._execute(`UPDATE "Doc" SET "title" = 'theirs', "version" = "version" + 1 WHERE "id" = ?`, [mine.id]);

    mine.title = 'mine';
    await assert.rejects(() => ctx.saveChanges(), (err) => {
        assert.ok(err instanceof ConcurrencyError, `expected ConcurrencyError, got ${err && err.name}: ${err && err.message}`);
        assert.equal(err.code, 'MR_CONCURRENCY_CONFLICT');
        assert.equal(err.entries.length, 1);
        assert.equal(err.entries[0], mine, 'the conflicting entity is reported');
        return true;
    });
    // Nothing was overwritten, and the entity is still tracked + dirty for a retry.
    assert.equal((await ctx.Doc.asNoTracking().toList())[0].title, 'theirs', 'the other writer\'s change survived');
    assert.equal(mine.__state, 'modified', 'entity remains dirty after the conflict');

    // EF-style resolution: reload (database wins) then re-apply and retry.
    await mine.reload();
    assert.equal(mine.version, 1);
    mine.title = 'mine-retry';
    await ctx.saveChanges();                             // WHERE version = 1 -> matches
    assert.equal((await ctx.Doc.asNoTracking().toList())[0].title, 'mine-retry');
});

test('concurrencyToken (app-managed): original value goes in the WHERE, new value in the SET', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const t = new Tagged(); t.name = 'n'; t.etag = 'v1'; ctx.Tagged.add(t); await ctx.saveChanges();

    const row = (await ctx.Tagged.toList())[0];
    row.name = 'n2'; row.etag = 'v2';                    // app rotates the token
    await ctx.saveChanges();                             // WHERE etag = 'v1' -> ok
    assert.equal((await ctx.Tagged.asNoTracking().toList())[0].etag, 'v2');

    // Stale token -> conflict.
    const stale = (await ctx.Tagged.toList())[0];       // etag v2
    ctx._execute(`UPDATE "Tagged" SET "etag" = 'v3' WHERE "id" = ?`, [stale.id]);  // someone else
    stale.name = 'stale-write';
    await assert.rejects(() => ctx.saveChanges(), ConcurrencyError);
});

test('rows-affected is always checked: updating or deleting a concurrently-deleted row throws', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const p = new Plain(); p.val = 'x'; ctx.Plain.add(p); await ctx.saveChanges();
    const q = new Plain(); q.val = 'y'; ctx.Plain.add(q); await ctx.saveChanges();

    const [a, b] = await ctx.Plain.toList();
    ctx._execute(`DELETE FROM "Plain" WHERE "id" = ?`, [a.id]);   // vanished behind our back

    a.val = 'edit-of-deleted-row';
    await assert.rejects(() => ctx.saveChanges(), ConcurrencyError, 'update of a deleted row must not succeed silently');

    ctx.clearChangeTracker();
    const [b2] = (await ctx.Plain.toList());
    ctx._execute(`DELETE FROM "Plain" WHERE "id" = ?`, [b2.id]);
    ctx.Plain.remove(b2);
    await assert.rejects(() => ctx.saveChanges(), ConcurrencyError, 'delete of an already-deleted row must throw');
});

test('a conflict rolls back the whole batch (other writes in the same save are not committed)', async () => {
    const ctx = makeCtx(); await prep(ctx);
    const d = new Doc(); d.title = 'd'; ctx.Doc.add(d);
    const p = new Plain(); p.val = 'p'; ctx.Plain.add(p);
    await ctx.saveChanges();

    const doc = (await ctx.Doc.toList())[0];
    const plain = (await ctx.Plain.toList())[0];
    ctx._execute(`UPDATE "Doc" SET "version" = "version" + 1 WHERE "id" = ?`, [doc.id]);  // make doc stale

    plain.val = 'should-roll-back';
    doc.title = 'conflict';
    await assert.rejects(() => ctx.saveChanges(), ConcurrencyError);
    assert.equal((await ctx.Plain.asNoTracking().toList())[0].val, 'p', 'the sibling UPDATE was rolled back with the failed batch');
});
