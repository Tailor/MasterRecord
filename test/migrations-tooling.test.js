/**
 * Migrations tooling (EF Core parity):
 *  - each migration applies ATOMICALLY (DDL + tracking row in one transaction
 *    on SQLite/Postgres) — a failing migration leaves no half-applied schema;
 *  - `migrations-status` lists applied (with timestamps) vs pending;
 *  - `script` prints the SQL for pending migrations WITHOUT applying it;
 *  - `--connection <json>` overrides the env-file connection for a run;
 *  - the snapshot records the latest migration id (EF 11).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cliEntry = path.join(root, 'Migrations', 'cli.js');
const spec = (abs) => 'file://' + abs;

function makeProject({ failing = false } = {}) {
    const projectDir = fs.mkdtempSync(path.join(root, 'test', 'fixtures', 'mig-tooling-'));
    const envDir = path.join(projectDir, 'config', 'environments');
    const modelsDir = path.join(projectDir, 'app', 'models');
    const migrationsDir = path.join(modelsDir, 'db', 'migrations');
    const dbDir = path.join(projectDir, 'db');
    for (const d of [envDir, modelsDir, migrationsDir, dbDir]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'mig-tooling-fixture', type: 'module' }));
    fs.writeFileSync(path.join(envDir, 'env.migtool.json'), JSON.stringify({ toolctx: { type: 'better-sqlite3', connection: dbDir + path.sep } }));
    fs.writeFileSync(path.join(modelsDir, 'toolctx.js'), `
import context from ${JSON.stringify(spec(path.join(root, 'context.js')))};
class Author { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class Book   { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } }
class toolctx extends context {
    constructor() { super(); this.env(${JSON.stringify(envDir)}); this.dbset(Author); this.dbset(Book); }
}
export default toolctx;
`);
    const shape = (name, cols) => { const o = { __name: name, __compositeIndexes: [] }; for (const [c, d] of Object.entries(cols)) o[c] = { ...d, name: c }; return o; };
    const pk = { type: 'integer', primary: true, auto: true, nullable: false, unique: true };
    fs.writeFileSync(path.join(migrationsDir, 'toolctx_contextSnapShot.json'), JSON.stringify({
        contextLocation: path.relative(migrationsDir, path.join(modelsDir, 'toolctx.js')),
        migrationFolder: '.', snapShotLocation: 'toolctx_contextSnapShot.json',
        schema: [shape('Author', { id: pk, name: { type: 'string', nullable: true } }), shape('Book', { id: pk, title: { type: 'string', nullable: true } })],
        seedData: {}, seedConfig: {},
    }, null, 2));
    const mig = (cls, key, extra = '') => `
import masterrecord from ${JSON.stringify(spec(path.join(root, 'MasterRecord.js')))};
class ${cls} extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){ await this.init(table); await this.createTable(table.${key}); ${extra} }
    async down(table){ await this.init(table); await this.dropTable(table.${key}); }
}
export default ${cls};
`;
    fs.writeFileSync(path.join(migrationsDir, `1700000001000_CreateAuthor_migration.js`), mig('CreateAuthor', 'Author'));
    fs.writeFileSync(path.join(migrationsDir, `1700000002000_CreateBook_migration.js`),
        mig('CreateBook', 'Book', failing ? `throw new Error('boom after creating Book');` : ''));
    return { projectDir, dbDir, migrationsDir };
}
const run = (args, cwd, extraEnv = {}) => spawnSync(process.execPath, [cliEntry, ...args], { cwd, env: { ...process.env, master: 'migtool', ...extraEnv }, encoding: 'utf8' });
const dbFile = (dbDir) => path.join(dbDir, 'toolctx.sqlite');
const tables = (f) => { const db = new Database(f); const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(x => x.name); db.close(); return r; };
const appliedRows = (f) => { const db = new Database(f); let r = []; try { r = db.prepare(`SELECT migration_name FROM _masterrecord_migrations`).all().map(x => x.migration_name); } catch (_) {} db.close(); return r; };

test('migrations-status shows pending before and applied after update-database; snapshot records latest migration', () => {
    const { projectDir, dbDir, migrationsDir } = makeProject();
    let r = run(['migrations-status', 'toolctx'], projectDir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Pending \(2\)/);
    assert.match(r.stdout, /1700000001000_CreateAuthor_migration\.js/);

    r = run(['update-database', 'toolctx'], projectDir);
    assert.equal(r.status, 0, `update failed: ${r.stderr}\n${r.stdout}`);
    assert.match(r.stdout, /applied \(transactional\)/, 'SQLite migrations apply transactionally');

    r = run(['migrations-status', 'toolctx'], projectDir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Applied \(2\)/);
    assert.match(r.stdout, /Pending \(0\)/);
    const snap = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'toolctx_contextSnapShot.json'), 'utf8'));
    assert.equal(snap.latestMigration, '1700000002000_CreateBook_migration.js', 'snapshot records the latest migration id (EF 11)');
    assert.match(r.stdout, /Snapshot latest migration: 1700000002000_CreateBook_migration\.js/);
});

test('script prints the SQL for pending migrations and does NOT apply it', () => {
    const { projectDir, dbDir } = makeProject();
    const r = run(['script', 'toolctx'], projectDir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /-- Migration: 1700000001000_CreateAuthor_migration\.js/);
    assert.match(r.stdout, /CREATE TABLE IF NOT EXISTS "?Author"?/i, 'DDL is in the script');
    assert.match(r.stdout, /CREATE TABLE IF NOT EXISTS "?Book"?/i);
    // the history insert is part of the script, and uses LITERAL values so the
    // script a DBA is handed is runnable as-is ('?' placeholders were not)
    assert.match(r.stdout, /INSERT INTO ["[]?_masterrecord_migrations["\]]?/, 'tracking-table insert is part of the script');
    assert.ok(!/INSERT INTO ["[]?_masterrecord_migrations[\s\S]*VALUES \(\?/.test(r.stdout), 'no bind placeholders in the emitted script');
    // Nothing was applied: no Author/Book tables, no tracking rows.
    const f = dbFile(dbDir);
    const t = fs.existsSync(f) ? tables(f) : [];
    assert.ok(!t.includes('Author') && !t.includes('Book'), `script must not create tables; got ${t.join(', ')}`);
    assert.equal(appliedRows(f).length, fs.existsSync(f) ? 0 : 0);

    // --output writes the file
    const out = path.join(projectDir, 'pending.sql');
    const r2 = run(['script', 'toolctx', '--output', out], projectDir);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /CREATE TABLE IF NOT EXISTS "?Author"?/i);
});

test('a failing migration is rolled back atomically: no half-applied table, nothing recorded for it', () => {
    const { projectDir, dbDir } = makeProject({ failing: true });
    const r = run(['update-database', 'toolctx'], projectDir);
    assert.notEqual(r.status, 0, 'update-database exits non-zero on the failing migration');
    const f = dbFile(dbDir);
    const t = tables(f);
    assert.ok(t.includes('Author'), 'first migration committed');
    assert.ok(!t.includes('Book'), 'the failing migration\'s CREATE TABLE was rolled back with its transaction');
    assert.deepEqual(appliedRows(f), ['1700000001000_CreateAuthor_migration.js'], 'only the successful migration is recorded');
});

test('--connection <json> overrides the env-file connection for the run', () => {
    const { projectDir, dbDir } = makeProject();
    const altDir = path.join(projectDir, 'alt-db');
    fs.mkdirSync(altDir, { recursive: true });
    const r = run(['update-database', 'toolctx', '--connection', JSON.stringify({ type: 'better-sqlite3', connection: altDir + path.sep })], projectDir);
    assert.equal(r.status, 0, `update failed: ${r.stderr}\n${r.stdout}`);
    assert.ok(fs.existsSync(path.join(altDir, 'toolctx.sqlite')), 'database created at the overridden location');
    assert.ok(!fs.existsSync(dbFile(dbDir)), 'the env-file location was not used');
    assert.ok(tables(path.join(altDir, 'toolctx.sqlite')).includes('Author'));
});

test('remove-migration deletes the latest PENDING migration; refuses an APPLIED one unless --force, which reverts it first (EF migrations remove)', () => {
    const { projectDir, dbDir, migrationsDir } = makeProject();
    // Pending: just delete the file.
    let r = run(['remove-migration', 'toolctx'], projectDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Removed migration '1700000002000_CreateBook_migration\.js'/);
    assert.ok(!fs.existsSync(path.join(migrationsDir, '1700000002000_CreateBook_migration.js')));
    assert.ok(fs.existsSync(path.join(migrationsDir, '1700000001000_CreateAuthor_migration.js')));

    // Apply the remaining one, then refuse to remove it without --force.
    r = run(['update-database', 'toolctx'], projectDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(appliedRows(dbFile(dbDir)), ['1700000001000_CreateAuthor_migration.js']);
    r = run(['remove-migration', 'toolctx'], projectDir);
    assert.equal(r.status, 1, 'applied migration must be refused');
    assert.match(r.stderr, /has been applied to the database/);
    assert.ok(fs.existsSync(path.join(migrationsDir, '1700000001000_CreateAuthor_migration.js')), 'file untouched');
    assert.ok(tables(dbFile(dbDir)).includes('Author'), 'database untouched');

    // --force: revert (down) then remove; snapshot's latestMigration follows.
    r = run(['remove-migration', 'toolctx', '--force'], projectDir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Reverted '1700000001000_CreateAuthor_migration\.js'/);
    assert.ok(!fs.existsSync(path.join(migrationsDir, '1700000001000_CreateAuthor_migration.js')));
    assert.ok(!tables(dbFile(dbDir)).includes('Author'), 'table dropped by down()');
    assert.deepEqual(appliedRows(dbFile(dbDir)), [], 'tracking row removed');
    const snap = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'toolctx_contextSnapShot.json'), 'utf8'));
    assert.equal(snap.latestMigration, null);
});
