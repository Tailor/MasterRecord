/**
 * Snapshot determinism (1.2.2) — quirk 2.
 *
 * `buildUpObject()` attached a transient `tableName` to column objects with
 * `columnInfo.new[column].tableName = item.name`. Because `cleanEntities()`
 * shallow-copies, those column objects are shared with the schema that gets
 * serialized into the snapshot — so `tableName` leaked into the snapshot,
 * but only onto the columns that changed that run. Result: non-deterministic
 * snapshots (noisy diffs, spurious "schema changed" detection).
 *
 * Fix: buildUpObject tags a COPY (never the shared object), and
 * createSnapShot normalizes the schema (strips transient `tableName`) before
 * writing. These tests assert no mutation leak and byte-identical output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import Migrations from '../Migrations/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(__dirname, 'fixtures', 'snapshot-determinism');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

function authSchema(withGoogleSub) {
    const cols = {
        __name: 'Auth',
        __compositeIndexes: [],
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        email: { name: 'email', type: 'string' },
    };
    if (withGoogleSub) cols.google_sub = { name: 'google_sub', type: 'string' };
    return [cols];
}

test('buildUpObject does NOT mutate source column objects with tableName', () => {
    const m = new Migrations();
    const oldSchema = authSchema(false);            // existing table without google_sub
    const newSchema = authSchema(true);             // + new column
    m.buildUpObject(oldSchema, newSchema);
    // The new-column path previously did `columnInfo.new[col].tableName = ...`
    assert.ok(!('tableName' in newSchema[0].google_sub), 'new column must not be mutated');
    assert.ok(!('tableName' in newSchema[0].email), 'unchanged column must not be mutated');
    // And the deleted-column path (drop google_sub) must not mutate old schema
    m.buildUpObject(authSchema(true), authSchema(false));
    // (no assertion target persists; just must not throw / mutate shared defs)
});

test('snapshot strips transient tableName and is byte-identical across runs', () => {
    const m = new Migrations();

    function writeAndRead() {
        // Simulate a column that a prior migration-build mutated.
        const schema = authSchema(true);
        schema[0].email.tableName = 'Auth';          // leaked transient field
        m.createSnapShot({
            file: path.join(tmp, 'testctx.js'),
            contextFileName: 'testctx',
            contextEntities: schema,
            contextSeedData: {},
            contextSeedConfig: {},
        });
        const file = globSync('**/testctx_contextSnapShot.json', { cwd: tmp, absolute: true })[0];
        return fs.readFileSync(file, 'utf8');
    }

    const first = writeAndRead();
    const second = writeAndRead();

    assert.equal(first, second, 'two consecutive snapshot generations must be byte-identical');

    const parsed = JSON.parse(first);
    for (const entity of parsed.schema) {
        for (const key of Object.keys(entity)) {
            const v = entity[key];
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                assert.ok(!('tableName' in v), `snapshot column '${key}' must not carry transient tableName`);
            }
        }
    }
    // The real column data must still be present.
    const auth = parsed.schema[0];
    assert.equal(auth.__name, 'Auth');
    assert.equal(auth.email.type, 'string');
    assert.equal(auth.google_sub.name, 'google_sub');
});
