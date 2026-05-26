/**
 * Verifies `ctx.$$` (and `this.$$` from inside a context method) work as
 * a TypeScript/ESLint-clean alias for the bare `$$` placeholder.
 *
 *   ctx.User.where(u => u.id == ctx.$$, 42)
 *   ctx.User.where(u => u.id == this.$$, 42)
 *   ctx.User.where('u => u.id == $$', 42)   // legacy bare form still works
 *
 * All three must produce the same SQL parameters and return the same rows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'ctxdollar';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'ctx-dollar');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'dollarctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.ctxdollar.json'),
    JSON.stringify({
        DollarCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');

class Plugin {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    version(db) { db.string(); }
}

class DollarCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Plugin);
    }
}

{
    const ctx = new DollarCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Plugin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            version TEXT
        );
    `);
    const insert = ctx._SQLEngine.db.prepare('INSERT INTO Plugin (name, version) VALUES (?, ?)');
    insert.run('provider-openai', '1.0');
    insert.run('provider-anthropic', '1.2');
    insert.run('provider-google', '0.9');
    await ctx.close();
}

test('context.$$ getter returns the literal "$$" string', () => {
    const ctx = new DollarCtx();
    assert.equal(ctx.$$, '$$');
});

test('bare $$ in a string lambda still works (legacy form)', async () => {
    const ctx = new DollarCtx();
    const row = await ctx.Plugin
        .where('p => p.name == $$', 'provider-openai')
        .single();
    assert.ok(row);
    assert.equal(row.name, 'provider-openai');
    await ctx.close();
});

test('ctx.$$ in an arrow lambda matches the same row', async () => {
    const ctx = new DollarCtx();
    const row = await ctx.Plugin
        .where((p) => p.name == ctx.$$, 'provider-openai')
        .single();
    assert.ok(row);
    assert.equal(row.name, 'provider-openai');
    await ctx.close();
});

test('this.$$ inside a context method works the same way', async () => {
    const ctx = new DollarCtx();
    // Bind `this` to the context. This mirrors what user code looks like
    // when `findByName` is defined as an instance method on the context
    // class itself.
    const findByName = async function (name) {
        return this.Plugin.where((p) => p.name == this.$$, name).single();
    };
    const row = await findByName.call(ctx, 'provider-anthropic');
    assert.ok(row);
    assert.equal(row.name, 'provider-anthropic');
    await ctx.close();
});

test('multiple ctx.$$ placeholders in one lambda', async () => {
    const ctx = new DollarCtx();
    const rows = await ctx.Plugin
        .where((p) => p.name == ctx.$$ || p.name == ctx.$$, 'provider-openai', 'provider-google')
        .toList();
    const names = rows.map(r => r.name).sort();
    assert.deepEqual(names, ['provider-google', 'provider-openai']);
    await ctx.close();
});

test('mixing ctx.$$ and bare $$ in the same lambda', async () => {
    const ctx = new DollarCtx();
    // First placeholder uses ctx.$$, second uses bare $$
    const rows = await ctx.Plugin
        .where(`p => p.name == ctx.$$ || p.version == $$`, 'provider-openai', '1.2')
        .toList();
    const names = rows.map(r => r.name).sort();
    assert.deepEqual(names, ['provider-anthropic', 'provider-openai']);
    await ctx.close();
});

test('orderBy and other clauses also accept ctx.$$', async () => {
    const ctx = new DollarCtx();
    // orderBy doesn't take placeholders, but where chained with orderBy should still work
    const rows = await ctx.Plugin
        .where((p) => p.version != ctx.$$, '0.9')
        .orderBy('p => p.name')
        .toList();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.name), ['provider-anthropic', 'provider-openai']);
    await ctx.close();
});
