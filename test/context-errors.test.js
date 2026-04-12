/**
 * Verifies the custom error classes exported from context.js
 * behave correctly (inheritance, name, context metadata).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ContextError,
    ConfigurationError,
    DatabaseConnectionError,
    EntityValidationError,
} from '../context.js';

test('ContextError is a subclass of Error', () => {
    const err = new ContextError('test', { foo: 'bar' });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ContextError);
    assert.equal(err.name, 'ContextError');
    assert.equal(err.message, 'test');
    assert.deepEqual(err.context, { foo: 'bar' });
});

test('ConfigurationError inherits from ContextError', () => {
    const err = new ConfigurationError('bad config');
    assert.ok(err instanceof ContextError);
    assert.ok(err instanceof ConfigurationError);
    assert.equal(err.name, 'ConfigurationError');
});

test('DatabaseConnectionError attaches dbType to context', () => {
    const err = new DatabaseConnectionError('cannot connect', 'mysql', { host: 'localhost' });
    assert.ok(err instanceof ContextError);
    assert.equal(err.context.dbType, 'mysql');
    assert.equal(err.context.host, 'localhost');
});

test('EntityValidationError attaches entityName to context', () => {
    const err = new EntityValidationError('invalid', 'User', { field: 'email' });
    assert.ok(err instanceof ContextError);
    assert.equal(err.context.entityName, 'User');
    assert.equal(err.context.field, 'email');
});
