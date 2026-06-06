/**
 * Postgres multi-schema support (1.2.1).
 *
 * `PostgresSyncConnect.resolveSearchPath(config)` turns an optional
 * `schema` / `searchPath` connection option into a safe `search_path`
 * value. At connect time that value is applied to every pooled connection
 * via the libpq `options` param, so introspection (current_schemas), DDL,
 * and runtime queries all resolve to the configured schema — closing the
 * "table in a non-search-path schema reads as absent" gap.
 *
 * These unit tests cover the resolution + injection-safe validation (no
 * live Postgres needed). End-to-end behavior depends on the pg `options`
 * startup parameter, which is standard libpq.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import PostgresSyncConnect from '../postgresSyncConnect.js';

const resolve = (c) => PostgresSyncConnect.resolveSearchPath(c);

test('no schema/searchPath → defaults unchanged (null)', () => {
    assert.deepEqual(resolve({}), { searchPath: null, primarySchema: null });
    assert.deepEqual(resolve({ database: 'x' }), { searchPath: null, primarySchema: null });
});

test('single schema → "<schema>,public", primary is the schema', () => {
    assert.deepEqual(resolve({ schema: 'tenant1' }), {
        searchPath: 'tenant1,public',
        primarySchema: 'tenant1',
    });
});

test('explicit searchPath list → preserved; first entry is primary', () => {
    assert.deepEqual(resolve({ searchPath: 'tenant1, shared , public' }), {
        searchPath: 'tenant1,shared,public',
        primarySchema: 'tenant1',
    });
});

test('searchPath takes precedence over schema', () => {
    assert.deepEqual(resolve({ searchPath: 'a,b', schema: 'ignored' }), {
        searchPath: 'a,b',
        primarySchema: 'a',
    });
});

test('rejects injection / invalid identifiers (not parameterizable)', () => {
    for (const bad of [
        { schema: 'a; DROP SCHEMA public CASCADE' },
        { schema: 'a b' },
        { schema: '1abc' },
        { schema: 'a"b' },
        { searchPath: 'ok, bad-name' },
        { searchPath: 'ok, x);DROP' },
    ]) {
        assert.throws(() => resolve(bad), /invalid (schema|searchPath)/i, `should reject ${JSON.stringify(bad)}`);
    }
});

test('underscores and digits (non-leading) are allowed', () => {
    assert.deepEqual(resolve({ schema: '_tenant_2' }), {
        searchPath: '_tenant_2,public',
        primarySchema: '_tenant_2',
    });
});
