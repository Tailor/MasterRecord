/**
 * Regression: schema.syncTable() and column nullability on Postgres.
 *
 * 1. Adding a missing column built `{tableName, name, type}` and threw the rest
 *    of the definition away. columnMapping() treats a missing `nullable` as
 *    false, so every column added by a sync came out NOT NULL — even when the
 *    entity declared it optional. The next insert that left the column empty
 *    then failed against a constraint the developer never wrote.
 *
 * 2. There was no Postgres pass reconciling nullability on columns that already
 *    exist (MySQL and SQLite both had one), so a column made NOT NULL by an
 *    older sync stayed that way forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import schema from '../Migrations/schema.js';

/** A schema instance wired to a fake Postgres context that records its DDL. */
function stubSchema(existingColumns) {
    const executed = [];
    const s = Object.create(schema.prototype);
    s._ready = true;
    s.context = {
        isPostgres: true,
        isMySQL: false,
        isSQLite: false,
        _execute: async (sql) => { executed.push(sql.replace(/\s+/g, ' ').trim()); },
        _SQLEngine: {
            getTableInfo: async () => existingColumns,
        },
    };
    return { s, executed };
}

const table = (cols) => ({ __name: 'Widget', ...cols });

test('a nullable column added by syncTable is not marked NOT NULL', async () => {
    const { s, executed } = stubSchema([{ name: 'id', is_nullable: 'NO', dflt_value: null }]);

    await s.syncTable(table({
        id: { name: 'id', type: 'integer', primary: true, auto: true, nullable: false },
        colour: { name: 'colour', type: 'string', nullable: true },
    }));

    const add = executed.find((q) => q.includes('ADD COLUMN'));
    assert.ok(add, 'the missing column should have been added');
    assert.ok(add.includes('"colour"'), `unexpected DDL: ${add}`);
    assert.ok(!add.includes('NOT NULL'), `a nullable column must not be added NOT NULL: ${add}`);
});

test('a required column added by syncTable keeps NOT NULL', async () => {
    const { s, executed } = stubSchema([{ name: 'id', is_nullable: 'NO', dflt_value: null }]);

    await s.syncTable(table({
        id: { name: 'id', type: 'integer', primary: true, auto: true, nullable: false },
        board_id: { name: 'board_id', type: 'integer', nullable: false },
    }));

    const add = executed.find((q) => q.includes('ADD COLUMN'));
    assert.ok(add.includes('NOT NULL'), `a required column must stay NOT NULL: ${add}`);
});

test('an existing NOT NULL column the entity calls optional has the constraint dropped', async () => {
    const { s, executed } = stubSchema([
        { name: 'id', is_nullable: 'NO', dflt_value: null },
        { name: 'colour', is_nullable: 'NO', dflt_value: null },
    ]);

    await s.syncTable(table({
        id: { name: 'id', type: 'integer', primary: true, auto: true, nullable: false },
        colour: { name: 'colour', type: 'string', nullable: true },
    }));

    assert.ok(
        executed.some((q) => q === 'ALTER TABLE "Widget" ALTER COLUMN "colour" DROP NOT NULL'),
        `expected a DROP NOT NULL, got: ${JSON.stringify(executed)}`
    );
});

test('a column that already matches its entity is left alone', async () => {
    const { s, executed } = stubSchema([
        { name: 'id', is_nullable: 'NO', dflt_value: null },
        { name: 'colour', is_nullable: 'YES', dflt_value: null },
    ]);

    await s.syncTable(table({
        id: { name: 'id', type: 'integer', primary: true, auto: true, nullable: false },
        colour: { name: 'colour', type: 'string', nullable: true },
    }));

    assert.deepEqual(executed, [], `no DDL should have run, got: ${JSON.stringify(executed)}`);
});
