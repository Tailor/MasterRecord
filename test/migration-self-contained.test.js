/**
 * Self-contained incremental migrations (1.2.3).
 *
 * Root cause fixed: `update-database` re-derives a migration's operand from a
 * live diff — `buildUpObject(committedSnapshot, currentEntities)` — and passes
 * that `table` to `up(table)`. So `await this.addColumn(table.public_token)`
 * only did anything when `public_token` was in the snapshot↔entities diff.
 * Once the committed (shared) snapshot was advanced by the first DB migrated,
 * every subsequent DB diffed to empty → `table.public_token` was undefined →
 * `addColumn` silently no-op'd, yet the migration was recorded applied.
 * (createTable was immune because buildUpObject populates every table.)
 *
 * Fixes:
 *  #1 generation bakes the FULL column spec inline (deterministic replay);
 *  #2 schema.addColumn/dropColumn FAIL LOUDLY on an incomplete operand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Migrations from '../Migrations/migrations.js';

process.env.master = 'selfcontained';
process.env.MR_SILENT_MIGRATIONS = 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'self-contained');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.selfcontained.json'),
    JSON.stringify({ TokenCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');

class TokenCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        // entity registration not needed for these schema-level tests
    }
}

test('#1 generation bakes a self-contained addColumn (no `table.<col>` re-derivation)', () => {
    const m = new Migrations();
    const oldSchema = [{ __name: 'Conversation', __compositeIndexes: [], id: { name: 'id', type: 'integer', primary: true, auto: true } }];
    const newSchema = [{
        __name: 'Conversation', __compositeIndexes: [],
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        public_token: { name: 'public_token', type: 'string' },
    }];
    const code = m.template('AddPublicToken', oldSchema, newSchema);
    // The up() must carry the literal spec, not `table.public_token`.
    assert.match(code, /this\.addColumn\(\{[^}]*"name":\s*"public_token"[^}]*"type":\s*"string"/);
    assert.ok(!/this\.addColumn\(table\./.test(code), 'must not emit the re-derived table.<col> form');
    assert.match(code, /"tableName":\s*"Conversation"/);
});

test('#1 self-contained addColumn applies even when the diff/snapshot is "ahead" (SQLite)', async () => {
    const ctx = new TokenCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Conversation; CREATE TABLE Conversation (id INTEGER PRIMARY KEY, name TEXT);');

    // What a generated, self-contained migration runs — note: no dependence
    // on any diff-populated `table` argument.
    const sch = new schemaCls(TokenCtx);
    await sch._ensureReady();
    await sch.addColumn({ tableName: 'Conversation', name: 'public_token', type: 'string' });

    const cols = (await ctx._SQLEngine.getTableInfo('Conversation')).map(c => c.name);
    assert.ok(cols.includes('public_token'), `column must be added regardless of diff; got ${cols.join(',')}`);
    await ctx.close();
});

test('#2 addColumn throws (no silent no-op) on an incomplete/undefined operand', async () => {
    const sch = new schemaCls(TokenCtx);
    await sch._ensureReady();
    await assert.rejects(() => sch.addColumn(undefined), /incomplete column definition/);
    await assert.rejects(() => sch.addColumn({ tableName: 'X' }), /incomplete column definition/);
    await assert.rejects(() => sch.addColumn({ name: 'y', type: 'string' }), /incomplete column definition/);
});

test('#2 dropColumn throws (no silent no-op) on an incomplete/undefined operand', async () => {
    const sch = new schemaCls(TokenCtx);
    await sch._ensureReady();
    await assert.rejects(() => sch.dropColumn(undefined), /incomplete column definition/);
    await assert.rejects(() => sch.dropColumn({ tableName: 'X' }), /incomplete column definition/);
});

test('#3 addColumn is idempotent — re-running skips when the column already exists (SQLite)', async () => {
    const ctx = new TokenCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS Conv2; CREATE TABLE Conv2 (id INTEGER PRIMARY KEY);');
    const sch = new schemaCls(TokenCtx);
    await sch._ensureReady();

    await sch.addColumn({ tableName: 'Conv2', name: 'token', type: 'string' });   // adds
    await sch.addColumn({ tableName: 'Conv2', name: 'token', type: 'string' });   // must NOT throw — skip-if-exists

    const cols = (await ctx._SQLEngine.getTableInfo('Conv2')).map(c => c.name);
    assert.equal(cols.filter(c => c === 'token').length, 1, 'column must be added exactly once (idempotent)');
    await ctx.close();
});
