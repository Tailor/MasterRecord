/**
 * Entity enumerability (1.1.8).
 *
 * Bug: entity instance internals (`__entity`, `__context`, `__ID`,
 * `__dirtyFields`, `__state`, `__name`) and helper methods (`toJSON`,
 * `toObject`, `save`, `delete`, `reload`, `clone`) were attached by plain
 * assignment / object literal, making them ENUMERABLE own properties.
 *
 * Consequences when an entity was spread / Object.assign'd:
 *   1. The copied `toJSON` ran on the plain object and rebuilt output from
 *      the original columns only — so `JSON.stringify({ ...w, role })`
 *      silently dropped `role`.
 *   2. `__context` (the whole DB context) leaked into the copy, so
 *      `JSON.stringify` could throw on the circular structure.
 *   3. `Object.keys(entity)` returned methods + `__*` internals, not just
 *      columns.
 *
 * Fix: internals + helper methods are now non-enumerable; column accessors
 * stay enumerable. `{ ...entity, extra }` now serializes correctly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'enumspread';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'enum-spread');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

fs.writeFileSync(
    path.join(envDir, 'env.enumspread.json'),
    JSON.stringify({ EnumCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Workspace {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    slug(db) { db.string(); }
}

class EnumCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Workspace);
    }
}

function seed(ctx) {
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Workspace (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT
        );
        DELETE FROM Workspace;
        INSERT INTO Workspace (id, name, slug) VALUES (28, 'Admin Workspace', 'admin');
    `);
}

test('queried entity: Object.keys returns only columns (no internals/methods)', async () => {
    const ctx = new EnumCtx();
    seed(ctx);
    const w = await ctx.Workspace.where(x => x.id == $$, 28).single();
    const keys = Object.keys(w);
    assert.deepEqual(keys.sort(), ['id', 'name', 'slug']);
    for (const leaked of ['__entity', '__context', '__ID', '__dirtyFields', '__state', '__name', 'toJSON', 'toObject', 'save', 'delete', 'reload', 'clone']) {
        assert.ok(!keys.includes(leaked), `must not leak ${leaked}`);
    }
    await ctx.close();
});

test('queried entity: spread + extra key survives JSON.stringify', async () => {
    const ctx = new EnumCtx();
    seed(ctx);
    const w = await ctx.Workspace.where(x => x.id == $$, 28).single();

    const out = { ...w, role: 'owner' };
    assert.equal(out.role, 'owner');

    const json = JSON.parse(JSON.stringify(out)); // must not throw (no circular __context)
    assert.equal(json.role, 'owner', 'added key must survive serialization');
    assert.equal(json.id, 28);
    assert.equal(json.name, 'Admin Workspace');
    assert.equal(json.slug, 'admin');
    assert.ok(!('__context' in json) && !('__entity' in json), 'internals must not leak into JSON');
    await ctx.close();
});

test('queried entity: direct JSON.stringify still emits columns', async () => {
    const ctx = new EnumCtx();
    seed(ctx);
    const w = await ctx.Workspace.where(x => x.id == $$, 28).single();
    const json = JSON.parse(JSON.stringify(w));
    assert.equal(json.id, 28);
    assert.equal(json.name, 'Admin Workspace');
    await ctx.close();
});

test('.new() entity: spread + extra key survives JSON.stringify', async () => {
    const ctx = new EnumCtx();
    seed(ctx);
    const w = ctx.Workspace.new();
    w.name = 'New WS';
    w.slug = 'new-ws';

    const keys = Object.keys(w);
    for (const leaked of ['__entity', '__context', 'toJSON', 'save']) {
        assert.ok(!keys.includes(leaked), `.new() must not leak ${leaked}`);
    }

    const out = { ...w, role: 'editor' };
    const json = JSON.parse(JSON.stringify(out));
    assert.equal(json.role, 'editor');
    assert.equal(json.name, 'New WS');
    await ctx.close();
});
