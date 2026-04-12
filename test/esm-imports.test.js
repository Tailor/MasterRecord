/**
 * Verifies that every public entry point in the exports map loads cleanly
 * as ESM and produces the expected default export shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('MasterRecord.js default export has context and schema', async () => {
    const mr = (await import('../MasterRecord.js')).default;
    assert.ok(mr, 'default export exists');
    assert.ok(mr.context, 'has context');
    assert.ok(mr.schema, 'has schema');
});

test('context.js exports default class and named error classes', async () => {
    const mod = await import('../context.js');
    assert.equal(typeof mod.default, 'function', 'default is a class');
    assert.equal(typeof mod.ContextError, 'function');
    assert.equal(typeof mod.ConfigurationError, 'function');
    assert.equal(typeof mod.DatabaseConnectionError, 'function');
    assert.equal(typeof mod.EntityValidationError, 'function');
    assert.equal(typeof mod._poolKey, 'function');
});

test('Tools.js loads as default export', async () => {
    const Tools = (await import('../Tools.js')).default;
    assert.equal(typeof Tools, 'function');
    assert.equal(typeof Tools.capitalize, 'function');
});

test('QueryCache loads and instantiates', async () => {
    const QueryCache = (await import('../Cache/QueryCache.js')).default;
    const cache = new QueryCache({ ttl: 1000, maxSize: 10 });
    assert.ok(cache);
    assert.equal(typeof cache.generateKey, 'function');
});

test('Entity/entityModel loads', async () => {
    const EntityModel = (await import('../Entity/entityModel.js')).default;
    const em = new EntityModel('test');
    assert.equal(em.obj.name, 'test');
});

test('Entity/entityModelBuilder loads', async () => {
    const { default: EMB } = await import('../Entity/entityModelBuilder.js');
    assert.equal(typeof EMB, 'function');
});

test('Entity/entityTrackerModel loads', async () => {
    const { default: ETM } = await import('../Entity/entityTrackerModel.js');
    assert.equal(typeof ETM, 'function');
});

test('Entity/fieldTransformer loads', async () => {
    const { default: FT } = await import('../Entity/fieldTransformer.js');
    assert.equal(typeof FT.hasTransformer, 'function');
});

test('QueryLanguage modules load', async () => {
    const qm = (await import('../QueryLanguage/queryMethods.js')).default;
    const qp = (await import('../QueryLanguage/queryParameters.js')).default;
    const qs = (await import('../QueryLanguage/queryScript.js')).default;
    assert.equal(typeof qm, 'function');
    assert.equal(typeof qp, 'function');
    assert.equal(typeof qs, 'function');
});

test('SQL engines load', async () => {
    const { default: SQLiteEngine } = await import('../SQLLiteEngine.js');
    const { default: MySQLEngine } = await import('../mySQLEngine.js');
    const { default: PostgresEngine } = await import('../postgresEngine.js');
    assert.equal(typeof SQLiteEngine, 'function');
    assert.equal(typeof MySQLEngine, 'function');
    assert.equal(typeof PostgresEngine, 'function');
});

test('Connection clients load', async () => {
    const { default: MySQLAsyncClient } = await import('../mySQLConnect.js');
    const { default: PostgresSyncConnect } = await import('../postgresSyncConnect.js');
    assert.equal(typeof MySQLAsyncClient, 'function');
    assert.equal(typeof PostgresSyncConnect, 'function');
});

test('insertManager and deleteManager load', async () => {
    const { default: InsertManager } = await import('../insertManager.js');
    const { default: DeleteManager } = await import('../deleteManager.js');
    assert.equal(typeof InsertManager, 'function');
    assert.equal(typeof DeleteManager, 'function');
});

test('Migrations/schema loads', async () => {
    const { default: schema } = await import('../Migrations/schema.js');
    assert.equal(typeof schema, 'function');
});

test('Migrations/migrations loads', async () => {
    const { default: Migrations } = await import('../Migrations/migrations.js');
    assert.equal(typeof Migrations, 'function');
});

test('Migrations/migrationTemplate loads', async () => {
    const { default: MT } = await import('../Migrations/migrationTemplate.js');
    assert.equal(typeof MT, 'function');
});

test('Migrations/dependencyGraph loads', async () => {
    const { default: DG } = await import('../Migrations/dependencyGraph.js');
    assert.equal(typeof DG, 'function');
});
