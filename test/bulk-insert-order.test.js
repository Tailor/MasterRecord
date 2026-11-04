/**
 * Multi-row bulkInsert keeps add order on MySQL and Postgres (1.31.2).
 *
 * A multi-value INSERT can only serve rows with the same column list, so a
 * batch with different optional columns needs several statements. Pooling every
 * row of a signature into one statement gave a batch of {name,bio}, {name},
 * {name,bio} the ids 1, 3, 2. SQLite, the single-insert path and the per-row
 * fallback all assign ids in add order, so `ORDER BY id` depended on the engine.
 *
 * Runs without a server (CI is SQLite only): the engine's query runner is stubbed
 * and hands out sequential ids the way a real server would. The same behavior
 * runs for real in test/integration/cross-engine.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import MySQLEngine from '../mySQLEngine.js';
import PostgresEngine from '../postgresEngine.js';

const Profile = {
    __name: 'Profile',
    id: { name: 'id', type: 'integer', primary: true, auto: true },
    name: { name: 'name', type: 'string' },
    bio: { name: 'bio', type: 'string' },
};
const full = (name, bio) => ({ name, bio, __entity: Profile });
const short = (name) => ({ name, __entity: Profile });

/** An engine whose query runner records statements and assigns sequential ids. */
function stubbed(Engine, respond) {
    const engine = new Engine();
    const statements = [];
    let nextId = 1;
    engine._runWithParams = async (sql, params) => {
        statements.push({ sql, params });
        const rowCount = sql.slice(sql.indexOf('VALUES')).match(/\(/g).length;
        const ids = Array.from({ length: rowCount }, () => nextId++);
        return respond(ids);
    };
    return { engine, statements };
}

const ENGINES = [
    { name: 'mysql', Engine: MySQLEngine, respond: (ids) => ({ insertId: ids[0] }) },
    { name: 'postgres', Engine: PostgresEngine, respond: (ids) => ({ rows: ids.map(id => ({ id })) }) },
];

for (const { name, Engine, respond } of ENGINES) {
    test(`[${name}] an interleaved batch writes its rows in add order`, async () => {
        const { engine, statements } = stubbed(Engine, respond);
        const results = await engine.bulkInsert([full('first', 'a'), short('second'), full('third', 'c')]);

        assert.deepEqual(statements.map(s => s.params), [['first', 'a'], ['second'], ['third', 'c']]);
        assert.deepEqual(results.map(r => r.id), [1, 2, 3], 'ids must ascend in add order');
    });

    test(`[${name}] consecutive rows with the same columns share one statement`, async () => {
        const { engine, statements } = stubbed(Engine, respond);
        const results = await engine.bulkInsert([
            full('a', '1'), full('b', '2'), short('c'), short('d'), full('e', '5'),
        ]);

        assert.deepEqual(statements.map(s => s.params), [['a', '1', 'b', '2'], ['c', 'd'], ['e', '5']]);
        assert.deepEqual(results.map(r => r.id), [1, 2, 3, 4, 5]);
    });

    test(`[${name}] a uniform batch stays one statement`, async () => {
        const { engine, statements } = stubbed(Engine, respond);
        const results = await engine.bulkInsert([short('a'), short('b'), short('c')]);

        assert.equal(statements.length, 1);
        assert.deepEqual(results.map(r => r.id), [1, 2, 3]);
    });
}

test('[postgres] placeholders restart at $1 in each statement', async () => {
    const { engine, statements } = stubbed(PostgresEngine, ENGINES[1].respond);
    await engine.bulkInsert([full('a', '1'), short('b'), full('c', '3')]);

    assert.match(statements[0].sql, /VALUES \(\$1, \$2\) RETURNING/);
    assert.match(statements[1].sql, /VALUES \(\$1\) RETURNING/);
    assert.match(statements[2].sql, /VALUES \(\$1, \$2\) RETURNING/);
});
