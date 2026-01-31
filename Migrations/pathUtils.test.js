/**
 * Tests for pathUtils.js - Path resolution for migrations
 *
 * Run with: node pathUtils.test.js
 */

const path = require('path');
const { resolveMigrationsDirectory, isInMigrationsDirectory } = require('./pathUtils');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`❌ Test failed: ${message}`);
    }
    console.log(`✓ ${message}`);
}

console.log('\n🧪 Running pathUtils tests...\n');

// Test 1: Context NOT in migrations folder
const test1 = resolveMigrationsDirectory('/app/models/Context.js');
const expected1 = path.join('/app/models', 'db', 'migrations');
assert(test1 === expected1,
    `Context NOT in migrations: Expected '${expected1}', got '${test1}'`);

// Test 2: Context already IN migrations folder
const test2 = resolveMigrationsDirectory('/app/models/db/migrations/Context.js');
const expected2 = '/app/models/db/migrations';
assert(test2 === expected2,
    `Context IN migrations: Expected '${expected2}', got '${test2}'`);

// Test 3: Context in nested migrations folder
const test3 = resolveMigrationsDirectory('/components/qa/app/models/db/migrations/qaContext.js');
const expected3 = '/components/qa/app/models/db/migrations';
assert(test3 === expected3,
    `Context in nested migrations: Expected '${expected3}', got '${test3}'`);

// Test 4: isInMigrationsDirectory - true case
const test4 = isInMigrationsDirectory('/app/models/db/migrations/Context.js');
assert(test4 === true,
    'isInMigrationsDirectory should return true for path with db/migrations');

// Test 5: isInMigrationsDirectory - false case
const test5 = isInMigrationsDirectory('/app/models/Context.js');
assert(test5 === false,
    'isInMigrationsDirectory should return false for path without db/migrations');

// Test 6: Windows path with backslashes
const test6Windows = '/app\\models\\db\\migrations\\Context.js'.replace(/\\/g, path.sep);
const result6 = isInMigrationsDirectory(test6Windows);
assert(result6 === true,
    'isInMigrationsDirectory should handle Windows paths with backslashes');

console.log('\n✅ All tests passed!\n');
