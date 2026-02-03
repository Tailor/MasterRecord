/**
 * Test for double WHERE clause bug fix
 * Verifies that multiple queries don't accumulate parameters
 */

// Note: This test doesn't actually run queries, just tests query building
// No database needed
const queryMethods = require('../QueryLanguage/queryMethods');
const modelBuilder = require('../Entity/entityModelBuilder');

// Mock entity
const mockEntity = {
    __name: 'TestEntity',
    id: { type: 'number' },
    name: { type: 'string' }
};

// Create test context
class TestContext extends context {
    constructor() {
        super();
        this.dbset(mockEntity);
    }
}

console.log('=== Testing double WHERE clause bug fix ===\n');

try {
    const ctx = new TestContext();

    // Access the entity multiple times and build queries
    console.log('Test 1: Multiple separate queries should not share state');
    const query1 = ctx.TestEntity.where(e => e.id == $$, 1);
    const query2 = ctx.TestEntity.where(e => e.id == $$, 2);

    // Check that they have different queryObject instances
    const haveDifferentInstances = query1.__queryObject !== query2.__queryObject;
    console.log(`  ✓ Query instances are separate: ${haveDifferentInstances}`);

    // Check parameter accumulation
    const params1 = query1.__queryObject.parameters.get();
    const params2 = query2.__queryObject.parameters.get();

    console.log(`  Query 1 parameters: [${params1}]`);
    console.log(`  Query 2 parameters: [${params2}]`);

    if (params1.length === 1 && params1[0] === 1 && params2.length === 1 && params2[0] === 2) {
        console.log('  ✓ Parameters are correctly isolated\n');
    } else {
        console.error('  ✗ FAIL: Parameters are not isolated!\n');
        process.exit(1);
    }

    console.log('Test 2: Accessing entity property multiple times returns fresh instances');
    const instance1 = ctx.TestEntity;
    const instance2 = ctx.TestEntity;
    const areDifferent = instance1 !== instance2;
    console.log(`  ✓ Each access returns a new instance: ${areDifferent}\n`);

    if (!areDifferent) {
        console.error('  ✗ FAIL: Instances are being reused!\n');
        process.exit(1);
    }

    console.log('✅ All tests passed! Double WHERE bug is fixed.\n');

} catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
}
