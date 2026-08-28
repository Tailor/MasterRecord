/**
 * count() must return a NUMBER on every engine.
 *
 * Postgres `count(*)` is bigint (int8), and node-postgres returns int8 as a STRING so a
 * count past 2^53 cannot silently lose precision. Un-cast, that made count()
 * engine-dependent: on Postgres `n === 0` was never true and `n + 1` gave "01", while the
 * same code worked on SQLite. It failed *selectively* — `>` still worked by coercion —
 * which is the worst kind of failure.
 *
 * Fixed the way EF Core's Npgsql provider fixes it: cast in SQL (`count(*)::int`) so the
 * driver returns a native integer, rather than patching the value up in the client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import postgresEngine from '../postgresEngine.js';
import sqliteEngine from '../SQLLiteEngine.js';

process.env.master = 'development';

test('Postgres emits count(*)::int — the cast is what makes the driver return a number', () => {
    const e = new postgresEngine();
    const q = { entityMap: [{ name: 'Row', entity: 'ran' }], parentName: 'Row', count: 'none' };
    assert.equal(e.buildCount(q, { __name: 'Row' }), 'COUNT(*)::int');
    assert.equal(e.buildCount({ ...q, count: { selectFields: ['name'] } }, { __name: 'Row' }), 'COUNT(ran."name")::int');
});

test('SQLite needs no cast — its COUNT is already an integer', () => {
    const e = new sqliteEngine();
    const sql = e.buildCount({ entityMap: [{ name: 'Row', entity: 'ran' }], parentName: 'Row', count: 'none' }, {});
    assert.match(sql, /^COUNT\(\*\)$/, 'no ::int on SQLite');
});

test('count() is a number supporting === and arithmetic, empty and non-empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-count-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-count-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class Row { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Row); }
    }
    const ctx = new testContext();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT)`);

    const empty = await ctx.Row.count();
    assert.equal(typeof empty, 'number', 'empty count is a number');
    assert.strictEqual(empty, 0, 'strict equality against 0 must hold — this is what broke on Postgres');
    assert.strictEqual(empty + 1, 1, 'arithmetic must add, not concatenate ("01")');

    for (const n of ['a', 'b', 'c']) { const r = ctx.Row.new(); r.name = n; ctx.Row.add(r); }
    await ctx.saveChanges();

    const three = await ctx.Row.count();
    assert.strictEqual(three, 3);
    assert.strictEqual(three + 1, 4);
    assert.strictEqual(await ctx.Row.where('r => r.name == $$', 'b').count(), 1, 'a filtered count is a number too');
    await ctx.close();
});
