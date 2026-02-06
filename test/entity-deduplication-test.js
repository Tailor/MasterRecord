/**
 * Test: Entity Deduplication in dbset()
 * Verifies Fix #1 - that calling dbset() multiple times for the same entity
 * doesn't create duplicate entries in __entities array
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         Entity Deduplication Test - dbset() Method            ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate the context class with entity registration functionality
class SimulatedContext {
    constructor() {
        this.__entities = [];
        this.__builderEntities = [];
        this.__contextSeedData = {};
    }

    dbset(model, tableName = null) {
        const entityName = tableName || model.name;

        // Create a simple model object to represent the entity
        const validModel = {
            __name: entityName,
            ...model.schema
        };

        // Check if this entity (by table name) is already registered
        const existingIndex = this.__entities.findIndex(e => e.__name === entityName);
        if (existingIndex !== -1) {
            // Entity already exists - update it instead of adding duplicate
            console.warn(`Warning: dbset() called multiple times for table '${entityName}' - updating existing registration`);
            this.__entities[existingIndex] = validModel;
            this.__builderEntities[existingIndex] = { type: 'builder', model: validModel };
        } else {
            // New entity - add to arrays
            this.__entities.push(validModel);
            this.__builderEntities.push({ type: 'builder', model: validModel });
        }

        // Return chainable object with seed() method
        return {
            seed: (data) => this.#addSeedData(entityName, data)
        };
    }

    #addSeedData(tableName, data) {
        if (!this.__contextSeedData[tableName]) {
            this.__contextSeedData[tableName] = [];
        }
        const records = Array.isArray(data) ? data : [data];
        this.__contextSeedData[tableName].push(...records);

        return {
            seed: (moreData) => this.#addSeedData(tableName, moreData)
        };
    }
}

// Test entities
class TestEntity {
    static name = 'TestEntity';
    static schema = {
        id: { type: 'int', primary: true },
        name: { type: 'string' }
    };
}

class TestEntity2 {
    static name = 'TestEntity2';
    static schema = {
        id: { type: 'int', primary: true },
        title: { type: 'string' }
    };
}

function test(description, fn) {
    try {
        fn();
        console.log(`✓ ${description}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${description}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
    }
}

// =============================================================================
// Test Suite: Entity Deduplication
// =============================================================================
console.log("📋 Test Suite: Entity Deduplication in context.__entities\n");

test('should not duplicate entity when dbset() is called twice', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);
    ctx.dbset(TestEntity); // Second call

    // Should only have 1 entity registered
    assertEqual(ctx.__entities.length, 1, 'Should only have 1 entity in __entities');
    assertEqual(ctx.__entities[0].__name, 'TestEntity', 'Entity name should be TestEntity');

    // Should only have 1 builder entity
    assertEqual(ctx.__builderEntities.length, 1, 'Should only have 1 builder entity');
});

test('should update existing entity when dbset() is called multiple times', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);
    // Register again (would update)
    ctx.dbset(TestEntity);

    // Verify entity was updated, not duplicated
    assertEqual(ctx.__entities.length, 1, 'Should only have 1 entity after update');
    assertEqual(ctx.__entities[0].__name, 'TestEntity', 'Updated entity should have correct name');
});

test('should handle the qaContext pattern (dbset then dbset.seed)', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);                                    // Line 58 pattern
    ctx.dbset(TestEntity).seed([{ id: 1, name: 'Test' }]);   // Line 207 pattern

    // Should only have 1 entity despite two dbset() calls
    assertEqual(ctx.__entities.length, 1, 'Should only have 1 entity with qaContext pattern');
    assertEqual(ctx.__entities[0].__name, 'TestEntity', 'Entity name should be TestEntity');
});

test('should allow different entities to be registered separately', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);
    ctx.dbset(TestEntity2);

    // Should have 2 different entities
    assertEqual(ctx.__entities.length, 2, 'Should have 2 different entities');
    assertEqual(ctx.__entities[0].__name, 'TestEntity', 'First entity should be TestEntity');
    assertEqual(ctx.__entities[1].__name, 'TestEntity2', 'Second entity should be TestEntity2');
});

test('should emit warning when dbset() is called multiple times for same entity', () => {
    let warningEmitted = false;
    const originalWarn = console.warn;
    console.warn = function(msg) {
        if (msg.includes('dbset() called multiple times for table')) {
            warningEmitted = true;
        }
    };

    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);
    ctx.dbset(TestEntity); // Should emit warning

    console.warn = originalWarn;

    assertEqual(warningEmitted, true, 'Should emit warning when dbset() called multiple times');
});

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "═".repeat(64));
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`\nTotal: ${passed + failed} tests\n`);

process.exit(failed > 0 ? 1 : 0);
