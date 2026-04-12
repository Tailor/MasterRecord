/**
 * Verifies the internal _poolKey helper generates stable, unique keys.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _poolKey } from '../context.js';

test('_poolKey generates distinct keys for different MySQL databases', () => {
    const key1 = _poolKey('mysql', { user: 'root', host: 'localhost', port: 3306, database: 'db1' });
    const key2 = _poolKey('mysql', { user: 'root', host: 'localhost', port: 3306, database: 'db2' });
    assert.notEqual(key1, key2);
});

test('_poolKey generates identical keys for identical MySQL configs', () => {
    const cfg = { user: 'root', host: 'localhost', port: 3306, database: 'app' };
    assert.equal(_poolKey('mysql', cfg), _poolKey('mysql', cfg));
});

test('_poolKey uses default port 3306 for MySQL when missing', () => {
    const key = _poolKey('mysql', { user: 'root', host: 'localhost', database: 'app' });
    assert.match(key, /:3306\//);
});

test('_poolKey uses default port 5432 for Postgres when missing', () => {
    const key = _poolKey('postgres', { user: 'postgres', host: 'localhost', database: 'app' });
    assert.match(key, /:5432\//);
});

test('_poolKey distinguishes MySQL and Postgres for same database', () => {
    const cfg = { user: 'u', host: 'h', database: 'app' };
    assert.notEqual(_poolKey('mysql', cfg), _poolKey('postgres', cfg));
});

test('_poolKey uses connection path for sqlite', () => {
    const key = _poolKey('sqlite', { connection: '/tmp/foo.db' });
    assert.equal(key, 'sqlite:/tmp/foo.db');
});

test('_poolKey prefers completeConnection over connection for sqlite', () => {
    const key = _poolKey('sqlite', { connection: '/a', completeConnection: '/b/full.db' });
    assert.equal(key, 'sqlite:/b/full.db');
});
