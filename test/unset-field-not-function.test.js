/**
 * An UNSET declared field must read as undefined/null, never as its definition
 * method.
 *
 * Trap: entity fields are declared as methods (`apiKey(db){ db.string(); }`).
 * On a `new Model()` the fields the caller never set still resolve to those
 * methods — truthy functions — so a "missing value" guard like `if (!row.apiKey)`
 * silently never fires (a `typeof row.apiKey === 'function'`, not undefined).
 *
 * Fix: add() blanks unset function-valued fields, and attachTrackingTo() (run
 * after INSERT) treats a function as "unset" and backs it with undefined. Query
 * results were already correct (built from the row, not the class prototype).
 * This pins all three paths so `!entity.field` behaves for a genuinely empty
 * column.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Account {
    id(db) { db.integer().primary().auto(); }
    email(db) { db.string(); }
    apiKey(db) { db.string(); }   // deliberately left unset
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-unset-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-unset-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Account); }
    }
    return new testContext();
}

test('an unset field never reads as its definition function (add / insert / query)', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Account" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "email" TEXT, "apiKey" TEXT)`);

    // 1) Right after add(): the unset field must not be its method.
    const a = new Account();
    a.email = 'user@example.com';        // apiKey deliberately not set
    ctx.Account.add(a);
    assert.notStrictEqual(typeof a.apiKey, 'function', 'unset field must not be its definition function after add()');
    assert.ok(!a.apiKey, '`!entity.apiKey` must be true for an unset field after add()');
    assert.equal(a.email, 'user@example.com', 'a set field still reads its value');

    // 2) After INSERT.
    await ctx.saveChanges();
    assert.notStrictEqual(typeof a.apiKey, 'function', 'unset field must not be its definition function after insert');
    assert.ok(!a.apiKey, '`!entity.apiKey` must be true for an unset field after insert');

    // 3) Freshly queried row.
    const row = (await ctx.Account.toList())[0];
    assert.notStrictEqual(typeof row.apiKey, 'function', 'queried unset column must not be a function');
    assert.ok(!row.apiKey, '`!row.apiKey` must be true for a NULL column');
    assert.equal(row.email, 'user@example.com');

    // 4) The "missing credential" guard now works, and setting it later persists.
    assert.ok(!a.apiKey, 'guard fires: apiKey is missing');
    a.apiKey = 'secret-key';
    await ctx.saveChanges();
    const row2 = (await ctx.Account.toList())[0];
    assert.equal(row2.apiKey, 'secret-key', 'setting the previously-unset field persists');
});
