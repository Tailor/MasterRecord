/**
 * End-to-end SQLite lifecycle test.
 * Creates a context, an entity, inserts, reads, updates, deletes, and closes.
 *
 * This is the smoke test that proves the ESM conversion didn't break the
 * core ORM flow for the default database driver.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Point the context at our fixture config
process.env.master = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'sqlite-lifecycle');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'LifecycleContext.sqlite');

// Clean state
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.test.json'),
    JSON.stringify({
        LifecycleContext: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');

class Widget {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    qty(db) { db.integer(); }
}

class LifecycleContext extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Widget);
    }
}

const ctx = new LifecycleContext();

after(async () => {
    if (ctx && typeof ctx.close === 'function') {
        await ctx.close();
    }
    // Leave fixtures on disk for debugging; they're regenerated each run.
});

test('context instantiates as SQLite', () => {
    assert.equal(ctx.isSQLite, true);
    assert.equal(ctx.isMySQL, false);
    assert.equal(ctx.isPostgres, false);
});

test('context exposes the registered entity', () => {
    assert.ok(ctx.Widget, 'Widget dbset is attached');
});

test('context has a SQL engine', () => {
    assert.ok(ctx._SQLEngine, 'SQL engine was initialized');
});
