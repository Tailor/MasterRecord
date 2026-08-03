/**
 * Loud failure on a missing table (1.4.1).
 *
 * The framework has NO runtime table auto-creation — all `createTable` paths are
 * migration-driven and every engine already uses `CREATE TABLE IF NOT EXISTS`.
 * What made schema drift silent was the query methods (`all`/`get`/`getCount`)
 * swallowing SQL errors and returning `null` / `[]`. That let a query against a
 * not-yet-migrated table look like "no rows" — so an app built against a SQLite
 * dev database "just worked", then structurally broke against MySQL/Postgres
 * with no warning.
 *
 * Fix: query errors are no longer swallowed. A missing table now throws a loud,
 * actionable masterrecord error naming the table on EVERY engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Tools from '../Tools.js';

process.env.master = 'nomissing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'missing-table');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.nomissing.json'),
    JSON.stringify({ MissCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Widget { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class MissCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Widget); }
}

// ── cross-engine error-signature detection (unit) ────────────────────────────

test('Tools.missingTableName detects all three engines\' signatures', () => {
    // Postgres 42P01
    assert.equal(Tools.missingTableName(new Error('relation "Widget" does not exist')), 'Widget');
    // MySQL ER_NO_SUCH_TABLE
    assert.equal(Tools.missingTableName(new Error("Table 'app_db.Widget' doesn't exist")), 'Widget');
    // SQLite better-sqlite3
    assert.equal(Tools.missingTableName(new Error('no such table: Widget')), 'Widget');
    // Not a missing-table error
    assert.equal(Tools.missingTableName(new Error('some other failure')), null);
    assert.equal(Tools.missingTableName(null), null);
});

test('Tools.missingTableError produces an actionable message or null', () => {
    const e = Tools.missingTableError(new Error('no such table: Widget'));
    assert.ok(e instanceof Error);
    assert.match(e.message, /table 'Widget' does not exist/);
    assert.match(e.message, /migration/i);
    assert.equal(e.missingTable, 'Widget');
    assert.equal(Tools.missingTableError(new Error('unrelated')), null);
});

// ── SQLite end-to-end: a missing table throws instead of returning null ──────

test('SQLite: querying a missing table throws a loud, named error (not silent null)', async () => {
    const ctx = new MissCtx();
    // Ensure the table does NOT exist (no migration was run).
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Widget;');
    try {
        await assert.rejects(
            () => ctx.Widget.toList(),
            (err) => {
                assert.match(err.message, /Widget/);
                assert.match(err.message, /does not exist/);
                return true;
            },
            'toList() against a missing table must throw, not return null'
        );

        await assert.rejects(() => ctx.Widget.where(w => w.id == $$, 1).single(), /does not exist/);
        await assert.rejects(() => ctx.Widget.count(), /does not exist/);
    } finally {
        await ctx.close();
    }
});

test('SQLite: once the table exists, queries work normally (no false positives)', async () => {
    const ctx = new MissCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Widget; CREATE TABLE Widget (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);');
    try {
        const empty = await ctx.Widget.toList();
        assert.deepEqual(empty, [], 'an existing but empty table returns [], not an error');

        const w = ctx.Widget.new(); w.name = 'ok';
        await ctx.saveChanges();
        const rows = await ctx.Widget.toList();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, 'ok');
    } finally {
        await ctx.close();
    }
});
