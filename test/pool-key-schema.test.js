/**
 * Connection-pool cache key must account for the Postgres schema / search_path
 * (1.4.4).
 *
 * Bug: `_poolKey` keyed a Postgres pool by type:user@host:port/database only. The
 * schema (search_path) is a PER-CONNECTION setting, so two contexts on the same
 * database but different schemas got the SAME key and shared one pooled
 * connection — the second context reused the first's connection (search_path
 * already set) and its CREATE TABLE / queries landed in the WRONG schema. This
 * surfaced as update-database-all creating tables in the wrong schemas across
 * contexts.
 *
 * Fix: fold the resolved search_path into the pool key for Postgres.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _poolKey } from '../context.js';

const base = { type: 'postgres', host: 'db.example', port: 5432, user: 'app', database: 'appdb' };

test('different Postgres schemas produce DIFFERENT pool keys (no wrong-schema sharing)', () => {
    const a = _poolKey('postgres', { ...base, schema: 'tenant1' });
    const b = _poolKey('postgres', { ...base, schema: 'tenant2' });
    assert.notEqual(a, b, `same-db/different-schema must not share a pool: ${a} === ${b}`);
});

test('same Postgres schema shares a pool (stable key)', () => {
    const a = _poolKey('postgres', { ...base, schema: 'reporting' });
    const b = _poolKey('postgres', { ...base, schema: 'reporting' });
    assert.equal(a, b);
});

test('`schema` and its equivalent `searchPath` resolve to the same key (share a pool)', () => {
    // { schema: 't1' } resolves to search_path 't1,public'; an explicit
    // searchPath of 't1,public' is the same effective connection.
    const viaSchema = _poolKey('postgres', { ...base, schema: 't1' });
    const viaSearchPath = _poolKey('postgres', { ...base, searchPath: 't1,public' });
    assert.equal(viaSchema, viaSearchPath);
});

test('no schema → key carries no schema segment (default search_path)', () => {
    const k = _poolKey('postgres', base);
    assert.ok(!k.includes('#'), `no-schema key should not include a schema segment: ${k}`);
    assert.equal(k, 'postgres:app@db.example:5432/appdb');
});

test('different databases are still separated regardless of schema', () => {
    const a = _poolKey('postgres', { ...base, database: 'db_a', schema: 's' });
    const b = _poolKey('postgres', { ...base, database: 'db_b', schema: 's' });
    assert.notEqual(a, b);
});

test('MySQL and SQLite keys are unaffected by the Postgres schema logic', () => {
    assert.equal(_poolKey('mysql', { host: 'h', port: 3306, user: 'u', database: 'db' }), 'mysql:u@h:3306/db');
    assert.equal(_poolKey('sqlite', { connection: '/tmp/x/' }), 'sqlite:/tmp/x/');
});
