/**
 * Tests for pathUtils.js - Path resolution for migrations
 */

import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMigrationsDirectory, isInMigrationsDirectory } from './pathUtils.js';

test('resolveMigrationsDirectory: context NOT in migrations folder', () => {
    const result = resolveMigrationsDirectory('/app/models/Context.js');
    const expected = path.join('/app/models', 'db', 'migrations');
    assert.equal(result, expected);
});

test('resolveMigrationsDirectory: context already in migrations folder', () => {
    const result = resolveMigrationsDirectory('/app/models/db/migrations/Context.js');
    assert.equal(result, '/app/models/db/migrations');
});

test('resolveMigrationsDirectory: context in nested migrations folder', () => {
    const result = resolveMigrationsDirectory('/components/qa/app/models/db/migrations/qaContext.js');
    assert.equal(result, '/components/qa/app/models/db/migrations');
});

test('isInMigrationsDirectory: true for path with db/migrations', () => {
    assert.equal(isInMigrationsDirectory('/app/models/db/migrations/Context.js'), true);
});

test('isInMigrationsDirectory: false for path without db/migrations', () => {
    assert.equal(isInMigrationsDirectory('/app/models/Context.js'), false);
});

test('isInMigrationsDirectory: handles Windows paths', () => {
    const winPath = '/app\\models\\db\\migrations\\Context.js'.replace(/\\/g, path.sep);
    assert.equal(isInMigrationsDirectory(winPath), true);
});
