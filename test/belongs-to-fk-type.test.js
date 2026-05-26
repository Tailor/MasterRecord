/**
 * belongsTo FK type resolution (1.1.2).
 *
 * Bug: belongsTo() hardcoded type='integer' on the FK column at entity-
 * definition time, before the parent entity was known. If the parent's PK
 * was string/bigint/uuid, the FK column was still declared INTEGER. SQLite
 * accepted the mismatch (dynamic typing); Postgres and MySQL rejected it.
 *
 * Fix: after each dbset() call, walk every entity and re-resolve every
 * belongsTo column's `type` from its parent's primary-key type. Order-
 * independent, idempotent.
 *
 * Notes for future maintenance:
 *  - EntityModelBuilder only sees own-prototype methods. Test entity classes
 *    must declare their fields directly (no `extends`) or the build silently
 *    produces an empty entity with no PK and the resolver has nothing to copy.
 *  - bigint/uuid go through EntityModel.type('bigint') because EntityModel
 *    doesn't have dedicated bigint()/uuid() field-setter methods.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'fktypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'belongs-to-fk-type');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

fs.writeFileSync(
    path.join(envDir, 'env.fktypes.json'),
    JSON.stringify({
        StringPkCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
        IntPkCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
        OutOfOrderCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
        BigintPkCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
        UuidPkCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
    })
);

const { default: context } = await import('../context.js');
const { default: SQLiteQuery } = await import('../Migrations/migrationSQLiteQuery.js');
const { default: MySQLQuery } = await import('../Migrations/migrationMySQLQuery.js');
const { default: PostgresQuery } = await import('../Migrations/migrationPostgresQuery.js');

// =====================================================================
// Resolver behavior (per parent PK type)
// =====================================================================

test('belongsTo FK type resolves from string PK on parent', () => {
    class Run {
        id(db) { db.string().primary(); }
        name(db) { db.string(); }
    }
    class Step {
        id(db) { db.integer().primary().auto(); }
        name(db) { db.string(); }
        Run(db) { db.belongsTo('Run').notNullable(); }
    }
    class StringPkCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Run);
            this.dbset(Step);
        }
    }
    const ctx = new StringPkCtx();
    const stepEntity = ctx.__entities.find(e => e.__name === 'Step');
    const fk = stepEntity.Run;
    assert.equal(fk.relationshipType, 'belongsTo');
    assert.equal(fk.foreignKey, 'run_id');
    assert.equal(fk.type, 'string', 'FK type should match parent string PK');
});

test('belongsTo FK type stays integer when parent PK is integer', () => {
    class Run {
        id(db) { db.integer().primary().auto(); }
        name(db) { db.string(); }
    }
    class Step {
        id(db) { db.integer().primary().auto(); }
        Run(db) { db.belongsTo('Run').notNullable(); }
    }
    class IntPkCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Run);
            this.dbset(Step);
        }
    }
    const ctx = new IntPkCtx();
    const stepEntity = ctx.__entities.find(e => e.__name === 'Step');
    assert.equal(stepEntity.Run.type, 'integer');
});

test('belongsTo FK type resolves regardless of dbset() order', () => {
    class Run {
        id(db) { db.string().primary(); }
        name(db) { db.string(); }
    }
    class Step {
        id(db) { db.integer().primary().auto(); }
        Run(db) { db.belongsTo('Run').notNullable(); }
    }
    class OutOfOrderCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Step); // child first
            this.dbset(Run);  // parent second
        }
    }
    const ctx = new OutOfOrderCtx();
    const stepEntity = ctx.__entities.find(e => e.__name === 'Step');
    assert.equal(stepEntity.Run.type, 'string', 'resolution must be order-independent');
});

test('belongsTo FK type resolves for bigint parent PK', () => {
    class Run {
        id(db) { db.type('bigint').primary().auto(); }
        name(db) { db.string(); }
    }
    class Step {
        id(db) { db.integer().primary().auto(); }
        Run(db) { db.belongsTo('Run').notNullable(); }
    }
    class BigintPkCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Run);
            this.dbset(Step);
        }
    }
    const ctx = new BigintPkCtx();
    const stepEntity = ctx.__entities.find(e => e.__name === 'Step');
    assert.equal(stepEntity.Run.type, 'bigint');
});

test('belongsTo FK type resolves for uuid parent PK', () => {
    class Run {
        id(db) { db.type('uuid').primary(); }
        name(db) { db.string(); }
    }
    class Step {
        id(db) { db.integer().primary().auto(); }
        Run(db) { db.belongsTo('Run').notNullable(); }
    }
    class UuidPkCtx extends context {
        constructor() {
            super();
            this.env(envDir);
            this.dbset(Run);
            this.dbset(Step);
        }
    }
    const ctx = new UuidPkCtx();
    const stepEntity = ctx.__entities.find(e => e.__name === 'Step');
    assert.equal(stepEntity.Run.type, 'uuid');
});

// =====================================================================
// Migration DDL output — verify each engine emits a matching SQL type.
// Bypasses context; feeds a minimal table-like object straight to the
// migration query builders. Shape mirrors what the resolver produces.
// =====================================================================

function stepTableWith(fkType) {
    return {
        __name: 'Step',
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        name: { name: 'name', type: 'string' },
        Run: {
            name: 'Run',
            type: fkType,
            relationshipType: 'belongsTo',
            foreignTable: 'Run',
            foreignKey: 'run_id',
            nullable: false,
        },
    };
}

test('Postgres createTable emits VARCHAR(255) for FK to string PK', () => {
    const sql = new PostgresQuery().createTable(stepTableWith('string'));
    assert.match(sql, /"run_id"\s+VARCHAR\(255\)/, sql);
    assert.doesNotMatch(sql, /"run_id"\s+INTEGER/);
});

test('Postgres createTable emits INTEGER for FK to integer PK', () => {
    const sql = new PostgresQuery().createTable(stepTableWith('integer'));
    assert.match(sql, /"run_id"\s+INTEGER/, sql);
});

test('Postgres createTable emits BIGINT for FK to bigint PK', () => {
    const sql = new PostgresQuery().createTable(stepTableWith('bigint'));
    assert.match(sql, /"run_id"\s+BIGINT/, sql);
});

test('Postgres createTable emits UUID for FK to uuid PK', () => {
    const sql = new PostgresQuery().createTable(stepTableWith('uuid'));
    assert.match(sql, /"run_id"\s+UUID/, sql);
});

test('MySQL createTable emits VARCHAR(255) for FK to string PK', () => {
    const sql = new MySQLQuery().createTable(stepTableWith('string'));
    assert.match(sql, /`run_id`\s+VARCHAR\(255\)/, sql);
});

test('MySQL createTable emits BIGINT for FK to bigint PK', () => {
    const sql = new MySQLQuery().createTable(stepTableWith('bigint'));
    assert.match(sql, /`run_id`\s+BIGINT/, sql);
});

test('MySQL createTable emits VARCHAR(36) for FK to uuid PK', () => {
    const sql = new MySQLQuery().createTable(stepTableWith('uuid'));
    assert.match(sql, /`run_id`\s+VARCHAR\(36\)/, sql);
});

test('MySQL createTable never emits "undefined" for any FK type', () => {
    for (const t of ['string', 'integer', 'bigint', 'uuid', 'text']) {
        const sql = new MySQLQuery().createTable(stepTableWith(t));
        assert.doesNotMatch(sql, /undefined/, `MySQL ${t}: ${sql}`);
    }
});

test('SQLite createTable emits TEXT for FK to string PK', () => {
    const sql = new SQLiteQuery().createTable(stepTableWith('string'));
    assert.match(sql, /\[?run_id\]?\s+TEXT/i, sql);
});

test('SQLite createTable emits INTEGER for FK to integer PK', () => {
    const sql = new SQLiteQuery().createTable(stepTableWith('integer'));
    assert.match(sql, /\[?run_id\]?\s+INTEGER/i, sql);
});

test('SQLite createTable emits INTEGER for FK to bigint PK', () => {
    const sql = new SQLiteQuery().createTable(stepTableWith('bigint'));
    assert.match(sql, /\[?run_id\]?\s+INTEGER/i, sql);
});

test('SQLite createTable emits TEXT for FK to uuid PK', () => {
    const sql = new SQLiteQuery().createTable(stepTableWith('uuid'));
    assert.match(sql, /\[?run_id\]?\s+TEXT/i, sql);
});
