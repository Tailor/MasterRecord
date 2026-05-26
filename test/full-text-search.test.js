/**
 * Full-text search across all three engines (1.1.0).
 *
 * Schema-side: createFullTextIndex / dropFullTextIndex emit:
 *   - SQLite:   FTS5 virtual table + AFTER INSERT/UPDATE/DELETE sync triggers
 *   - Postgres: tsvector column + GIN index + maintenance trigger
 *   - MySQL:    ALTER TABLE ADD FULLTEXT INDEX
 *
 * Runtime: ctx.<Entity>.search({ in: [cols], query: 'term' }) emits the
 * right SELECT for the engine and exposes a `__rank` column for ordering.
 *
 * SQLite end-to-end covers real ranking; MySQL/Postgres get string-output
 * tests since we can't run them without live connections.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'fts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'fts');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'ftsctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.fts.json'),
    JSON.stringify({
        FtsCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');
const { default: schemaCls } = await import('../Migrations/schema.js');
const { default: SQLiteQuery } = await import('../Migrations/migrationSQLiteQuery.js');
const { default: MySQLQuery } = await import('../Migrations/migrationMySQLQuery.js');
const { default: PostgresQuery } = await import('../Migrations/migrationPostgresQuery.js');
const { default: SQLiteEngine } = await import('../SQLLiteEngine.js');
const { default: MySQLEngine } = await import('../mySQLEngine.js');
const { default: PostgresEngine } = await import('../postgresEngine.js');

// =====================================================================
// DDL string output — no DB required
// =====================================================================

test('SQLite createFullTextIndex emits FTS5 virtual table + sync triggers', () => {
    const q = new SQLiteQuery();
    const stmts = q.createFullTextIndex({
        tableName: 'MemoryDoc',
        columns: ['title', 'body'],
    });
    // Virtual table with external content
    assert.match(stmts[0], /CREATE VIRTUAL TABLE IF NOT EXISTS \[MemoryDoc_fts\] USING fts5/);
    assert.match(stmts[0], /title, body/);
    assert.match(stmts[0], /content=\[MemoryDoc\]/);
    assert.match(stmts[0], /content_rowid=id/);
    // Three sync triggers (AFTER INSERT, DELETE, UPDATE)
    assert.match(stmts[1], /AFTER INSERT ON \[MemoryDoc\]/);
    assert.match(stmts[2], /AFTER DELETE ON \[MemoryDoc\]/);
    assert.match(stmts[3], /AFTER UPDATE ON \[MemoryDoc\]/);
    assert.equal(stmts.length, 4);
});

test('SQLite dropFullTextIndex drops triggers + virtual table in reverse order', () => {
    const q = new SQLiteQuery();
    const stmts = q.dropFullTextIndex({ tableName: 'MemoryDoc' });
    assert.match(stmts[0], /DROP TRIGGER IF EXISTS \[MemoryDoc_au\]/);
    assert.match(stmts[1], /DROP TRIGGER IF EXISTS \[MemoryDoc_ad\]/);
    assert.match(stmts[2], /DROP TRIGGER IF EXISTS \[MemoryDoc_ai\]/);
    assert.match(stmts[3], /DROP TABLE IF EXISTS \[MemoryDoc_fts\]/);
});

test('Postgres createFullTextIndex emits tsvector + GIN + trigger', () => {
    const q = new PostgresQuery();
    const stmts = q.createFullTextIndex({
        tableName: 'MemoryDoc',
        columns: ['title', 'body'],
    });
    // tsvector column
    assert.match(stmts[0], /ALTER TABLE "MemoryDoc" ADD COLUMN IF NOT EXISTS "__tsv" tsvector/);
    // Backfill
    assert.match(stmts[1], /UPDATE "MemoryDoc" SET "__tsv" = to_tsvector\('english'/);
    // GIN index
    assert.match(stmts[2], /CREATE INDEX IF NOT EXISTS "idx_memorydoc_fts" ON "MemoryDoc" USING GIN \("__tsv"\)/);
    // Trigger function exists and references NEW columns
    assert.match(stmts[3], /CREATE OR REPLACE FUNCTION "memorydoc_tsv_update"/);
    assert.match(stmts[3], /NEW\."title"/);
    assert.match(stmts[3], /NEW\."body"/);
    assert.match(stmts[3], /\$masterrecord\$/);
    // DROP+CREATE trigger
    assert.match(stmts[4], /DROP TRIGGER IF EXISTS "memorydoc_tsv_trigger" ON "MemoryDoc"/);
    assert.match(stmts[5], /CREATE TRIGGER "memorydoc_tsv_trigger" BEFORE INSERT OR UPDATE ON "MemoryDoc"/);
});

test('Postgres dropFullTextIndex drops trigger, function, index, and column', () => {
    const q = new PostgresQuery();
    const stmts = q.dropFullTextIndex({ tableName: 'MemoryDoc' });
    assert.match(stmts[0], /DROP TRIGGER IF EXISTS "memorydoc_tsv_trigger" ON "MemoryDoc"/);
    assert.match(stmts[1], /DROP FUNCTION IF EXISTS "memorydoc_tsv_update"/);
    assert.match(stmts[2], /DROP INDEX IF EXISTS "idx_memorydoc_fts"/);
    assert.match(stmts[3], /ALTER TABLE "MemoryDoc" DROP COLUMN IF EXISTS "__tsv"/);
});

test('Postgres createFullTextIndex honors custom config (language)', () => {
    const q = new PostgresQuery();
    const stmts = q.createFullTextIndex({
        tableName: 'Doc',
        columns: ['body'],
        config: 'spanish',
    });
    assert.match(stmts[1], /to_tsvector\('spanish'/);
    assert.match(stmts[3], /to_tsvector\('spanish'/);
});

test('MySQL createFullTextIndex emits ALTER TABLE ADD FULLTEXT INDEX', () => {
    const q = new MySQLQuery();
    const stmts = q.createFullTextIndex({
        tableName: 'MemoryDoc',
        columns: ['title', 'body'],
    });
    assert.equal(stmts.length, 1);
    assert.match(stmts[0], /ALTER TABLE `MemoryDoc` ADD FULLTEXT INDEX `idx_memorydoc_fts` \(`title`, `body`\)/);
});

test('MySQL dropFullTextIndex emits ALTER TABLE DROP INDEX', () => {
    const q = new MySQLQuery();
    const stmts = q.dropFullTextIndex({ tableName: 'MemoryDoc' });
    assert.equal(stmts.length, 1);
    assert.match(stmts[0], /ALTER TABLE `MemoryDoc` DROP INDEX `idx_memorydoc_fts`/);
});

// =====================================================================
// queryMethods.search() input validation
// =====================================================================

class MemoryDoc {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    body(db) { db.text(); }
    workspaceId(db) { db.integer(); }
}

class FtsCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(MemoryDoc);
    }
}

test('search() requires { in: [...], query: ... }', () => {
    const ctx = new FtsCtx();
    assert.throws(() => ctx.MemoryDoc.search('bare-string'), /requires \{ in/);
    assert.throws(() => ctx.MemoryDoc.search({}), /requires `in:/);
    assert.throws(() => ctx.MemoryDoc.search({ in: [] }), /non-empty array/);
    assert.throws(() => ctx.MemoryDoc.search({ in: ['title'] }), /`query` to be a non-empty string/);
    assert.throws(() => ctx.MemoryDoc.search({ in: ['title'], query: '' }), /non-empty string/);
    ctx.close();
});

// =====================================================================
// SQLite end-to-end ranked search
// =====================================================================

{
    // Seed the SQLite DB + FTS5 index via the real schema API.
    const ctx = new FtsCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS MemoryDoc (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            body TEXT,
            workspaceId INTEGER
        );
    `);

    const sch = new schemaCls(FtsCtx);
    await sch._ensureReady();
    sch.fullTable = { __name: 'MemoryDoc' };
    await sch.createFullTextIndex({ tableName: 'MemoryDoc', columns: ['title', 'body'] });

    // Seed rows AFTER the FTS index so triggers populate the virtual table.
    const insert = ctx._SQLEngine.db.prepare(
        'INSERT INTO MemoryDoc (title, body, workspaceId) VALUES (?, ?, ?)'
    );
    insert.run('Authentication flow', 'user login session token', 1);
    insert.run('Database migrations', 'schema changes postgres sqlite', 1);
    insert.run('Login button styling', 'css button color hover', 1);
    insert.run('Unrelated document', 'absolutely nothing matches here', 2);

    await ctx.close();
}

test('SQLite search returns ranked results with __rank populated', async () => {
    const ctx = new FtsCtx();
    const rows = await ctx.MemoryDoc
        .search({ in: ['title', 'body'], query: 'login' })
        .toList();
    assert.ok(rows.length >= 2, `expected at least 2 results, got ${rows.length}`);
    // Top result must mention 'login' in title or body
    const titles = rows.map(r => r.title);
    assert.ok(titles.some(t => /login/i.test(t)));
    // Every returned row exposes __rank
    for (const r of rows) {
        assert.equal(typeof r.__rank, 'number', `row ${r.id} missing __rank`);
    }
    await ctx.close();
});

test('SQLite search composes with .where() (workspace scoping)', async () => {
    const ctx = new FtsCtx();
    const rows = await ctx.MemoryDoc
        .search({ in: ['title', 'body'], query: 'login' })
        .where('d => d.workspaceId == $$', 1)
        .toList();
    assert.ok(rows.length >= 1);
    for (const r of rows) {
        assert.equal(r.workspaceId, 1, `row ${r.id} not scoped to workspace 1`);
    }
    await ctx.close();
});

test('SQLite search composes with .take() for pagination', async () => {
    const ctx = new FtsCtx();
    const rows = await ctx.MemoryDoc
        .search({ in: ['title', 'body'], query: 'login' })
        .take(1)
        .toList();
    assert.equal(rows.length, 1);
    await ctx.close();
});

test('SQLite search returns empty for terms with no matches', async () => {
    const ctx = new FtsCtx();
    const rows = await ctx.MemoryDoc
        .search({ in: ['title', 'body'], query: 'nonexistentword' })
        .toList();
    assert.equal(rows.length, 0);
    await ctx.close();
});

// =====================================================================
// MySQL/Postgres SQL string output — no live DB needed
// =====================================================================

function buildScript(chainFn) {
    const ctx = new FtsCtx();
    const builder = chainFn(ctx);
    // Mirror what `.toList()` does: bootstrap the entityMap when no prior
    // .where()/.orderBy() chained call has touched it, otherwise buildFrom
    // emits an empty alias and the assertions fail with `.col` (no alias).
    if (builder.__queryObject.script.entityMap.length === 0) {
        builder.__queryObject.skipClause(builder.__entity.__name);
    }
    const script = builder.__queryObject.script;
    const entity = builder.__entity;
    ctx.close();
    return { script, entity };
}

test('MySQL search SQL contains MATCH(...) AGAINST(...) twice and ORDER BY __rank DESC', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.MemoryDoc.search({ in: ['title', 'body'], query: 'auth login' })
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /MATCH\(\w+\.`title`, \w+\.`body`\) AGAINST\(\? IN NATURAL LANGUAGE MODE\) AS __rank/);
    assert.match(out.query, /WHERE MATCH\(\w+\.`title`, \w+\.`body`\) AGAINST\(\? IN NATURAL LANGUAGE MODE\)/);
    assert.match(out.query, /ORDER BY __rank DESC/);
});

test('Postgres search SQL contains ts_rank, @@ predicate, and ORDER BY __rank DESC', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.MemoryDoc.search({ in: ['title', 'body'], query: 'auth login' })
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    assert.match(out.query, /ts_rank\(\w+\."__tsv", plainto_tsquery\(\$\d+\)\) AS __rank/);
    assert.match(out.query, /WHERE \w+\."__tsv" @@ plainto_tsquery\(\$\d+\)/);
    assert.match(out.query, /ORDER BY __rank DESC/);
    // Search term bound twice (once for SELECT, once for WHERE)
    assert.equal(out.params.length, 2);
    assert.equal(out.params[0], 'auth login');
    assert.equal(out.params[1], 'auth login');
});

test('Postgres search composes with prior .where() (parameter ordering preserved)', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.MemoryDoc
            .where('d => d.workspaceId == $$', 42)
            .search({ in: ['title', 'body'], query: 'login' })
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});
    // WHERE has the workspace predicate AND the @@ predicate
    assert.match(out.query, /WHERE.*workspaceId.*AND.*@@/s);
    // Params: workspace 42 first, then search term twice
    assert.equal(out.params[0], 42);
    assert.equal(out.params[1], 'login');
    assert.equal(out.params[2], 'login');
});

test('MySQL search clauses appear in correct SQL order (WHERE before ORDER BY before LIMIT)', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.MemoryDoc.search({ in: ['title', 'body'], query: 'login' }).take(5)
    );
    const engine = new MySQLEngine();
    const out = engine.buildQuery(script, entity, {});
    const whereIdx = out.query.indexOf('WHERE');
    const orderIdx = out.query.indexOf('ORDER BY');
    const limitIdx = out.query.indexOf('LIMIT');
    assert.ok(whereIdx >= 0 && whereIdx < orderIdx, 'WHERE before ORDER BY');
    assert.ok(orderIdx < limitIdx, 'ORDER BY before LIMIT');
});

test('All engines: schema.createFullTextIndex throws if columns missing', async () => {
    const ctx = new FtsCtx();
    const sch = new schemaCls(FtsCtx);
    await sch._ensureReady();
    await assert.rejects(
        sch.createFullTextIndex({ tableName: 'MemoryDoc' }),
        /requires \{ tableName, columns/
    );
    await assert.rejects(
        sch.createFullTextIndex({ columns: ['title'] }),
        /requires \{ tableName, columns/
    );
    await ctx.close();
});
