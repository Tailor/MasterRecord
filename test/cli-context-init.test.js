/**
 * instantiateReadyContext — the migration CLI's context bootstrap (1.3.2).
 *
 * The CLI used to await context._initPromise directly; a missing MySQL/Postgres
 * database rejected it and the CLI exited without ever creating the database
 * (despite printing "this will create the database if it doesn't exist").
 * instantiateReadyContext routes through schema._ensureReady(), which contains
 * the auto-create + retry, and returns a ready context.
 *
 * This file verifies the SQLite/offline contract (engine live, _ready set,
 * queryable). The live MySQL/Postgres auto-create is covered by the gated
 * cross-engine integration suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'ctxinit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'ctx-init');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.ctxinit.json'),
    JSON.stringify({ InitCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');
const { instantiateReadyContext } = await import('../Migrations/contextInit.js');

class Widget { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class InitCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Widget); }
}

test('instantiateReadyContext returns a ready, queryable context (SQLite)', async () => {
    const ctx = await instantiateReadyContext(InitCtx);
    try {
        assert.equal(ctx._ready, true, 'context must be marked ready');
        assert.ok(ctx._SQLEngine, 'engine must be live');

        // A query must run without re-awaiting any init promise.
        await ctx.query('DROP TABLE IF EXISTS Widget');
        await ctx.query('CREATE TABLE Widget (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
        await ctx.query("INSERT INTO Widget (name) VALUES ('ok')");
        const rows = await ctx.query('SELECT name FROM Widget');
        assert.equal(rows[0].name, 'ok');
    } finally {
        await ctx.close();
    }
});
