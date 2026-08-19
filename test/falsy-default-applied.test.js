/**
 * A declared default of a FALSY value (0, false, '') must be applied on insert.
 *
 * Bug: insertManager.validateEntity checked `if (currentEntity.default)` —
 * truthiness — so `.default(0)`, `.default(false)`, and `.default('')` were
 * silently skipped. This was masked before 1.5.7 because an unset field read as
 * its definition *function* (truthy, non-null), so the required-field check
 * passed anyway. Once unset fields correctly read as `undefined` (1.5.7), a
 * `.notNullable().default(0)` column (e.g. a `blocked` flag) failed validation
 * with "is a required Field" — broadly breaking inserts across models with
 * falsy-defaulted NOT NULL columns.
 *
 * Fix: apply the default whenever it is not undefined/null (not on truthiness),
 * into both the clean and raw models so it reaches the INSERT. Genuinely
 * required fields with no default are still enforced.
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
    email(db) { db.string().notNullable(); }           // required, no default
    blocked(db) { db.integer().notNullable().default(0); }   // falsy default on NOT NULL
    role(db) { db.string().default('user'); }
    active(db) { db.boolean().default(false); }         // falsy default
    note(db) { db.string().default(''); }               // falsy default
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-falsy-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-falsy-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Account); }
    }
    return new testContext();
}

test('falsy defaults (0 / false / "") are applied on insert', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Account" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "email" TEXT NOT NULL, "blocked" INTEGER NOT NULL DEFAULT 0, "role" TEXT DEFAULT 'user', "active" INTEGER DEFAULT 0, "note" TEXT DEFAULT '')`);

    const a = new Account();
    a.email = 'reg@example.com';   // every defaulted field left unset
    ctx.Account.add(a);
    await ctx.saveChanges();       // must NOT throw "blocked is a required Field"

    const row = (await ctx.Account.toList())[0];
    assert.equal(row.email, 'reg@example.com');
    assert.equal(row.blocked, 0, 'notNullable().default(0) must apply the 0');
    assert.equal(row.role, 'user');
    assert.equal(row.note, '', "default('') must apply the empty string");
    // boolean default(false) — stored/read back as a falsy value, not skipped.
    assert.ok(!row.active, 'default(false) must apply a falsy value, not error');
});

test('a required field with no default is still enforced', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Account" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "email" TEXT NOT NULL, "blocked" INTEGER NOT NULL DEFAULT 0, "role" TEXT DEFAULT 'user', "active" INTEGER DEFAULT 0, "note" TEXT DEFAULT '')`);

    const a = new Account();   // email (required, no default) deliberately not set
    ctx.Account.add(a);
    await assert.rejects(() => ctx.saveChanges(), /email is a required Field/,
        'a NOT NULL field with no default and no value must still fail validation');
});
