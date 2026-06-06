/**
 * Regression for two related 1.0.8 fixes:
 *
 * 1. postgresEngine was missing getTableInfo() — schema.syncTable() couldn't
 *    diff against the existing schema, so re-running migrations failed with
 *    `column "X" already exists`.
 *
 * 2. DROP COLUMN DDL was not idempotent — Postgres/MySQL didn't emit
 *    `IF EXISTS` and SQLite had no runtime guard, so re-running a
 *    drop-column migration after a failed/partial run errored with
 *    `column "X" does not exist`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'dropcol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'drop-col');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'dropcolctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.dropcol.json'),
    JSON.stringify({
        DropColCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');
const { default: schema } = await import('../Migrations/schema.js');
const { default: PostgresEngine } = await import('../postgresEngine.js');
const { default: MySQLEngine } = await import('../mySQLEngine.js');
const { default: SQLiteQuery } = await import('../Migrations/migrationSQLiteQuery.js');
const { default: MySQLQuery } = await import('../Migrations/migrationMySQLQuery.js');
const { default: PostgresQuery } = await import('../Migrations/migrationPostgresQuery.js');

// ---- DDL string-level checks (no DB connection required) ----

test('Postgres dropColumn emits IF EXISTS with quoted identifiers', () => {
    const q = new PostgresQuery();
    const sql = q.dropColumn({ tableName: 'SchedulerLeader', name: 'staleField' });
    assert.match(sql, /ALTER TABLE "SchedulerLeader" DROP COLUMN IF EXISTS "staleField"/);
});

test('MySQL dropColumn emits IF EXISTS with backtick quotes', () => {
    const q = new MySQLQuery();
    const sql = q.dropColumn({ tableName: 'User', name: 'legacyField' });
    assert.match(sql, /ALTER TABLE `User` DROP COLUMN IF EXISTS `legacyField`/);
});

test('SQLite dropColumn quotes identifiers with square brackets', () => {
    const q = new SQLiteQuery();
    const sql = q.dropColumn({ tableName: 'User', name: 'legacyField' });
    assert.match(sql, /ALTER TABLE \[User\] DROP COLUMN \[legacyField\]/);
    // SQLite has no `IF EXISTS` on DROP COLUMN; the guard lives in schema.dropColumn().
    assert.doesNotMatch(sql, /IF EXISTS/);
});

// ---- Postgres getTableInfo presence ----

test('Postgres engine exposes getTableInfo()', () => {
    const engine = new PostgresEngine();
    assert.equal(typeof engine.getTableInfo, 'function');
});

test('Postgres getTableInfo returns rows shaped like SQLite/MySQL counterparts', async () => {
    const engine = new PostgresEngine();
    // Stub _runWithParams so we can verify the SQL without a live Postgres.
    let capturedSql;
    let capturedParams;
    engine._runWithParams = async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return {
            rows: [
                { name: 'id', dflt_value: null, is_nullable: 'NO', data_type: 'integer' },
                { name: 'createdAt', dflt_value: null, is_nullable: 'YES', data_type: 'timestamp without time zone' },
            ],
        };
    };
    const rows = await engine.getTableInfo('SchedulerLeader');
    assert.match(capturedSql, /information_schema\.columns/);
    assert.match(capturedSql, /table_name\s*=\s*\$1/);
    assert.deepEqual(capturedParams, ['SchedulerLeader']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'id');
    assert.equal(rows[1].name, 'createdAt');
    // Field names mirror SQLite's PRAGMA table_info / MySQL's INFORMATION_SCHEMA query.
    for (const key of ['name', 'dflt_value', 'is_nullable', 'data_type']) {
        assert.ok(key in rows[0], `expected '${key}' in row`);
    }
});

test('Postgres getTableInfo THROWS on a real introspection error (no swallow)', async () => {
    // Previously this swallowed the error and returned [], which made
    // schema.createTable() mistake an introspection failure for "table has
    // no columns" / "table absent" and silently skip column syncs. A real
    // failure must now propagate so the migration aborts loudly.
    const engine = new PostgresEngine();
    engine._runWithParams = async () => { throw new Error('boom'); };
    await assert.rejects(() => engine.getTableInfo('Whatever'), /introspection failed/);
});

// ---- SQLite end-to-end: dropColumn twice in a row must not throw ----

class Widget {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    legacyField(db) { db.string(); }
}

class DropColCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Widget);
    }
}

{
    // Seed the schema using raw SQL so we don't depend on the rest of the
    // migration pipeline for setup.
    const ctx = new DropColCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Widget (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            legacyField TEXT
        );
    `);
    await ctx.close();
}

test('SQLite schema.dropColumn() is idempotent (re-running does not throw)', async () => {
    const ctx = new DropColCtx();
    const sch = new schema(DropColCtx);
    await sch._ensureReady();
    // schema.dropColumn() gates on `this.fullTable` being truthy as a "did
    // init run" sentinel. Real migrations get a real tableObj here; tests
    // just need a truthy value to pass the gate.
    sch.fullTable = { __name: 'Widget' };

    // Confirm the column exists initially.
    const before = await ctx._SQLEngine.getTableInfo('Widget');
    assert.ok(before.some(c => c.name === 'legacyField'), 'precondition: legacyField column exists');

    // First drop: removes the column.
    await sch.dropColumn({ tableName: 'Widget', name: 'legacyField' });
    const afterFirst = await ctx._SQLEngine.getTableInfo('Widget');
    assert.ok(!afterFirst.some(c => c.name === 'legacyField'), 'column was dropped');

    // Second drop: must be a no-op, not an error. This is the regression
    // that 1.0.8 fixes — without the runtime guard in schema.dropColumn(),
    // SQLite would have thrown "no such column: legacyField".
    await assert.doesNotReject(
        sch.dropColumn({ tableName: 'Widget', name: 'legacyField' }),
        'second dropColumn must be idempotent'
    );

    await ctx.close();
});

test('SQLite schema.dropColumn() on a never-existed column is also a no-op', async () => {
    const ctx = new DropColCtx();
    const sch = new schema(DropColCtx);
    await sch._ensureReady();
    sch.fullTable = { __name: 'Widget' };
    await assert.doesNotReject(
        sch.dropColumn({ tableName: 'Widget', name: 'neverExisted' })
    );
    await ctx.close();
});
