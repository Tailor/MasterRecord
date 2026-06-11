/**
 * Tests for pathUtils.js - Path resolution for migrations
 */

import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMigrationsDirectory, isInMigrationsDirectory, toPosixPath } from './pathUtils.js';

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

test('toPosixPath: converts Windows backslash-relative paths to forward slashes', () => {
    assert.equal(toPosixPath('..\\..\\userContext.js'), '../../userContext.js');
    assert.equal(toPosixPath('db\\migrations\\snap.json'), 'db/migrations/snap.json');
});

test('toPosixPath: leaves POSIX paths and non-strings unchanged', () => {
    assert.equal(toPosixPath('../../userContext.js'), '../../userContext.js');
    assert.equal(toPosixPath('.'), '.');
    assert.equal(toPosixPath(undefined), undefined);
});

test('toPosixPath: a normalized backslash snapshot path resolves to a valid module path', () => {
    // The 42601/ERR_INVALID_MODULE_SPECIFIER failure mode: resolving a
    // backslash-relative contextLocation on POSIX embeds literal backslashes.
    const resolved = path.resolve('/srv/app/db/migrations', toPosixPath('..\\..\\userContext.js'));
    assert.equal(resolved.includes('\\'), false);
    assert.equal(resolved, path.resolve('/srv/app/db/migrations', '../../userContext.js'));
});
