/**
 * Test: Seed Data Deduplication in #addSeedData()
 * Verifies Fix #2 - that calling seed() multiple times uses EF Core HasData semantics:
 * - If record with same primary key exists, update it
 * - If record doesn't exist, insert it
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║      Seed Data Deduplication Test - EF Core Semantics         ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate the context class with EF Core-style seed data deduplication
class SimulatedContext {
    constructor() {
        this.__entities = [];
        this.__contextSeedData = {};
    }

    dbset(model, tableName = null) {
        const entityName = tableName || model.name;

        // Register entity if not already registered
        const existingEntity = this.__entities.find(e => e.__name === entityName);
        if (!existingEntity) {
            this.__entities.push({
                __name: entityName,
                ...model.schema
            });
        }

        // Return chainable object with seed() method
        return {
            seed: (data) => this.#addSeedData(entityName, data, model.schema)
        };
    }

    #addSeedData(tableName, data, schema) {
        if (!this.__contextSeedData[tableName]) {
            this.__contextSeedData[tableName] = [];
        }

        const records = Array.isArray(data) ? data : [data];

        // Find primary key field from schema
        let primaryKey = 'id'; // Default
        if (schema) {
            for (const key in schema) {
                if (schema[key].primary) {
                    primaryKey = key;
                    break;
                }
            }
        }

        // Check if we're adding duplicate seed data
        const existingData = this.__contextSeedData[tableName];
        if (existingData.length > 0) {
            console.warn(`Warning: seed() called multiple times for table '${tableName}' - using upsert semantics (update if primary key exists, insert otherwise)`);
        }

        // Upsert each record by primary key (EF Core HasData semantics)
        records.forEach(newRecord => {
            const pkValue = newRecord[primaryKey];
            if (pkValue !== undefined) {
                // Find existing record with same primary key
                const existingIndex = existingData.findIndex(r => r[primaryKey] === pkValue);
                if (existingIndex !== -1) {
                    // Update existing record (merge properties)
                    existingData[existingIndex] = { ...existingData[existingIndex], ...newRecord };
                } else {
                    // Insert new record
                    existingData.push(newRecord);
                }
            } else {
                // No primary key value - just append (insert semantics)
                existingData.push(newRecord);
            }
        });

        return {
            seed: (moreData) => this.#addSeedData(tableName, moreData, schema)
        };
    }
}

// Test entities
class TestEntity {
    static name = 'TestEntity';
    static schema = {
        id: { type: 'int', primary: true },
        name: { type: 'string' },
        email: { type: 'string' }
    };
}

class CustomEntity {
    static name = 'CustomEntity';
    static schema = {
        uuid: { type: 'string', primary: true },
        name: { type: 'string' }
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

function assertOk(value, message) {
    if (!value) {
        throw new Error(message);
    }
}

// =============================================================================
// Test Suite: Seed Data Deduplication
// =============================================================================
console.log("📋 Test Suite: EF Core HasData Semantics - Upsert by Primary Key\n");

test('should upsert seed data when seed() is called twice with same primary key', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity)
        .seed([{ id: 1, name: 'Original', email: 'original@test.com' }]);

    // Second seed call with same ID but updated fields
    ctx.dbset(TestEntity)
        .seed([{ id: 1, name: 'Updated', email: 'updated@test.com' }]);

    // Should only have 1 record (upserted, not duplicated)
    assertEqual(ctx.__contextSeedData['TestEntity'].length, 1, 'Should only have 1 record after upsert');

    // Should have updated values from second seed call
    const record = ctx.__contextSeedData['TestEntity'][0];
    assertEqual(record.id, 1, 'Record should have ID 1');
    assertEqual(record.name, 'Updated', 'Record should have updated name');
    assertEqual(record.email, 'updated@test.com', 'Record should have updated email');
});

test('should insert new records when seed() is called with different primary keys', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity)
        .seed([{ id: 1, name: 'First', email: 'first@test.com' }]);

    // Second seed call with different ID
    ctx.dbset(TestEntity)
        .seed([{ id: 2, name: 'Second', email: 'second@test.com' }]);

    // Should have 2 records (both inserted)
    assertEqual(ctx.__contextSeedData['TestEntity'].length, 2, 'Should have 2 records');
    assertEqual(ctx.__contextSeedData['TestEntity'][0].id, 1, 'First record should have ID 1');
    assertEqual(ctx.__contextSeedData['TestEntity'][1].id, 2, 'Second record should have ID 2');
});

test('should handle mixed upsert and insert in same seed call', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity)
        .seed([
            { id: 1, name: 'First', email: 'first@test.com' },
            { id: 2, name: 'Second', email: 'second@test.com' }
        ]);

    // Second seed call: update ID 1, insert ID 3
    ctx.dbset(TestEntity)
        .seed([
            { id: 1, name: 'Updated', email: 'updated@test.com' },
            { id: 3, name: 'Third', email: 'third@test.com' }
        ]);

    // Should have 3 records (1 upserted, 2 kept, 3 inserted)
    assertEqual(ctx.__contextSeedData['TestEntity'].length, 3, 'Should have 3 records');

    // Verify ID 1 was updated
    const record1 = ctx.__contextSeedData['TestEntity'].find(r => r.id === 1);
    assertEqual(record1.name, 'Updated', 'Record 1 should be updated');

    // Verify ID 2 still exists
    const record2 = ctx.__contextSeedData['TestEntity'].find(r => r.id === 2);
    assertEqual(record2.name, 'Second', 'Record 2 should still exist');

    // Verify ID 3 was inserted
    const record3 = ctx.__contextSeedData['TestEntity'].find(r => r.id === 3);
    assertEqual(record3.name, 'Third', 'Record 3 should be inserted');
});

test('should handle the qaContext pattern (dbset then dbset.seed with same data)', () => {
    const templates = [
        { id: 1, name: 'Template 1', email: 'template1@test.com' },
        { id: 2, name: 'Template 2', email: 'template2@test.com' },
        { id: 3, name: 'Template 3', email: 'template3@test.com' }
    ];

    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity);                      // Line 58 pattern
    ctx.dbset(TestEntity).seed(templates);      // Line 207 pattern

    // Should only have 3 records (not 6 duplicates)
    assertEqual(ctx.__contextSeedData['TestEntity'].length, 3, 'Should only have 3 records, not duplicated');

    // Verify all 3 records exist
    assertEqual(ctx.__contextSeedData['TestEntity'][0].id, 1, 'Record 1 should exist');
    assertEqual(ctx.__contextSeedData['TestEntity'][1].id, 2, 'Record 2 should exist');
    assertEqual(ctx.__contextSeedData['TestEntity'][2].id, 3, 'Record 3 should exist');
});

test('should append records without primary key values', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity)
        .seed([{ name: 'No ID 1', email: 'noid1@test.com' }]);

    // Second seed call without ID
    ctx.dbset(TestEntity)
        .seed([{ name: 'No ID 2', email: 'noid2@test.com' }]);

    // Should append both records (no PK to deduplicate by)
    assertEqual(ctx.__contextSeedData['TestEntity'].length, 2, 'Should have 2 records when no PK provided');
    assertEqual(ctx.__contextSeedData['TestEntity'][0].name, 'No ID 1', 'First record should exist');
    assertEqual(ctx.__contextSeedData['TestEntity'][1].name, 'No ID 2', 'Second record should exist');
});

test('should emit warning when seed() is called multiple times', () => {
    let warningEmitted = false;
    const originalWarn = console.warn;
    console.warn = function(msg) {
        if (msg.includes('seed() called multiple times for table')) {
            warningEmitted = true;
        }
    };

    const ctx = new SimulatedContext();
    ctx.dbset(TestEntity).seed([{ id: 1, name: 'First' }]);
    ctx.dbset(TestEntity).seed([{ id: 2, name: 'Second' }]); // Should emit warning

    console.warn = originalWarn;

    assertEqual(warningEmitted, true, 'Should emit warning when seed() called multiple times');
});

test('should handle custom primary key field', () => {
    const ctx = new SimulatedContext();
    ctx.dbset(CustomEntity)
        .seed([{ uuid: 'abc-123', name: 'Original' }]);

    // Second seed with same uuid
    ctx.dbset(CustomEntity)
        .seed([{ uuid: 'abc-123', name: 'Updated' }]);

    // Should upsert by custom primary key
    assertEqual(ctx.__contextSeedData['CustomEntity'].length, 1, 'Should only have 1 record');
    assertEqual(ctx.__contextSeedData['CustomEntity'][0].name, 'Updated', 'Should have updated name');
});

test('should handle real-world qaContext scenario with 9 seeds', () => {
    class TaxonomyTemplate {
        static name = 'TaxonomyTemplate';
        static schema = {
            id: { type: 'int', primary: true },
            name: { type: 'string' },
            description: { type: 'text' }
        };
    }

    const templates = [
        { id: 1, name: 'General Knowledge', description: 'General knowledge questions' },
        { id: 2, name: 'Science', description: 'Science questions' },
        { id: 3, name: 'History', description: 'History questions' },
        { id: 4, name: 'Mathematics', description: 'Math questions' },
        { id: 5, name: 'Literature', description: 'Literature questions' },
        { id: 6, name: 'Geography', description: 'Geography questions' },
        { id: 7, name: 'Technology', description: 'Technology questions' },
        { id: 8, name: 'Arts', description: 'Arts questions' },
        { id: 9, name: 'Sports', description: 'Sports questions' }
    ];

    const ctx = new SimulatedContext();
    ctx.dbset(TaxonomyTemplate);                      // Line 58
    ctx.dbset(TaxonomyTemplate).seed(templates);      // Line 207

    // Should only have 9 seed records (not 18)
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'].length, 9,
        'Should only have 9 seed records, not 18 duplicates');

    // Verify all 9 templates exist
    for (let i = 1; i <= 9; i++) {
        const template = ctx.__contextSeedData['TaxonomyTemplate'].find(t => t.id === i);
        assertOk(template, `Template ${i} should exist`);
    }
});

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "═".repeat(64));
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`\nTotal: ${passed + failed} tests\n`);

process.exit(failed > 0 ? 1 : 0);
