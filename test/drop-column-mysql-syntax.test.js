/**
 * Regression: DROP COLUMN on MySQL.
 *
 * The MySQL builder emitted `ALTER TABLE … DROP COLUMN IF EXISTS …`, which
 * MySQL has never supported — `IF EXISTS` on DROP COLUMN is MariaDB syntax.
 * Every drop-column migration therefore failed with ER_PARSE_ERROR against a
 * real MySQL server (8.4 rejects it), and any caller that swallowed migration
 * errors saw the column silently stay behind.
 *
 * The clause is gone; schema.dropColumn() emulates it by probing the live
 * schema first, the way it already did for SQLite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import schema from '../Migrations/schema.js';
import mysqlQuery from '../Migrations/migrationMySQLQuery.js';

test('the MySQL builder does not emit IF EXISTS on DROP COLUMN', () => {
    const sql = new mysqlQuery().dropColumn({ tableName: 'Agent', name: 'public_settings' });
    assert.ok(!/IF\s+EXISTS/i.test(sql), `MySQL does not support it: ${sql}`);
    assert.equal(sql, 'ALTER TABLE `Agent` DROP COLUMN `public_settings`');
});

/** A schema instance wired to a fake MySQL context that records its DDL. */
function stubSchema(existingColumns) {
    const executed = [];
    const s = Object.create(schema.prototype);
    s._ready = true;
    s.fullTable = true;
    s.context = {
        isMySQL: true,
        isPostgres: false,
        isSQLite: false,
        _execute: async (sql) => { executed.push(sql.replace(/\s+/g, ' ').trim()); },
        _SQLEngine: { getTableInfo: async () => existingColumns },
    };
    return { s, executed };
}

test('dropping a column that exists issues the ALTER on MySQL', async () => {
    const { s, executed } = stubSchema([{ name: 'id' }, { name: 'public_settings' }]);
    await s.dropColumn({ tableName: 'Agent', name: 'public_settings' });
    assert.deepEqual(executed, ['ALTER TABLE `Agent` DROP COLUMN `public_settings`']);
});

test('dropping a column that is already gone is a no-op on MySQL', async () => {
    const { s, executed } = stubSchema([{ name: 'id' }]);
    await s.dropColumn({ tableName: 'Agent', name: 'public_settings' });
    assert.deepEqual(executed, [], 'a re-run must not error or emit DDL');
});

test('MySQL information_schema column names are recognised', async () => {
    // getTableInfo maps to `name`, but a caller passing raw information_schema
    // rows (COLUMN_NAME) must not read as "already gone".
    const { s, executed } = stubSchema([{ COLUMN_NAME: 'public_settings' }]);
    await s.dropColumn({ tableName: 'Agent', name: 'public_settings' });
    assert.equal(executed.length, 1, 'the column exists, so it should be dropped');
});
