/**
 * Partial / filtered indexes (1.2.4) — enterprise parity with EF Core
 * (HasFilter), TypeORM (where), Rails (:where), Django (condition).
 *
 * Adds a `where` option to createIndex / createCompositeIndex:
 *   - Postgres + SQLite: native partial index (`CREATE … INDEX … WHERE <pred>`)
 *   - MySQL: throws (no partial-index support) rather than silently emitting a
 *     non-filtered index that would enforce the wrong constraint.
 *
 * Canonical use: one-default-per-scope —
 *   createCompositeIndex({ columns:['scope_id'], unique:true, where:'is_default = 1' })
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Migrations from '../Migrations/migrations.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';

process.env.master = 'partialidx';
process.env.MR_SILENT_MIGRATIONS = 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'partial-index');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.partialidx.json'),
    JSON.stringify({ IdxCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const idx = { tableName: 'Setting', columns: ['scope_id'], indexName: 'one_default', unique: true, where: 'is_default = 1' };
const single = { tableName: 'Setting', columnName: 'scope_id', indexName: 'one_default', unique: true, where: 'is_default = 1' };

// ---- builder output ----
test('SQLite emits a partial UNIQUE index (composite + single)', () => {
    const q = new SQLiteQuery();
    assert.match(q.createCompositeIndex(idx), /CREATE UNIQUE INDEX IF NOT EXISTS one_default ON Setting\(scope_id\) WHERE is_default = 1/);
    assert.match(q.createIndex(single), /CREATE UNIQUE INDEX IF NOT EXISTS one_default ON Setting\(scope_id\) WHERE is_default = 1/);
});

test('Postgres emits a partial UNIQUE index (quoted) ', () => {
    const q = new PostgresQuery();
    assert.match(q.createCompositeIndex(idx), /CREATE UNIQUE INDEX IF NOT EXISTS "one_default" ON "Setting"\("scope_id"\) WHERE is_default = 1/);
    assert.match(q.createIndex(single), /CREATE UNIQUE INDEX IF NOT EXISTS "one_default" ON "Setting"\("scope_id"\) WHERE is_default = 1/);
});

test('MySQL throws on `where` (no partial indexes) — loud, not silent', () => {
    const q = new MySQLQuery();
    assert.throws(() => q.createCompositeIndex(idx), /does not support partial\/filtered indexes/);
    assert.throws(() => q.createIndex(single), /does not support partial\/filtered indexes/);
    // without `where`, MySQL still builds a normal (unique) index
    assert.match(q.createCompositeIndex({ ...idx, where: undefined }), /CREATE UNIQUE INDEX `one_default` ON `Setting`\(`scope_id`\)/);
});

// ---- end-to-end enforcement on SQLite ----
const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');

class IdxCtx extends context {
    constructor() { super(); this.env(envDir); }
}

test('partial UNIQUE index actually enforces one-default-per-scope (SQLite)', async () => {
    const ctx = new IdxCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Setting; CREATE TABLE Setting (id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id INTEGER, is_default INTEGER);');

    const sch = new schemaCls(IdxCtx);
    await sch._ensureReady();
    await sch.createCompositeIndex(idx);

    const ins = (scope, def) => ctx._SQLEngine.db.prepare('INSERT INTO Setting (scope_id, is_default) VALUES (?, ?)').run(scope, def);
    ins(1, 1);            // first default for scope 1 — ok
    ins(1, 0);            // non-defaults are not constrained by the filter
    ins(1, 0);            // another non-default — ok
    ins(2, 1);            // default for a different scope — ok
    assert.throws(() => ins(1, 1), /UNIQUE constraint failed/, 'a second default for scope 1 must be rejected');

    await ctx.close();
});

// ---- declarative round-trip ----
test('declarative compositeIndex carries `where` through generation', () => {
    const m = new Migrations();
    const base = (withIdx) => [{
        __name: 'Setting',
        __compositeIndexes: withIdx ? [{ columns: ['scope_id'], name: 'one_default', unique: true, where: 'is_default = 1' }] : [],
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        scope_id: { name: 'scope_id', type: 'integer' },
        is_default: { name: 'is_default', type: 'integer' },
    }];
    const code = m.template('AddPartialIdx', base(false), base(true));
    assert.match(code, /createCompositeIndex\(\{[^}]*"where":\s*"is_default = 1"/);
    assert.match(code, /"unique":\s*true/);
});
