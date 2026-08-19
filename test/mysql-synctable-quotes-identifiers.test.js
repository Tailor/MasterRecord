/**
 * MySQL syncTable() must backtick-quote identifiers in its inline
 * `ALTER TABLE ... MODIFY COLUMN ...`.
 *
 * Bug: createTable, addColumn (via the query builder) and the Postgres sync
 * branch all quote identifiers, but the MySQL sync path built the MODIFY
 * statement inline WITHOUT backticks:
 *     ALTER TABLE Thing MODIFY COLUMN key VARCHAR(255) ...
 * A column named after a reserved word (`key`, `order`, `group`, …) then blew
 * up with a SQL syntax error when syncTable tried to reconcile its
 * nullability/default. createTable worked because it quotes, so the column
 * migrated in fine and only the later MODIFY failed.
 *
 * Fix: quote both the table and column with backticks, matching every other
 * DDL path.
 *
 * syncTable only reads `this.context.*`, so we drive it with a mock context
 * (no live MySQL needed) and capture the SQL it would execute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import schema from '../Migrations/schema.js';

process.env.master = 'synctable-quote';

test('MySQL syncTable MODIFY COLUMN backtick-quotes a reserved-word column', async () => {
    const executed = [];
    const mockContext = {
        isMySQL: true,
        isSQLite: false,
        isPostgres: false,
        _SQLEngine: {
            // Existing column is nullable; the entity wants it NOT NULL, so
            // syncTable's MySQL branch emits a MODIFY to reconcile it.
            getTableInfo: async () => [
                { name: 'key', is_nullable: 'YES', COLUMN_DEFAULT: null },
            ],
        },
        _execute: async (sql) => { executed.push(sql); },
    };

    // Entity definition: a single column named `key` (a MySQL reserved word).
    const table = {
        __name: 'Thing',
        key: { name: 'key', type: 'string', nullable: false },
    };

    await schema.prototype.syncTable.call({ context: mockContext }, table);

    const modify = executed.find(s => /MODIFY COLUMN/i.test(s));
    assert.ok(modify, `expected a MODIFY COLUMN statement; got: ${JSON.stringify(executed)}`);
    // Both identifiers must be backtick-quoted.
    assert.match(modify, /ALTER TABLE `Thing` MODIFY COLUMN `key`/,
        `MODIFY COLUMN must backtick-quote the table and column; got: ${modify}`);
    // And it must NOT contain the unquoted reserved word as a bare identifier.
    assert.doesNotMatch(modify, /MODIFY COLUMN key\b/,
        `the reserved word must not appear unquoted; got: ${modify}`);
});
