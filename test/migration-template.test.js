/**
 * Verifies MigrationTemplate emits valid ESM migration source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import MigrationTemplate from '../Migrations/migrationTemplate.js';

test('template emits ESM import of masterrecord', () => {
    const tpl = new MigrationTemplate('CreateUser');
    const src = tpl.get();
    assert.match(src, /^import masterrecord from 'masterrecord';/m);
});

test('template emits ESM export default of class name', () => {
    const tpl = new MigrationTemplate('CreateUser');
    const src = tpl.get();
    assert.match(src, /export default CreateUser;/);
});

test('template never emits CJS syntax', () => {
    const tpl = new MigrationTemplate('AddIndex');
    const src = tpl.get();
    assert.doesNotMatch(src, /require\(/);
    assert.doesNotMatch(src, /module\.exports/);
});

test('template class extends masterrecord.schema', () => {
    const tpl = new MigrationTemplate('RenameColumn');
    const src = tpl.get();
    assert.match(src, /class RenameColumn extends masterrecord\.schema/);
});

test('template has async up and down methods', () => {
    const tpl = new MigrationTemplate('DropTable');
    const src = tpl.get();
    assert.match(src, /async up\(table\)/);
    assert.match(src, /async down\(table\)/);
});

test('createTable appends to up and down methods', () => {
    const tpl = new MigrationTemplate('AddUsers');
    tpl.createTable('up', 'users');
    tpl.createTable('down', 'users');
    const src = tpl.get();
    assert.match(src, /await this\.createTable\(table\.users\);/);
});
