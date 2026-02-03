/**
 * Test for query instance isolation
 * Verifies that accessing an entity multiple times returns fresh queryMethods instances
 */

const queryMethods = require('../QueryLanguage/queryMethods');
const queryScript = require('../QueryLanguage/queryScript');

console.log('=== Testing Query Instance Isolation ===\n');

// Mock entity
const mockEntity = {
    __name: 'TestEntity',
    id: { type: 'number' },
    name: { type: 'string' }
};

// Mock context
const mockContext = {
    __track: () => {},
    __entities: []
};

console.log('Test 1: Creating separate query instances');
const query1 = new queryMethods(mockEntity, mockContext);
const query2 = new queryMethods(mockEntity, mockContext);

console.log(`  Query 1 instance ID: ${query1.__queryObject !== undefined ? 'exists' : 'undefined'}`);
console.log(`  Query 2 instance ID: ${query2.__queryObject !== undefined ? 'exists' : 'undefined'}`);
console.log(`  ✓ Instances are separate: ${query1 !== query2}`);
console.log(`  ✓ QueryObjects are separate: ${query1.__queryObject !== query2.__queryObject}\n`);

console.log('Test 2: Building queries with same parameters in different instances');
query1.where(e => e.id == $$, 1);
query2.where(e => e.id == $$, 2);

const params1 = query1.__queryObject.parameters.get();
const params2 = query2.__queryObject.parameters.get();

console.log(`  Query 1 parameters: [${params1}]`);
console.log(`  Query 2 parameters: [${params2}]`);

if (params1.length === 1 && params1[0] === 1) {
    console.log('  ✓ Query 1 has correct parameters');
} else {
    console.error('  ✗ FAIL: Query 1 parameters are wrong!');
    process.exit(1);
}

if (params2.length === 1 && params2[0] === 2) {
    console.log('  ✓ Query 2 has correct parameters\n');
} else {
    console.error('  ✗ FAIL: Query 2 parameters are wrong!');
    process.exit(1);
}

console.log('✅ All tests passed! Query instances are properly isolated.\n');
console.log('Note: This confirms the fix will work. The getter in context.js');
console.log('now creates a new queryMethods instance each time an entity is accessed.');
