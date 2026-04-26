/**
 * Verifies db.text() / db.mediumtext() / db.longtext() emit correct
 * column types on each engine.
 *
 *   MySQL    → TEXT, MEDIUMTEXT, LONGTEXT
 *   SQLite   → TEXT, TEXT, TEXT  (SQLite TEXT is unlimited)
 *   Postgres → TEXT, TEXT, TEXT  (Postgres TEXT is unlimited)
 *
 * Also catches the prior bug where SQLite's #typeManager had no `text` case
 * and emitted "<colname> undefined NOT NULL" — accepted by SQLite's lax type
 * affinity but still wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'text-types');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

process.env.master = 'texttypes';
fs.writeFileSync(
    path.join(envDir, 'env.texttypes.json'),
    JSON.stringify({
        TextCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: EntityModel } = await import('../Entity/entityModel.js');
const { default: SQLiteQuery } = await import('../Migrations/migrationSQLiteQuery.js');
const { default: MySQLQuery } = await import('../Migrations/migrationMySQLQuery.js');
const { default: PostgresQuery } = await import('../Migrations/migrationPostgresQuery.js');

//
// EntityModel — the fluent builder must record the new types.
//
test('EntityModel.text() sets type to "text"', () => {
    const m = new EntityModel('m');
    m.text();
    assert.equal(m.obj.type, 'text');
});

test('EntityModel.mediumtext() sets type to "mediumtext"', () => {
    const m = new EntityModel('m');
    m.mediumtext();
    assert.equal(m.obj.type, 'mediumtext');
});

test('EntityModel.longtext() sets type to "longtext"', () => {
    const m = new EntityModel('m');
    m.longtext();
    assert.equal(m.obj.type, 'longtext');
});

//
// MySQL — emits TEXT / MEDIUMTEXT / LONGTEXT
//
test('MySQL emits TEXT for text', () => {
    const q = new MySQLQuery();
    assert.equal(q.typeManager('text'), 'TEXT');
});

test('MySQL emits MEDIUMTEXT for mediumtext', () => {
    const q = new MySQLQuery();
    assert.equal(q.typeManager('mediumtext'), 'MEDIUMTEXT');
});

test('MySQL emits LONGTEXT for longtext', () => {
    const q = new MySQLQuery();
    assert.equal(q.typeManager('longtext'), 'LONGTEXT');
});

//
// Postgres — collapses all three to TEXT (TEXT is unlimited on PG)
//
test('Postgres emits TEXT for text', () => {
    const q = new PostgresQuery();
    assert.equal(q.typeManager('text'), 'TEXT');
});

test('Postgres emits TEXT for mediumtext', () => {
    const q = new PostgresQuery();
    assert.equal(q.typeManager('mediumtext'), 'TEXT');
});

test('Postgres emits TEXT for longtext', () => {
    const q = new PostgresQuery();
    assert.equal(q.typeManager('longtext'), 'TEXT');
});

//
// SQLite — collapses all three to TEXT (TEXT is unlimited on SQLite)
//
test('SQLite createTable for "text" column emits TEXT (regression for missing case)', () => {
    const q = new SQLiteQuery();
    const table = {
        __name: 'Note',
        body: { name: 'body', type: 'text', nullable: true },
    };
    const sql = q.createTable(table);
    assert.match(sql, /\bbody\s+TEXT\b/i, `SQLite should emit "body TEXT"; got ${sql}`);
    assert.doesNotMatch(sql, /undefined/, 'SQLite must not emit "undefined" as a type');
});

test('SQLite createTable for "mediumtext" emits TEXT', () => {
    const q = new SQLiteQuery();
    const table = {
        __name: 'Note',
        body: { name: 'body', type: 'mediumtext', nullable: true },
    };
    const sql = q.createTable(table);
    assert.match(sql, /\bbody\s+TEXT\b/i);
    assert.doesNotMatch(sql, /MEDIUMTEXT/i, 'SQLite has no MEDIUMTEXT type');
});

test('SQLite createTable for "longtext" emits TEXT', () => {
    const q = new SQLiteQuery();
    const table = {
        __name: 'Note',
        body: { name: 'body', type: 'longtext', nullable: true },
    };
    const sql = q.createTable(table);
    assert.match(sql, /\bbody\s+TEXT\b/i);
    assert.doesNotMatch(sql, /LONGTEXT/i, 'SQLite has no LONGTEXT type');
});

//
// End-to-end on SQLite — define an entity with all three text types and
// verify the table is created with TEXT columns.
//
test('SQLite end-to-end: entity with text/mediumtext/longtext creates table with TEXT columns', async () => {
    const { default: context } = await import('../context.js');

    class Document {
        id(db) { db.integer().primary().auto(); }
        small(db) { db.text(); }
        medium(db) { db.mediumtext(); }
        large(db) { db.longtext(); }
    }

    class TextCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Document);
        }
    }

    const ctx = new TextCtx();
    const q = new SQLiteQuery();
    const sql = q.createTable(ctx.Document.__entity);
    assert.match(sql, /\bsmall\s+TEXT\b/i);
    assert.match(sql, /\bmedium\s+TEXT\b/i);
    assert.match(sql, /\blarge\s+TEXT\b/i);
    assert.doesNotMatch(sql, /undefined/);
    await ctx.close();
});
