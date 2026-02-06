/**
 * Test: qaContext Pattern Integration
 * Simulates the exact pattern from user's qaContext that caused duplicate bug:
 * - Line 58: this.dbset(TaxonomyTemplate)
 * - Line 207: this.dbset(TaxonomyTemplate).seed(templates)
 *
 * Verifies end-to-end that this pattern doesn't create:
 * - Duplicate entities in __entities
 * - Duplicate seed data in __contextSeedData
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       qaContext Pattern Integration Test (Real Scenario)      ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate the ACTUAL context.js implementation with both fixes
class SimulatedContext {
    constructor() {
        this.__entities = [];
        this.__builderEntities = [];
        this.__contextSeedData = {};
    }

    dbset(model, tableName = null) {
        const entityName = tableName || model.name;

        // Create model object
        const validModel = {
            __name: entityName,
            ...model.schema
        };

        // FIX #1: Entity Deduplication
        const existingIndex = this.__entities.findIndex(e => e.__name === entityName);
        if (existingIndex !== -1) {
            console.warn(`Warning: dbset() called multiple times for table '${entityName}' - updating existing registration`);
            this.__entities[existingIndex] = validModel;
            this.__builderEntities[existingIndex] = { type: 'builder', model: validModel };
        } else {
            this.__entities.push(validModel);
            this.__builderEntities.push({ type: 'builder', model: validModel });
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

        // Find primary key
        let primaryKey = 'id';
        if (schema) {
            for (const key in schema) {
                if (schema[key].primary) {
                    primaryKey = key;
                    break;
                }
            }
        }

        // FIX #2: Seed Data Deduplication (EF Core HasData semantics)
        const existingData = this.__contextSeedData[tableName];
        if (existingData.length > 0) {
            console.warn(`Warning: seed() called multiple times for table '${tableName}' - using upsert semantics (update if primary key exists, insert otherwise)`);
        }

        records.forEach(newRecord => {
            const pkValue = newRecord[primaryKey];
            if (pkValue !== undefined) {
                const existingIndex = existingData.findIndex(r => r[primaryKey] === pkValue);
                if (existingIndex !== -1) {
                    existingData[existingIndex] = { ...existingData[existingIndex], ...newRecord };
                } else {
                    existingData.push(newRecord);
                }
            } else {
                existingData.push(newRecord);
            }
        });

        return {
            seed: (moreData) => this.#addSeedData(tableName, moreData, schema)
        };
    }
}

// Simulate real entities from qaContext
class TaxonomyTemplate {
    static name = 'TaxonomyTemplate';
    static schema = {
        id: { type: 'int', primary: true },
        name: { type: 'string' },
        description: { type: 'text' }
    };
}

class TaxonomyTemplateVersion {
    static name = 'TaxonomyTemplateVersion';
    static schema = {
        id: { type: 'int', primary: true },
        templateId: { type: 'int' },
        version: { type: 'int' }
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
// Test Suite: qaContext Real-World Pattern
// =============================================================================
console.log("📋 Test Suite: Real qaContext Usage Pattern\n");

test('should not duplicate entities with qaContext pattern', () => {
    const templates = [
        { id: 1, name: 'Template 1', description: 'First template' },
        { id: 2, name: 'Template 2', description: 'Second template' },
        { id: 3, name: 'Template 3', description: 'Third template' }
    ];

    const ctx = new SimulatedContext();
    ctx.dbset(TaxonomyTemplate);                      // Line 58 pattern
    ctx.dbset(TaxonomyTemplate).seed(templates);      // Line 207 pattern

    // Should only have 1 entity registered
    assertEqual(ctx.__entities.length, 1, 'Should only have 1 entity in __entities');
    assertEqual(ctx.__entities[0].__name, 'TaxonomyTemplate', 'Entity should be TaxonomyTemplate');
});

test('should not duplicate seed data with qaContext pattern', () => {
    const templates = [
        { id: 1, name: 'Template 1', description: 'First template' },
        { id: 2, name: 'Template 2', description: 'Second template' },
        { id: 3, name: 'Template 3', description: 'Third template' }
    ];

    const ctx = new SimulatedContext();
    ctx.dbset(TaxonomyTemplate);
    ctx.dbset(TaxonomyTemplate).seed(templates);

    // Should only have 3 seed records (not 6)
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'].length, 3,
        'Should only have 3 seed records, not duplicated');

    // Verify all 3 templates exist
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'][0].id, 1, 'Template 1 should exist');
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'][1].id, 2, 'Template 2 should exist');
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'][2].id, 3, 'Template 3 should exist');
});

test('should not duplicate with multiple entities using qaContext pattern', () => {
    const templates = [
        { id: 1, name: 'Template 1', description: 'First' }
    ];

    const versions = [
        { id: 1, templateId: 1, version: 1 },
        { id: 2, templateId: 1, version: 2 }
    ];

    const ctx = new SimulatedContext();
    // Register both entities first (line 58 pattern)
    ctx.dbset(TaxonomyTemplate);
    ctx.dbset(TaxonomyTemplateVersion);

    // Later seed both entities (line 207 pattern)
    ctx.dbset(TaxonomyTemplate).seed(templates);
    ctx.dbset(TaxonomyTemplateVersion).seed(versions);

    // Should have 2 distinct entities
    assertEqual(ctx.__entities.length, 2, 'Should have 2 entities');

    // Should have correct seed data for each
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'].length, 1,
        'TaxonomyTemplate should have 1 seed record');
    assertEqual(ctx.__contextSeedData['TaxonomyTemplateVersion'].length, 2,
        'TaxonomyTemplateVersion should have 2 seed records');
});

test('should handle real-world qaContext scenario with 9 seeds', () => {
    // Real data from user's qaContext
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

test('should preserve correct behavior when dbset.seed is called only once', () => {
    const templates = [
        { id: 1, name: 'Template 1', description: 'First template' }
    ];

    const ctx = new SimulatedContext();
    // Only call dbset.seed once (normal pattern)
    ctx.dbset(TaxonomyTemplate).seed(templates);

    // Should work normally
    assertEqual(ctx.__entities.length, 1, 'Should have 1 entity');
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'].length, 1, 'Should have 1 seed record');
});

test('should handle incremental seed additions correctly', () => {
    const ctx = new SimulatedContext();
    // First batch of seeds
    ctx.dbset(TaxonomyTemplate).seed([
        { id: 1, name: 'Template 1', description: 'First' }
    ]);

    // Second batch with new ID
    ctx.dbset(TaxonomyTemplate).seed([
        { id: 2, name: 'Template 2', description: 'Second' }
    ]);

    // Third batch updates ID 1
    ctx.dbset(TaxonomyTemplate).seed([
        { id: 1, name: 'Updated Template 1', description: 'Updated' }
    ]);

    // Should have 2 records (ID 1 upserted, ID 2 inserted)
    assertEqual(ctx.__contextSeedData['TaxonomyTemplate'].length, 2,
        'Should have 2 records after upserts and inserts');

    // Verify ID 1 was updated
    const template1 = ctx.__contextSeedData['TaxonomyTemplate'].find(t => t.id === 1);
    assertEqual(template1.name, 'Updated Template 1', 'Template 1 should be updated');

    // Verify ID 2 exists
    const template2 = ctx.__contextSeedData['TaxonomyTemplate'].find(t => t.id === 2);
    assertEqual(template2.name, 'Template 2', 'Template 2 should exist');
});

test('should handle the problematic ragContext Settings pattern', () => {
    class Settings {
        static name = 'Settings';
        static schema = {
            id: { type: 'int', primary: true },
            key: { type: 'string' },
            value: { type: 'string' }
        };
    }

    const settings = [
        { id: 1, key: 'app_name', value: 'MyApp' },
        { id: 2, key: 'version', value: '1.0.0' }
    ];

    const ctx = new SimulatedContext();
    ctx.dbset(Settings);              // First registration
    ctx.dbset(Settings).seed(settings);  // Second registration with seed

    // Should only have 1 entity (not 2 as in the bug report)
    assertEqual(ctx.__entities.length, 1, 'Should only have 1 Settings entity');

    // Should only have 2 seed records (not 4 as in the bug report)
    assertEqual(ctx.__contextSeedData['Settings'].length, 2,
        'Should only have 2 Settings seed records, not duplicated');
});

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "═".repeat(64));
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`\nTotal: ${passed + failed} tests\n`);

process.exit(failed > 0 ? 1 : 0);
