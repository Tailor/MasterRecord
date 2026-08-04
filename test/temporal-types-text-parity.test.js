/**
 * Every engine stores temporal types (time/date/datetime/timestamp) as TEXT,
 * for cross-engine portability (1.4.7 Postgres, 1.4.8 MySQL).
 *
 * Bug: SQLite deliberately maps all temporal types to TEXT, but Postgres mapped
 * them to native TIMESTAMP/DATE/TIME and MySQL to native DATETIME/TIMESTAMP/
 * DATE/TIME. masterrecord apps write epoch-millis / ISO strings into these
 * columns via entity hooks (`db.get((v) => v || Date.now())`). A native temporal
 * column rejects a bigint at INSERT time:
 *   Postgres — 'column "created_at" is of type time ... but expression is of type bigint'
 *   MySQL    — 'Incorrect datetime value'
 * so the same app that ran on SQLite failed the moment it targeted PG or MySQL.
 *
 * Fix: all three engines resolve temporal types to TEXT, matching SQLite. This
 * test pins that contract on every engine so it can never silently diverge again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';

process.env.master = 'temporal-parity';

const TEMPORAL = ['time', 'date', 'datetime', 'timestamp'];

// SQLite exposes resolveColumnType(); MySQL/Postgres expose typeManager().
const ENGINES = [
    ['sqlite', new SQLiteQuery(), (q, t) => q.resolveColumnType(t)],
    ['mysql', new MySQLQuery(), (q, t) => q.typeManager(t)],
    ['postgres', new PostgresQuery(), (q, t) => q.typeManager(t)],
];

test('every engine maps temporal types to TEXT (cross-engine portability)', () => {
    for (const t of TEMPORAL) {
        for (const [name, q, resolve] of ENGINES) {
            assert.equal(
                resolve(q, t),
                'TEXT',
                `${name} type('${t}') must resolve to TEXT so epoch-millis / ISO strings insert cleanly on every engine`,
            );
        }
    }
});
