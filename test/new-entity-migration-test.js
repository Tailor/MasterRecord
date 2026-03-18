/**
 * Test: New entity detection in migrations
 *
 * Verifies that when a new entity is added to a context that already has
 * existing entities (non-empty oldSchema), the migration system correctly
 * includes it in the tables array and detects it as a new table.
 */

const path = require('path');
const Module = require('module');
const __MASTERRECORD_ROOT__ = path.join(__dirname, '..');
const __ORIGINAL_REQUIRE__ = Module.prototype.require;
Module.prototype.require = function(request) {
    if (request === 'masterrecord' || request.startsWith('masterrecord/')) {
        const resolved = request === 'masterrecord'
            ? __MASTERRECORD_ROOT__
            : path.join(__MASTERRECORD_ROOT__, request.slice('masterrecord/'.length));
        return __ORIGINAL_REQUIRE__.call(this, resolved);
    }
    return __ORIGINAL_REQUIRE__.call(this, request);
};

const Migrations = require('../Migrations/migrations');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         New Entity Migration Detection Test                   ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`   ✓ ${label}`);
        passed++;
    } else {
        console.log(`   ✗ ${label}`);
        failed++;
    }
}

const migration = new Migrations();

// Existing entity schema (already in the database)
const userSchema = {
    __name: 'User',
    id: { name: 'id', type: 'integer', primary: true, auto: true },
    name: { name: 'name', type: 'string' },
};

// New entity schema (being added)
const customTaskTypeSchema = {
    __name: 'CustomTaskType',
    id: { name: 'id', type: 'integer', primary: true, auto: true },
    label: { name: 'label', type: 'string' },
};

// -----------------------------------------------------------
// Test 1: First migration (empty oldSchema) — baseline
// -----------------------------------------------------------
console.log("Test 1: First migration (empty oldSchema) includes all entities");
console.log("──────────────────────────────────────────────────");
{
    const oldSchema = [];
    const newSchema = [userSchema, customTaskTypeSchema];

    const result = migration.buildUpObject(oldSchema, newSchema);

    assert(result.User !== undefined, 'User table is in result');
    assert(result.CustomTaskType !== undefined, 'CustomTaskType table is in result');
}

// -----------------------------------------------------------
// Test 2: Subsequent migration — existing entity still works
// -----------------------------------------------------------
console.log("\nTest 2: Subsequent migration — existing entity included");
console.log("──────────────────────────────────────────────────");
{
    const oldSchema = [userSchema];
    const newSchema = [userSchema];

    const result = migration.buildUpObject(oldSchema, newSchema);

    assert(result.User !== undefined, 'User table is in result');
}

// -----------------------------------------------------------
// Test 3: Subsequent migration — NEW entity is included (the bug)
// -----------------------------------------------------------
console.log("\nTest 3: Subsequent migration — new entity is included");
console.log("──────────────────────────────────────────────────");
{
    const oldSchema = [userSchema];
    const newSchema = [userSchema, customTaskTypeSchema];

    const result = migration.buildUpObject(oldSchema, newSchema);

    assert(result.User !== undefined, 'User table is in result');
    assert(result.CustomTaskType !== undefined, 'CustomTaskType table is in result (was undefined before fix)');
}

// -----------------------------------------------------------
// Test 4: hasChanges detects the new entity
// -----------------------------------------------------------
console.log("\nTest 4: hasChanges detects new entity");
console.log("──────────────────────────────────────────────────");
{
    const oldSchema = [userSchema];
    const newSchema = [userSchema, customTaskTypeSchema];

    const changed = migration.hasChanges(oldSchema, newSchema);

    assert(changed === true, 'hasChanges returns true for new entity');
}

// -----------------------------------------------------------
// Test 5: hasChanges returns false when nothing changed
// -----------------------------------------------------------
console.log("\nTest 5: hasChanges returns false when nothing changed");
console.log("──────────────────────────────────────────────────");
{
    const oldSchema = [userSchema];
    const newSchema = [userSchema];

    const changed = migration.hasChanges(oldSchema, newSchema);

    assert(changed === false, 'hasChanges returns false when schemas are identical');
}

// -----------------------------------------------------------
// Test 6: Multiple new entities in one migration
// -----------------------------------------------------------
console.log("\nTest 6: Multiple new entities in one migration");
console.log("──────────────────────────────────────────────────");
{
    const tagSchema = {
        __name: 'Tag',
        id: { name: 'id', type: 'integer', primary: true, auto: true },
        value: { name: 'value', type: 'string' },
    };

    const oldSchema = [userSchema];
    const newSchema = [userSchema, customTaskTypeSchema, tagSchema];

    const result = migration.buildUpObject(oldSchema, newSchema);

    assert(result.User !== undefined, 'User table is in result');
    assert(result.CustomTaskType !== undefined, 'CustomTaskType is in result');
    assert(result.Tag !== undefined, 'Tag is in result');

    const changed = migration.hasChanges(oldSchema, newSchema);
    assert(changed === true, 'hasChanges detects multiple new entities');
}

// Summary
console.log("\n" + "=".repeat(64));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed > 0) {
    process.exit(1);
}
