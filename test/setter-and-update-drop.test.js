/**
 * Reproducers for the "silently dropped writes" family of bugs that
 * downstream consumers have been working around with raw _execute.
 *
 * 1. `.new()` setter does NOT apply `fieldDef.set` — tracker-entity setter
 *    does. Inconsistent behavior between INSERT and UPDATE paths.
 * 2. `_processBatchUpdates` reads `currentModel._entity` (typo) instead of
 *    `__entity`, so `removePrimarykeyandVirtual` gets `undefined`.
 * 3. After UPDATE, `__state` and `__dirtyFields` are not reset. On the next
 *    `saveChanges()` call, the same fields are re-written to the DB, which
 *    can silently overwrite concurrent changes from other processes.
 * 4. Tracker setter pushes to `__dirtyFields` without de-duplication, so
 *    setting the same field multiple times produces duplicate assignments
 *    in the UPDATE SET clause. In Postgres this is a hard error
 *    ("multiple assignments to same column"); in SQLite/MySQL it may or
 *    may not work depending on driver version.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'setterdrop';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'setter-and-update-drop');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'setdropctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.setterdrop.json'),
    JSON.stringify({
        SetDropCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');

class User {
    id(db) { db.integer().primary().auto(); }
    // `name` has a .set() transform that trims and lowercases — the
    // canonical test for whether the setter path applies fieldDef.set.
    name(db) { db.string().set(v => (typeof v === 'string' ? v.trim().toLowerCase() : v)); }
    email(db) { db.string(); }
    score(db) { db.integer(); }
}

class SetDropCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(User);
    }
}

{
    const ctx = new SetDropCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            score INTEGER
        );
    `);
    await ctx.close();
}

//
// Bug #1 — .new() setter must apply fieldDef.set
//
test('.new() setter applies fieldDef.set transform at write time', async () => {
    const ctx = new SetDropCtx();
    const u = ctx.User.new();
    u.name = '  ALICE  ';  // whitespace + uppercase
    u.email = 'alice@example.com';
    u.score = 10;
    await u.save();

    const row = ctx._SQLEngine.db.prepare('SELECT name FROM User WHERE email = ?').get('alice@example.com');
    assert.equal(row.name, 'alice', `.set() transform should have been applied on INSERT; got "${row.name}"`);
    await ctx.close();
});

test('Tracker setter applies fieldDef.set transform on UPDATE (baseline — already works)', async () => {
    const ctx = new SetDropCtx();
    ctx._SQLEngine.db.prepare('INSERT INTO User (name, email, score) VALUES (?, ?, ?)').run('bob', 'bob@example.com', 5);

    const loaded = await ctx.User.where('u => u.email == $$', 'bob@example.com').single();
    loaded.name = '  BOB-UPDATED  ';
    await loaded.save();

    const row = ctx._SQLEngine.db.prepare('SELECT name FROM User WHERE email = ?').get('bob@example.com');
    assert.equal(row.name, 'bob-updated', `.set() transform should apply on UPDATE; got "${row.name}"`);
    await ctx.close();
});

//
// Bug #2 — after UPDATE, __dirtyFields and __state are not reset;
// calling saveChanges twice for the same entity silently re-updates the
// same fields.
//
test('After UPDATE, __dirtyFields is cleared and __state is reset to track', async () => {
    const ctx = new SetDropCtx();
    ctx._SQLEngine.db.prepare('INSERT INTO User (name, email, score) VALUES (?, ?, ?)').run('carol', 'carol@example.com', 1);

    const loaded = await ctx.User.where('u => u.email == $$', 'carol@example.com').single();
    loaded.score = 2;
    await loaded.save();

    assert.deepEqual(loaded.__dirtyFields, [], '__dirtyFields should be empty after UPDATE');
    assert.equal(loaded.__state, 'track', '__state should be "track" after UPDATE');
    await ctx.close();
});

test('saveChanges re-called with no modifications after UPDATE is a no-op', async () => {
    const ctx = new SetDropCtx();
    ctx._SQLEngine.db.prepare('INSERT INTO User (name, email, score) VALUES (?, ?, ?)').run('dave', 'dave@example.com', 1);

    const loaded = await ctx.User.where('u => u.email == $$', 'dave@example.com').single();
    loaded.score = 99;
    await loaded.save();

    // Simulate concurrent external write: another process updates score to 42.
    ctx._SQLEngine.db.prepare('UPDATE User SET score = 42 WHERE email = ?').run('dave@example.com');

    // Re-saving without touching the entity should NOT overwrite the external
    // change; the entity is no longer modified.
    await ctx.saveChanges();

    const row = ctx._SQLEngine.db.prepare('SELECT score FROM User WHERE email = ?').get('dave@example.com');
    assert.equal(row.score, 42, 'second saveChanges must not silently re-apply the prior write');
    await ctx.close();
});

//
// Bug #3 — setting the same field twice must not produce duplicate
// SET assignments (SQLite errors on duplicates; Postgres always errors).
//
test('Setting the same field twice produces only one assignment in UPDATE', async () => {
    const ctx = new SetDropCtx();
    ctx._SQLEngine.db.prepare('INSERT INTO User (name, email, score) VALUES (?, ?, ?)').run('eve', 'eve@example.com', 1);

    const loaded = await ctx.User.where('u => u.email == $$', 'eve@example.com').single();
    loaded.score = 2;
    loaded.score = 3;  // second assignment — must not push duplicate into __dirtyFields
    loaded.score = 4;

    // Only one occurrence of 'score' in dirtyFields
    const dupCount = loaded.__dirtyFields.filter(f => f === 'score').length;
    assert.equal(dupCount, 1, `score should appear exactly once in __dirtyFields; got ${dupCount} (${JSON.stringify(loaded.__dirtyFields)})`);

    // And the UPDATE must succeed and persist the last value.
    await loaded.save();
    const row = ctx._SQLEngine.db.prepare('SELECT score FROM User WHERE email = ?').get('eve@example.com');
    assert.equal(row.score, 4, 'last assigned value must be persisted');
    await ctx.close();
});
