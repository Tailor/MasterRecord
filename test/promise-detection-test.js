/**
 * Test: Promise / non-primitive detection in InsertManager.validateEntity()
 *
 * Verifies that assigning a Promise, Array, or plain Object to a scalar
 * entity column produces a clear validation error instead of being silently
 * dropped from the INSERT statement.
 */

// Alias 'masterrecord' to local root so insertManager's require('masterrecord/...') resolves
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

const InsertManager = require('../insertManager');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         Promise / Non-Primitive Detection Test                ║");
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

// Minimal stubs — we only need validateEntity(), no SQL engine
function makeErrorModel() {
    return { isValid: true, errors: [] };
}

function makeManager() {
    const err = makeErrorModel();
    const mgr = new InsertManager(null, err, []);
    return { mgr, err };
}

// Entity definition for a simple "User" table
const entityModel = {
    __name: 'User',
    id:        { type: 'integer', primary: true, auto: true, nullable: true },
    user_name: { type: 'string', nullable: false },
    age:       { type: 'integer', nullable: true },
    role:      { type: 'string', nullable: true },
};

// -----------------------------------------------------------
// Test 1: Promise assigned to a string column
// -----------------------------------------------------------
console.log("Test 1: Promise on string column");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = { user_name: Promise.resolve('alice'), age: 25, __entity: entityModel };
    const cleanModel = { user_name: Promise.resolve('alice'), age: 25, __entity: entityModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(!err.isValid, 'Validation fails');
    assert(err.errors.length === 1, 'Exactly one error');
    assert(err.errors[0].includes('Promise'), 'Error mentions Promise');
    assert(err.errors[0].includes('user_name'), 'Error mentions field name');
    assert(err.errors[0].includes('await'), 'Error suggests await');
}

// -----------------------------------------------------------
// Test 2: Array assigned to a string column
// -----------------------------------------------------------
console.log("\nTest 2: Array on string column");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = { user_name: 'alice', role: ['admin', 'user'], __entity: entityModel };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(!err.isValid, 'Validation fails');
    assert(err.errors[0].includes('Array'), 'Error mentions Array');
    assert(err.errors[0].includes('role'), 'Error mentions field name');
}

// -----------------------------------------------------------
// Test 3: Plain object assigned to an integer column
// -----------------------------------------------------------
console.log("\nTest 3: Plain object on integer column");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = { user_name: 'alice', age: { value: 25 }, __entity: entityModel };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(!err.isValid, 'Validation fails');
    assert(err.errors[0].includes('Object'), 'Error mentions Object');
    assert(err.errors[0].includes('age'), 'Error mentions field name');
}

// -----------------------------------------------------------
// Test 4: Normal scalar values pass validation
// -----------------------------------------------------------
console.log("\nTest 4: Normal scalar values pass validation");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = { user_name: 'alice', age: 25, role: 'admin', __entity: entityModel };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(err.isValid, 'Validation passes');
    assert(err.errors.length === 0, 'No errors');
}

// -----------------------------------------------------------
// Test 5: Date objects are allowed (not flagged)
// -----------------------------------------------------------
console.log("\nTest 5: Date objects are allowed");
console.log("──────────────────────────────────────────────────");
{
    const entityWithDate = {
        __name: 'Event',
        id:         { type: 'integer', primary: true, auto: true, nullable: true },
        event_date: { type: 'string', nullable: true },
    };
    const { mgr, err } = makeManager();
    const realModel = { event_date: new Date(), __entity: entityWithDate };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityWithDate);

    assert(err.isValid, 'Date objects pass validation');
    assert(err.errors.length === 0, 'No errors for Date');
}

// -----------------------------------------------------------
// Test 6: Relationship columns are NOT flagged for objects
// -----------------------------------------------------------
console.log("\nTest 6: Relationship columns allow objects");
console.log("──────────────────────────────────────────────────");
{
    const entityWithRel = {
        __name: 'Post',
        id:     { type: 'integer', primary: true, auto: true, nullable: true },
        title:  { type: 'string', nullable: false },
        author: { type: 'belongsTo', relationshipType: 'belongsTo', foreignKey: 'author_id', name: 'author' },
        tags:   { type: 'hasMany', name: 'tags' },
        meta:   { type: 'hasOne', name: 'meta' },
        cats:   { type: 'hasManyThrough', name: 'cats' },
    };
    const { mgr, err } = makeManager();
    const realModel = {
        title: 'Hello',
        author: { id: 1, name: 'Alice' },
        tags: [{ id: 1 }],
        meta: { key: 'val' },
        cats: [{ id: 2 }],
        __entity: entityWithRel,
    };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityWithRel);

    assert(err.isValid, 'Relationship objects pass validation');
    assert(err.errors.length === 0, 'No errors for relationship objects');
}

// -----------------------------------------------------------
// Test 7: null and undefined values are NOT flagged
// -----------------------------------------------------------
console.log("\nTest 7: null/undefined values are not flagged");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = { user_name: 'alice', age: null, role: undefined, __entity: entityModel };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(err.isValid, 'null/undefined pass validation');
    assert(err.errors.length === 0, 'No errors for null/undefined');
}

// -----------------------------------------------------------
// Test 8: Multiple bad fields produce multiple errors
// -----------------------------------------------------------
console.log("\nTest 8: Multiple bad fields produce multiple errors");
console.log("──────────────────────────────────────────────────");
{
    const { mgr, err } = makeManager();
    const realModel = {
        user_name: Promise.resolve('alice'),
        age: [1, 2, 3],
        role: { x: 1 },
        __entity: entityModel,
    };
    const cleanModel = { ...realModel };

    mgr.validateEntity(cleanModel, realModel, entityModel);

    assert(!err.isValid, 'Validation fails');
    assert(err.errors.length === 3, 'Three errors (Promise + Array + Object)');
}

// Summary
console.log("\n" + "=".repeat(64));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed > 0) {
    process.exit(1);
}
