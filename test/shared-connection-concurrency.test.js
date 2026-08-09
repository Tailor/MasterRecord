/**
 * Three shared-connection bugs that surface under concurrency.
 *
 * 1. Cross-INSTANCE saveChanges serialization. Every context instance built
 *    from the same pooled connection reuses ONE engine object with a single
 *    transaction client, and startTransaction() skips BEGIN when one is already
 *    open. So two saveChanges() calls from DIFFERENT instances used to ride the
 *    same BEGIN..COMMIT — the loser's ROLLBACK destroyed the winner's rows.
 *    1.5.4 serialized per-instance; this pins that the queue lives on the shared
 *    ENGINE, so instances that share a connection also take turns.
 *
 * 2. Poisoned empty query-cache result. An empty array is truthy, so the cache
 *    used to store `[]` for a "no rows yet" read. The moment another instance
 *    inserts the matching row that cached empty is stale, and the writer's
 *    invalidateTable only clears its OWN instance's cache — so the reader keeps
 *    serving empty. Empty result sets are no longer cached.
 *
 * 3. A just-inserted entity's later edits must persist. After INSERT the entity
 *    keeps its generated id, transitions to the clean 'track' state, and a later
 *    field edit re-tracks it as 'modified' → UPDATE (not a dropped write).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Item {
    id(db) { db.integer().primary().auto(); }
    label(db) { db.string(); }
}

// Each call returns a context bound to `dbFile`. Two contexts sharing a dbFile
// share the pooled SQLite engine/connection (that is the scenario under test).
function contextFactory(dbFile) {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-shared-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: dbFile, type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Item);
        }
    }
    return () => new testContext();
}

function freshDbFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-shared-db-'));
    return path.join(dir, 'db.sqlite3');
}

// ── Bug #1: cross-instance saveChanges serialization ─────────────────────────

test('overlapping saveChanges() across two instances sharing a connection all persist', async () => {
    const make = contextFactory(freshDbFile());
    const a = make();
    const b = make();
    await a._ensureReady();
    await b._ensureReady();
    a._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    // Sharing the pooled connection is the precondition for the bug. If the
    // pool ever stops sharing, force it so the test still exercises the path.
    if (a._SQLEngine !== b._SQLEngine) { b._SQLEngine = a._SQLEngine; }

    // Interleave saves from BOTH instances without awaiting — the exact overlap
    // that used to cross-wire one BEGIN..COMMIT across two instances.
    const saves = [];
    for (let i = 0; i < 6; i++) {
        const ea = new Item(); ea.label = `a-${i}`; a.Item.add(ea); saves.push(a.saveChanges());
        const eb = new Item(); eb.label = `b-${i}`; b.Item.add(eb); saves.push(b.saveChanges());
    }
    const results = await Promise.all(saves);
    assert.ok(results.every(Boolean), 'every save from both instances reports success');

    const labels = (await a.Item.toList()).map(r => r.label).sort();
    const expected = [];
    for (let i = 0; i < 6; i++) { expected.push(`a-${i}`, `b-${i}`); }
    assert.deepStrictEqual(labels, expected.sort(),
        'every batch from both instances reached the database exactly once — none rolled back by a sibling');
});

// ── Bug #2: empty query-cache result must not be poisoned ─────────────────────

test('an empty cached toList() is not poisoned when another instance inserts the row', async () => {
    const make = contextFactory(freshDbFile());
    const reader = make();
    const writer = make();
    await reader._ensureReady();
    await writer._ensureReady();
    reader._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    // Reader caches the "no rows yet" result.
    const before = await reader.Item.cache().toList();
    assert.strictEqual(before.length, 0, 'starts empty');

    // A different instance inserts a matching row and commits.
    const w = new Item(); w.label = 'appeared'; writer.Item.add(w);
    await writer.saveChanges();

    // The reader must now see the row — an empty result was never cached, so the
    // lookup re-hits the database instead of serving the stale empty.
    const after = await reader.Item.cache().toList();
    assert.strictEqual(after.length, 1, 'reader sees the inserted row (empty result was not cached)');
    assert.strictEqual(after[0].label, 'appeared');
});

// ── Bug #3: a just-inserted entity's later edit persists ──────────────────────

test('editing a just-inserted entity persists the edit (UPDATE, not a dropped write)', async () => {
    const make = contextFactory(freshDbFile());
    const ctx = make();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Item" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);

    const e = new Item();
    e.label = 'original';
    ctx.Item.add(e);
    await ctx.saveChanges();               // INSERT
    const id = e.id;
    assert.ok(id, 'insert wrote the generated id back onto the entity');

    e.label = 'edited';                    // mutate the SAME just-inserted object
    await ctx.saveChanges();               // must be an UPDATE

    const rows = (await ctx.Item.toList()).filter(r => r.id === id);
    assert.strictEqual(rows.length, 1, 'exactly one row (edit was an UPDATE, not a second INSERT)');
    assert.strictEqual(rows[0].label, 'edited', 'the later edit persisted');
});
