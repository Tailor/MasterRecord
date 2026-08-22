/**
 * Global query filters — EF Core HasQueryFilter / named filters (EF 10) /
 * IgnoreQueryFilters.
 *
 *  - Registered on the entity (dbset(...).queryFilter(name, lambda, ...args) or
 *    ctx.queryFilter(model, ...)); applied to EVERY query on the entity:
 *    toList/single/first/findById/count/exists and executeUpdate/executeDelete.
 *  - Several NAMED filters coexist; ignoreQueryFilters() drops all,
 *    ignoreQueryFilters([names]) drops some (EF 10).
 *  - Filter args may be functions evaluated at query time with the context
 *    (multi-tenancy: the tenant id lives on the context instance).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Blog {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    deletedAt(db) { db.string().nullable(); }
    tenantId(db) { db.integer(); }
}

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-qf-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-qf-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() {
            super(); this.env(envDir);
            this.tenantId = 1;   // like an EF context field referenced by a filter
            this.dbset(Blog)
                .queryFilter('softDelete', 'b => b.deletedAt == null')
                .queryFilter('tenant', 'b => b.tenantId == $$', (ctx) => ctx.tenantId);
        }
    }
    return new testContext();
}
async function seed(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Blog" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "deletedAt" TEXT, "tenantId" INTEGER)`);
    ctx._execute(`INSERT INTO "Blog" ("title","deletedAt","tenantId") VALUES
        ('t1-live', NULL, 1), ('t1-gone', '2026-01-01', 1), ('t2-live', NULL, 2), ('t1-live-2', NULL, 1)`);
}
const titles = (rows) => rows.map(r => r.title).sort();

test('filters apply to toList/count/single/findById and compose with the user where', async () => {
    const ctx = makeCtx(); await seed(ctx);
    assert.deepEqual(titles(await ctx.Blog.toList()), ['t1-live', 't1-live-2'], 'soft-deleted and other-tenant rows are filtered out');
    assert.equal(await ctx.Blog.count(), 2);
    assert.deepEqual(titles(await ctx.Blog.where('b => b.title == $$', 't1-live').toList()), ['t1-live'], 'composes with a user where');
    assert.deepEqual(titles(await ctx.Blog.where('x => x.title == $$', 't1-gone').toList()), [], 'a different lambda alias still composes; deleted row stays hidden');
    const gone = (await ctx.Blog.ignoreQueryFilters().where('b => b.title == $$', 't1-gone').single());
    assert.equal(await ctx.Blog.findById(gone.id), null, 'findById respects filters (a soft-deleted row is not found)');
});

test('ignoreQueryFilters() drops all; ignoreQueryFilters([name]) drops only that one (EF 10 named filters)', async () => {
    const ctx = makeCtx(); await seed(ctx);
    assert.equal((await ctx.Blog.ignoreQueryFilters().toList()).length, 4, 'all rows');
    assert.deepEqual(titles(await ctx.Blog.ignoreQueryFilters(['softDelete']).toList()), ['t1-gone', 't1-live', 't1-live-2'], 'tenant filter still applies');
    assert.deepEqual(titles(await ctx.Blog.ignoreQueryFilters(['tenant']).toList()), ['t1-live', 't1-live-2', 't2-live'], 'soft-delete filter still applies');
    // The opt-out is per query: the next query is filtered again.
    assert.equal((await ctx.Blog.toList()).length, 2);
});

test('function args are evaluated at query time from the context (multi-tenancy)', async () => {
    const ctx = makeCtx(); await seed(ctx);
    ctx.tenantId = 2;
    assert.deepEqual(titles(await ctx.Blog.toList()), ['t2-live']);
    ctx.tenantId = 1;
    assert.equal((await ctx.Blog.toList()).length, 2);
});

test('filters apply to executeUpdate / executeDelete (EF applies them to ExecuteUpdate/Delete)', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const n = await ctx.Blog.executeDelete();        // "delete everything" — but filtered
    assert.equal(n, 2, 'only the visible (tenant 1, not deleted) rows were deleted');
    assert.deepEqual(titles(await ctx.Blog.ignoreQueryFilters().toList()), ['t1-gone', 't2-live'], 'other tenant + soft-deleted rows untouched');
    const m = await ctx.Blog.ignoreQueryFilters().executeUpdate({ title: 'renamed' });
    assert.equal(m, 2, 'with filters ignored, the bulk update reaches all remaining rows');
});

test('removeQueryFilter and ctx.queryFilter(model, ...) registration form', async () => {
    const ctx = makeCtx(); await seed(ctx);
    ctx.removeQueryFilter('Blog', 'tenant');
    assert.deepEqual(titles(await ctx.Blog.toList()), ['t1-live', 't1-live-2', 't2-live']);
    ctx.queryFilter('Blog', 'onlyTwo', 'b => b.tenantId == $$', 2);   // value arg
    assert.deepEqual(titles(await ctx.Blog.toList()), ['t2-live']);
    assert.throws(() => ctx.queryFilter('Blog', 'bad', 'not a lambda'), /where-lambda/);
});
