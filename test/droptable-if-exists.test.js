/**
 * dropTable is idempotent (`DROP TABLE IF EXISTS`) on every engine (1.4.4).
 *
 * Bug: SQLite and MySQL emitted a bare `DROP TABLE <name>` (Postgres already used
 * IF EXISTS). A migration that DROPs a legacy table which never existed on a fresh
 * install therefore failed hard on SQLite/MySQL — inconsistent with the framework's
 * other idempotent DDL (createTable's `IF NOT EXISTS`, dropColumn's skip-if-gone).
 *
 * Fix: all three builders now emit `DROP TABLE IF EXISTS`, so dropping a
 * non-existent table is a no-op.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqliteQuery from '../Migrations/migrationSQLiteQuery.js';
import mysqlQuery from '../Migrations/migrationMySQLQuery.js';
import postgresQuery from '../Migrations/migrationPostgresQuery.js';

process.env.master = 'droptable';

// ── SQL-shape across all three engines ───────────────────────────────────────

test('every engine emits DROP TABLE IF EXISTS', () => {
    assert.match(new sqliteQuery().dropTable('Backstage'), /DROP TABLE IF EXISTS\s+Backstage/i);
    assert.match(new mysqlQuery().dropTable('Backstage'), /DROP TABLE IF EXISTS\s+`Backstage`/i);
    assert.match(new postgresQuery().dropTable('Backstage'), /DROP TABLE IF EXISTS\s+"Backstage"/i);
});

// ── end-to-end on SQLite: dropping a non-existent table must not throw ─────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.join(__dirname, 'fixtures', 'droptable', 'config', 'environments');
const dbDir = path.join(__dirname, 'fixtures', 'droptable', 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.droptable.json'),
    JSON.stringify({ DropCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');

class DropCtx extends context {
    constructor() { super(); this.env(envDir); }
}

test('SQLite: dropping a table that never existed is a no-op (fresh-DB migration safe)', async () => {
    const ctx = new DropCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Present; CREATE TABLE Present (id INTEGER PRIMARY KEY);');
    const sch = new schemaCls(DropCtx);
    await sch._ensureReady();
    try {
        // A legacy table that only ever existed on old installs.
        await assert.doesNotReject(
            () => sch.dropTable({ __name: 'NeverExistedOnFreshInstall' }),
            'dropping a non-existent table must not throw',
        );
        // Dropping a real table still works, and a second drop is also a no-op.
        await assert.doesNotReject(() => sch.dropTable({ __name: 'Present' }));
        await assert.doesNotReject(() => sch.dropTable({ __name: 'Present' }), 're-dropping must be idempotent');
    } finally {
        await ctx.close();
    }
});
