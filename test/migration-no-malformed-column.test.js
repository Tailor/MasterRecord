/**
 * add-migration codegen must never emit malformed no-op column statements.
 *
 * Bug: when the diff couldn't resolve a real column definition, the generator
 * baked lines like `await this.addColumn({"tableName":"X"})` — a column
 * statement with NO column name, which does nothing at apply time and just
 * clutters the migration (31 such lines were seen across 5 generated files and
 * had to be stripped by hand).
 *
 * Fix (defense in depth):
 *  - migrationTemplate.js: addColumn/dropColumn refuse to emit a statement for a
 *    spec that has no `name` (a column statement needs a name to be valid DDL).
 *  - migrations.js #findDeletedColumns: mirror #findNewColumns' `typeof object`
 *    guard so metadata keys (e.g. `__name`, a string) never enter the column
 *    diff as phantom entries.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import MigrationTemplate from '../Migrations/migrationTemplate.js';
import Migrations from '../Migrations/migrations.js';

// ── template-level guard (deterministic) ─────────────────────────────────────

test('template.addColumn skips a spec with no column name', () => {
    const tpl = new MigrationTemplate('X');
    tpl.addColumn('up', { tableName: 'User' });        // malformed: no name
    tpl.addColumn('down', { tableName: 'User' });
    tpl.addColumn('up', { tableName: 'User', name: undefined });
    tpl.addColumn('up', undefined);
    const src = tpl.get();
    assert.doesNotMatch(src, /addColumn/, 'a nameless/blank spec must not emit an addColumn line');
});

test('template.dropColumn skips a spec with no column name', () => {
    const tpl = new MigrationTemplate('X');
    tpl.dropColumn('up', { tableName: 'User' });
    tpl.dropColumn('down', {});
    const src = tpl.get();
    assert.doesNotMatch(src, /dropColumn/, 'a nameless/blank spec must not emit a dropColumn line');
});

test('template.addColumn/dropColumn still emit a well-formed spec', () => {
    const tpl = new MigrationTemplate('X');
    tpl.addColumn('up', { tableName: 'User', name: 'email', type: 'string' });
    tpl.dropColumn('down', { tableName: 'User', name: 'email', type: 'string' });
    const src = tpl.get();
    assert.match(src, /this\.addColumn\(\{[^}]*"name":\s*"email"[^}]*\}\);/);
    assert.match(src, /this\.dropColumn\(\{[^}]*"name":\s*"email"[^}]*\}\);/);
});

// ── end-to-end invariant on a real generated migration ───────────────────────

test('generated migration never emits addColumn/dropColumn without a name', () => {
    const m = new Migrations();
    // 'legacy' exists only in old (a deleted column); 'email' only in new (added).
    const oldSchema = [{
        __name: 'Account', __compositeIndexes: [],
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        legacy: { name: 'legacy', type: 'string' },
    }];
    const newSchema = [{
        __name: 'Account', __compositeIndexes: [],
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        email: { name: 'email', type: 'string' },
    }];
    const code = m.template('AccountChange', oldSchema, newSchema);

    // Every emitted add/dropColumn call must carry a "name".
    const calls = code.match(/this\.(?:addColumn|dropColumn)\(\{[^}]*\}\)/g) || [];
    assert.ok(calls.length > 0, 'expected at least one column statement (add email / drop legacy)');
    for (const c of calls) {
        assert.match(c, /"name"\s*:/, `malformed column call without a name: ${c}`);
    }
    // And specifically none of the reported `{"tableName":"X"}`-only no-ops.
    assert.doesNotMatch(
        code,
        /this\.(?:addColumn|dropColumn)\(\{\s*"tableName"\s*:\s*"[^"]*"\s*\}\)/,
        'must not emit a tableName-only no-op column statement',
    );
});
