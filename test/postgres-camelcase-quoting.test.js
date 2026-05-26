/**
 * Regression for the Postgres CamelCase-identifier bug.
 *
 * Symptom: DDL was correctly emitted as CREATE TABLE "SchedulerLeader" (...)
 * but runtime SELECT/UPDATE/DELETE used unquoted identifiers, so Postgres
 * folded `SchedulerLeader` to `schedulerleader` and threw:
 *   ERROR: relation "schedulerleader" does not exist
 *
 * The fix double-quotes every table and column name in generated SQL.
 *
 * These tests build SQL via the engine's pure-function builders (no live
 * Postgres connection required) and assert the resulting SQL contains
 * properly-quoted identifiers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'pgcamelcase';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'pg-camelcase');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'pgcamelctx.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.pgcamelcase.json'),
    JSON.stringify({
        PgCamelCtx: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');
const { default: PostgresEngine } = await import('../postgresEngine.js');

// CamelCase entities — the exact pattern that triggered the production bug.
class SchedulerLeader {
    id(db) { db.integer().primary().auto(); }
    nodeName(db) { db.string(); }
    acquiredAt(db) { db.integer(); }
}

class MemoryDoc {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    body(db) { db.text(); }
}

class PgCamelCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(SchedulerLeader);
        this.dbset(MemoryDoc);
    }
}

// Helper: drive the fluent API through SQLite to get a populated query
// script, then feed it to the Postgres engine builders.
function buildScript(chainFn) {
    const ctx = new PgCamelCtx();
    const builder = chainFn(ctx);
    const script = builder.__queryObject.script;
    const entity = builder.__entity;
    ctx.close();
    return { script, entity };
}

test('Postgres _q helper quotes CamelCase identifiers', () => {
    const engine = new PostgresEngine();
    assert.equal(engine._q('SchedulerLeader'), '"SchedulerLeader"');
    assert.equal(engine._q('nodeName'), '"nodeName"');
    assert.equal(engine._q('lower'), '"lower"');
});

test('Postgres _q helper passes through *', () => {
    const engine = new PostgresEngine();
    assert.equal(engine._q('*'), '*');
});

test('Postgres _q helper escapes embedded double-quotes', () => {
    const engine = new PostgresEngine();
    assert.equal(engine._q('weird"name'), '"weird""name"');
});

test('Postgres _q helper is idempotent (already-quoted passes through)', () => {
    const engine = new PostgresEngine();
    assert.equal(engine._q('"Quoted"'), '"Quoted"');
});

test('Postgres buildFrom emits quoted CamelCase table name with alias', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.SchedulerLeader.where('l => l.nodeName == $$', 'node-1')
    );
    const engine = new PostgresEngine();
    const from = engine.buildFrom(script, entity);
    assert.match(from, /FROM\s+"SchedulerLeader"/, `FROM clause must quote the CamelCase table name. Got: ${from}`);
});

test('Postgres buildWhere emits quoted CamelCase column name and does NOT capitalize it', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.SchedulerLeader.where('l => l.nodeName == $$', 'node-1')
    );
    const engine = new PostgresEngine();
    const where = engine.buildWhere(script, entity);
    assert.match(where, /"nodeName"/, `WHERE clause must use quoted "nodeName" (original case). Got: ${where}`);
    assert.doesNotMatch(where, /"NodeName"/, 'WHERE must NOT capitalize the field — Postgres preserves case when quoted, so "NodeName" would not match the actual "nodeName" column');
});

test('Postgres full buildQuery emits quoted table, alias, and columns', () => {
    const { script, entity } = buildScript((ctx) =>
        ctx.SchedulerLeader
            .where('l => l.nodeName == $$', 'node-1')
            .orderBy('l => l.acquiredAt')
    );
    const engine = new PostgresEngine();
    const out = engine.buildQuery(script, entity, {});

    // Table quoted with alias
    assert.match(out.query, /FROM\s+"SchedulerLeader"\s+AS\s+\w+/);
    // Column names in SELECT are quoted
    assert.match(out.query, /\w+\."id"/);
    assert.match(out.query, /\w+\."nodeName"/);
    // ORDER BY uses original case
    assert.match(out.query, /ORDER BY\s+\w+\."acquiredAt"\s+ASC/);
    // No unquoted CamelCase table name leaking through
    assert.doesNotMatch(out.query, /FROM\s+SchedulerLeader\b/, 'unquoted CamelCase table must not appear');
});

test('Postgres INSERT emits quoted CamelCase table and columns', () => {
    const engine = new PostgresEngine();
    const fields = {
        __entity: { __name: 'MemoryDoc' },
        title: 'hello',
        body: 'world',
    };
    const modelEntity = {
        __name: 'MemoryDoc',
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        title: { name: 'title', type: 'string' },
        body: { name: 'body', type: 'text' },
    };
    const sqlObj = engine._buildSQLInsertObjectParameterized(fields, modelEntity);
    assert.notEqual(sqlObj, -1);
    assert.equal(sqlObj.tableName, 'MemoryDoc');
    assert.match(sqlObj.columns, /"title"/);
    assert.match(sqlObj.columns, /"body"/);
});

test('Postgres UPDATE SET clause quotes each column name', () => {
    const engine = new PostgresEngine();
    const model = {
        __entity: {
            __name: 'SchedulerLeader',
            nodeName: { name: 'nodeName', type: 'string', nullable: true },
            acquiredAt: { name: 'acquiredAt', type: 'integer', nullable: true },
        },
        __dirtyFields: ['nodeName', 'acquiredAt'],
        _nodeName: 'node-2',
        _acquiredAt: 12345,
    };
    const argu = engine._buildSQLEqualToParameterized(model);
    assert.notEqual(argu, -1);
    assert.match(argu.query, /"nodeName"\s*=\s*\$1/);
    assert.match(argu.query, /"acquiredAt"\s*=\s*\$2/);
});

test('Postgres COUNT(*) for untyped count (not COUNT(alias.*) which is invalid)', () => {
    const engine = new PostgresEngine();
    const script = { count: 'none', entityMap: [], parentName: 'SchedulerLeader' };
    const entity = { __name: 'SchedulerLeader' };
    assert.equal(engine.buildCount(script, entity), 'COUNT(*)');
});

test('Postgres DELETE emits quoted CamelCase table and primary key', async () => {
    const engine = new PostgresEngine();
    // Stub out _runWithParams so we can capture the generated SQL without
    // needing a live Postgres connection.
    let capturedSql;
    let capturedParams;
    engine._runWithParams = async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [], rowCount: 0 };
    };
    const queryObject = {
        __entity: {
            __name: 'SchedulerLeader',
            id: { name: 'id', primary: true, auto: true },
            nodeName: { name: 'nodeName' },
        },
        id: 42,
    };
    await engine.delete(queryObject);
    assert.match(capturedSql, /DELETE FROM "SchedulerLeader" WHERE "SchedulerLeader"\."id"\s*=\s*\$1/);
    assert.deepEqual(capturedParams, [42]);
});

test('Postgres UPDATE wraps table and primary key', async () => {
    const engine = new PostgresEngine();
    let capturedSql;
    engine._runWithParams = async (sql, params) => {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
    };
    await engine.update({
        tableName: 'SchedulerLeader',
        primaryKey: 'id',
        primaryKeyValue: 7,
        arg: {
            query: '"nodeName" = $1',
            params: ['node-9'],
        },
    });
    assert.match(capturedSql, /UPDATE "SchedulerLeader" SET "nodeName" = \$1 WHERE "SchedulerLeader"\."id" = \$2/);
});

test('Postgres bulkDelete uses entity primary key (not hardcoded id) and quotes it', async () => {
    const engine = new PostgresEngine();
    let capturedSql;
    engine._runWithParams = async (sql, params) => {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
    };
    await engine.bulkDelete('MemoryDoc', [1, 2, 3], 'docId');
    assert.match(capturedSql, /DELETE FROM "MemoryDoc" WHERE "docId" IN \(\$1, \$2, \$3\)/);
});

test('Postgres bulkDelete defaults to id for back-compat', async () => {
    const engine = new PostgresEngine();
    let capturedSql;
    engine._runWithParams = async (sql, params) => {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
    };
    await engine.bulkDelete('SchedulerLeader', [10, 20]);
    assert.match(capturedSql, /DELETE FROM "SchedulerLeader" WHERE "id" IN \(\$1, \$2\)/);
});
