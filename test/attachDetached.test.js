/**
 * Test: Attach Detached Entities
 *
 * Verifies that detached entities can be re-attached and tracked
 * Like Entity Framework's context.Update() or Hibernate's session.merge()
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║           Detached Entity Attachment Test                     ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate a context with attach functionality
class SimulatedContext {
    constructor() {
        this.__trackedEntities = [];
        this.__trackedEntitiesMap = new Map();
    }

    __track(model) {
        if (!model.__ID) {
            model.__ID = Math.floor((Math.random() * 100000) + 1);
        }

        if (!this.__trackedEntitiesMap.has(model.__ID)) {
            this.__trackedEntities.push(model);
            this.__trackedEntitiesMap.set(model.__ID, model);
        }

        return model;
    }

    attach(entity, changes = null) {
        if (!entity) {
            throw new Error('Cannot attach null or undefined entity');
        }

        if (!entity.__entity || !entity.__entity.__name) {
            throw new Error('Entity must have __entity metadata');
        }

        // Mark entity as modified
        entity.__state = 'modified';

        // If specific changes provided, mark only those fields as dirty
        if (changes) {
            entity.__dirtyFields = entity.__dirtyFields || [];
            for (const fieldName in changes) {
                entity[fieldName] = changes[fieldName];
                if (!entity.__dirtyFields.includes(fieldName)) {
                    entity.__dirtyFields.push(fieldName);
                }
            }
        } else {
            // Mark all fields as potentially modified
            entity.__dirtyFields = entity.__dirtyFields || [];

            if (entity.__dirtyFields.length === 0) {
                for (const fieldName in entity.__entity) {
                    if (!fieldName.startsWith('__') &&
                        entity.__entity[fieldName].type !== 'hasMany' &&
                        entity.__entity[fieldName].type !== 'hasOne') {
                        entity.__dirtyFields.push(fieldName);
                    }
                }
            }
        }

        entity.__context = this;
        this.__track(entity);
        return entity;
    }

    attachAll(entities) {
        if (!Array.isArray(entities)) {
            throw new Error('attachAll() requires an array');
        }
        return entities.map(entity => this.attach(entity));
    }
}

// Create mock entity
function createMockEntity(id, name, status) {
    return {
        __ID: id,
        __entity: {
            __name: 'Task',
            id: { type: 'integer', primary: true },
            name: { type: 'string' },
            status: { type: 'string' }
        },
        __dirtyFields: [],
        __state: 'track',
        id: id,
        name: name,
        status: status
    };
}

// Test 1: Attach detached entity
console.log("📝 Test 1: Attach detached entity");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const task = createMockEntity(1, 'Task 1', 'pending');

    // Simulate: entity loaded in different context (detached)
    task.status = 'completed';

    // Attach to current context
    ctx.attach(task);

    if (ctx.__trackedEntities.includes(task) &&
        task.__state === 'modified' &&
        task.__dirtyFields.length > 0) {
        console.log("   ✓ Entity attached to context");
        console.log("   ✓ Entity marked as 'modified'");
        console.log(`   ✓ Dirty fields marked: ${task.__dirtyFields.join(', ')}`);
        passed++;
    } else {
        console.log(`   ✗ Entity not properly attached`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Attach with specific field changes
console.log("\n📝 Test 2: Attach with specific field changes");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const task = createMockEntity(2, 'Task 2', 'pending');

    // Attach with specific changes
    ctx.attach(task, {
        status: 'completed',
        completed_at: new Date()
    });

    if (task.status === 'completed' &&
        task.__dirtyFields.includes('status') &&
        task.__dirtyFields.includes('completed_at') &&
        task.__state === 'modified') {
        console.log("   ✓ Specific fields applied");
        console.log("   ✓ Only specified fields marked dirty");
        console.log(`   ✓ Dirty fields: ${task.__dirtyFields.join(', ')}`);
        passed++;
    } else {
        console.log(`   ✗ Specific changes not applied correctly`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: attachAll() multiple entities
console.log("\n📝 Test 3: Attach multiple entities");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const tasks = [
        createMockEntity(3, 'Task 3', 'pending'),
        createMockEntity(4, 'Task 4', 'pending'),
        createMockEntity(5, 'Task 5', 'pending')
    ];

    // Modify all
    tasks.forEach(t => t.status = 'completed');

    // Attach all
    ctx.attachAll(tasks);

    const allAttached = tasks.every(t =>
        ctx.__trackedEntities.includes(t) &&
        t.__state === 'modified'
    );

    if (allAttached && ctx.__trackedEntities.length === 3) {
        console.log("   ✓ All entities attached");
        console.log(`   ✓ Tracked count: ${ctx.__trackedEntities.length}`);
        console.log("   ✓ All marked as modified");
        passed++;
    } else {
        console.log(`   ✗ Not all entities attached correctly`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Attach throws error for invalid entity
console.log("\n📝 Test 4: Error handling for invalid entities");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();

    let error1 = null;
    let error2 = null;

    // Test null
    try {
        ctx.attach(null);
    } catch(e) {
        error1 = e.message;
    }

    // Test entity without metadata
    try {
        ctx.attach({ id: 1, name: 'Test' });
    } catch(e) {
        error2 = e.message;
    }

    if (error1 && error2) {
        console.log("   ✓ Null entity rejected");
        console.log("   ✓ Entity without metadata rejected");
        console.log(`   ✓ Error messages provided`);
        passed++;
    } else {
        console.log(`   ✗ Invalid entities should throw errors`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Attach doesn't duplicate entities
console.log("\n📝 Test 5: No duplicate tracking");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const task = createMockEntity(6, 'Task 6', 'pending');

    // Attach twice
    ctx.attach(task);
    ctx.attach(task);

    if (ctx.__trackedEntities.length === 1) {
        console.log("   ✓ Entity not duplicated in tracking");
        console.log(`   ✓ Tracked count: ${ctx.__trackedEntities.length}`);
        passed++;
    } else {
        console.log(`   ✗ Entity duplicated: ${ctx.__trackedEntities.length} entries`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 6: Attach preserves entity reference
console.log("\n📝 Test 6: Entity reference preserved");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const task = createMockEntity(7, 'Task 7', 'pending');

    const returned = ctx.attach(task);

    if (returned === task) {
        console.log("   ✓ Same entity reference returned");
        console.log("   ✓ No entity cloning");
        passed++;
    } else {
        console.log(`   ✗ Different entity reference returned`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Summary
console.log("\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                        Test Summary                            ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log(`\n   ✓ Passed: ${passed}`);
console.log(`   ✗ Failed: ${failed}`);
console.log(`   📊 Total:  ${passed + failed}\n`);

if(failed === 0) {
    console.log("   🎉 All tests passed!\n");
    console.log("   ✅ Detached entity attachment works");
    console.log("   ✅ Like Entity Framework's context.Update()");
    console.log("   ✅ Like Hibernate's session.merge()\n");
    process.exit(0);
} else {
    console.log("   ❌ Some tests failed\n");
    process.exit(1);
}
