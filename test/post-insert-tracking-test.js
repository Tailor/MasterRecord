/**
 * Test: Post-INSERT entity tracking
 *
 * Verifies that after saveChanges() INSERTs a new entity, modifying
 * properties on that same in-memory object correctly transitions to
 * "modified" state and re-registers with the change tracker, so that
 * a subsequent saveChanges() issues an UPDATE.
 */

// Alias 'masterrecord' to local root
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

const queryMethods = require('../QueryLanguage/queryMethods');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║           Post-INSERT Entity Tracking Test                    ║");
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

// Minimal simulated context with tracking
function makeContext(entity) {
    const ctx = {
        __trackedEntities: [],
        __trackedEntitiesMap: new Map(),
        __entities: [entity],
        __track(model) {
            if (!this.__trackedEntitiesMap.has(model.__ID)) {
                this.__trackedEntities.push(model);
                this.__trackedEntitiesMap.set(model.__ID, model);
            }
        },
        __clearTracked() {
            this.__trackedEntities = [];
            this.__trackedEntitiesMap.clear();
        },
    };
    return ctx;
}

// Entity definition
const userEntity = {
    __name: 'User',
    id:     { type: 'integer', primary: true, auto: true, nullable: true },
    status: { type: 'string', nullable: true },
    name:   { type: 'string', nullable: true },
};

// Build a queryMethods-style dbset so we can call .new()
function makeDbSet(ctx, entity) {
    const qs = new queryMethods();
    qs.__entity = entity;
    qs.__context = ctx;
    return qs;
}

// -----------------------------------------------------------
// Test 1: .new() entity starts in "insert" state
// -----------------------------------------------------------
console.log("Test 1: .new() entity starts in insert state");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();

    assert(entity.__state === 'insert', 'State is "insert"');
    assert(Array.isArray(entity.__dirtyFields), 'Has dirtyFields array');
    assert(ctx.__trackedEntitiesMap.has(entity.__ID), 'Entity is tracked');
}

// -----------------------------------------------------------
// Test 2: Setting properties during "insert" state keeps state
// -----------------------------------------------------------
console.log("\nTest 2: Properties set during insert state keep insert state");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();

    entity.status = 'queued';
    entity.name = 'Test';

    assert(entity.__state === 'insert', 'State stays "insert"');
    assert(entity.__dirtyFields.includes('status'), 'status in dirtyFields');
    assert(entity.__dirtyFields.includes('name'), 'name in dirtyFields');
}

// -----------------------------------------------------------
// Test 3: Simulating post-INSERT transition
// -----------------------------------------------------------
console.log("\nTest 3: After INSERT, entity transitions to track state");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();
    entity.status = 'queued';

    // Simulate what _processBatchInserts now does after INSERT
    entity.__state = 'track';
    entity.__dirtyFields = [];

    // Simulate saveChanges clearing tracked entities
    ctx.__clearTracked();

    assert(entity.__state === 'track', 'State is "track" after INSERT');
    assert(entity.__dirtyFields.length === 0, 'dirtyFields cleared');
    assert(!ctx.__trackedEntitiesMap.has(entity.__ID), 'Entity removed from tracker');
}

// -----------------------------------------------------------
// Test 4: Modifying after INSERT transitions to "modified" and re-tracks
// -----------------------------------------------------------
console.log("\nTest 4: Modification after INSERT transitions to modified + re-tracks");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();
    entity.status = 'queued';

    // Simulate post-INSERT transition + clear
    entity.__state = 'track';
    entity.__dirtyFields = [];
    ctx.__clearTracked();

    // Now modify — this is the bug scenario
    entity.status = 'completed';

    assert(entity.__state === 'modified', 'State transitions to "modified"');
    assert(entity.__dirtyFields.includes('status'), 'status in dirtyFields');
    assert(entity.__dirtyFields.length === 1, 'Only modified field is dirty');
    assert(ctx.__trackedEntitiesMap.has(entity.__ID), 'Entity re-registered with tracker');
    assert(ctx.__trackedEntities.length === 1, 'Exactly one tracked entity');
}

// -----------------------------------------------------------
// Test 5: Multiple modifications after INSERT
// -----------------------------------------------------------
console.log("\nTest 5: Multiple modifications after INSERT");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();
    entity.status = 'queued';
    entity.name = 'Job1';

    // Simulate post-INSERT + clear
    entity.__state = 'track';
    entity.__dirtyFields = [];
    ctx.__clearTracked();

    // Multiple modifications
    entity.status = 'completed';
    entity.name = 'Job1-done';

    assert(entity.__state === 'modified', 'State is "modified"');
    assert(entity.__dirtyFields.includes('status'), 'status tracked');
    assert(entity.__dirtyFields.includes('name'), 'name tracked');
    assert(ctx.__trackedEntities.length === 1, 'Entity tracked only once (idempotent)');
}

// -----------------------------------------------------------
// Test 6: Entity value is correct after post-INSERT modification
// -----------------------------------------------------------
console.log("\nTest 6: Values are correct through full lifecycle");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();
    entity.status = 'queued';

    assert(entity.status === 'queued', 'Initial value correct');

    // Post-INSERT
    entity.__state = 'track';
    entity.__dirtyFields = [];
    ctx.__clearTracked();

    assert(entity.status === 'queued', 'Value preserved after INSERT transition');

    entity.status = 'completed';
    assert(entity.status === 'completed', 'Updated value correct');
}

// -----------------------------------------------------------
// Test 7: _processTrackedEntities would route correctly
// -----------------------------------------------------------
console.log("\nTest 7: Simulated _processTrackedEntities routes to UPDATE");
console.log("──────────────────────────────────────────────────");
{
    const ctx = makeContext(userEntity);
    const dbset = makeDbSet(ctx, userEntity);
    const entity = dbset.new();
    entity.status = 'queued';

    // Post-INSERT
    entity.__state = 'track';
    entity.__dirtyFields = [];
    ctx.__clearTracked();

    // Modify
    entity.status = 'completed';

    // Simulate _processTrackedEntities grouping
    const toInsert = [];
    const toUpdate = [];
    for (const tracked of ctx.__trackedEntities) {
        switch (tracked.__state) {
            case 'insert': toInsert.push(tracked); break;
            case 'modified':
                if (tracked.__dirtyFields && tracked.__dirtyFields.length > 0) {
                    toUpdate.push(tracked);
                }
                break;
        }
    }

    assert(toInsert.length === 0, 'No entities routed to INSERT');
    assert(toUpdate.length === 1, 'One entity routed to UPDATE');
    assert(toUpdate[0] === entity, 'Correct entity routed to UPDATE');
}

// Summary
console.log("\n" + "=".repeat(64));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed > 0) {
    process.exit(1);
}
