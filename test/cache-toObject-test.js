/**
 * Test to verify caching properly handles entity reconstruction
 */
const assert = require('assert');
const context = require('../context');

describe('Cache Entity Reconstruction Test', function() {
    let db;

    before(async function() {
        // Create in-memory SQLite database
        db = new context({ filename: ":memory:", type: "SQLLite" });

        // Define a test entity
        db.TestEntity = {
            __name: "TestEntity",
            id: db.EntityModel("id").integer().primary().auto(),
            name: db.EntityModel("name").string(),
            description: db.EntityModel("description").string()
        };

        await db.initialize();
    });

    after(async function() {
        if (db && db.close) {
            await db.close();
        }
    });

    it('should properly return cached single entity with toObject method', async function() {
        // Insert test data
        const entity = db.TestEntity.create();
        entity.name = "Test Item";
        entity.description = "Test Description";
        await db.saveChanges();

        // First query (cache miss) - with caching enabled
        const result1 = await db.TestEntity.cache().where(t => t.id === entity.id).single();

        assert(result1, 'First query should return result');
        assert.strictEqual(result1.name, "Test Item");
        assert(typeof result1.toObject === 'function', 'Result should have toObject method');

        // Convert to plain object should work
        const plain1 = result1.toObject();
        assert.strictEqual(plain1.name, "Test Item");

        // Second query (cache hit) - should return entity with methods
        const result2 = await db.TestEntity.cache().where(t => t.id === entity.id).single();

        assert(result2, 'Cached query should return result');
        assert.strictEqual(result2.name, "Test Item");
        assert(typeof result2.toObject === 'function', 'Cached result should have toObject method');

        // toObject should work on cached entity
        const plain2 = result2.toObject();
        assert.strictEqual(plain2.name, "Test Item");
    });

    it('should properly return cached list with toObject methods', async function() {
        // Clear any existing data
        const existing = await db.TestEntity.toList();
        for (const item of existing) {
            await item.delete();
        }
        await db.saveChanges();

        // Insert test data
        const entity1 = db.TestEntity.create();
        entity1.name = "Item 1";
        const entity2 = db.TestEntity.create();
        entity2.name = "Item 2";
        await db.saveChanges();

        // First query (cache miss)
        const list1 = await db.TestEntity.cache().toList();

        assert(Array.isArray(list1), 'First query should return array');
        assert.strictEqual(list1.length, 2);
        assert(typeof list1[0].toObject === 'function', 'First item should have toObject method');
        assert(typeof list1[1].toObject === 'function', 'Second item should have toObject method');

        const plain1 = list1[0].toObject();
        assert.strictEqual(plain1.name, "Item 1");

        // Second query (cache hit)
        const list2 = await db.TestEntity.cache().toList();

        assert(Array.isArray(list2), 'Cached query should return array');
        assert.strictEqual(list2.length, 2, 'Cached array should have correct length');
        assert(typeof list2[0].toObject === 'function', 'Cached first item should have toObject method');
        assert(typeof list2[1].toObject === 'function', 'Cached second item should have toObject method');

        const plain2 = list2[0].toObject();
        assert.strictEqual(plain2.name, "Item 1");
    });

    it('should handle null results properly', async function() {
        // Query for non-existent entity
        const result = await db.TestEntity.cache().where(t => t.id === 99999).single();

        assert.strictEqual(result, null, 'Non-existent entity should return null');
    });
});
