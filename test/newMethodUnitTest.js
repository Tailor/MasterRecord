/**
 * Unit Test: .new() Method
 *
 * Tests the .new() method implementation directly without database setup
 */

const queryMethods = require('../QueryLanguage/queryMethods');
const QueryParameters = require('../QueryLanguage/queryParameters');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              .new() Method Unit Test                          ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test 1: Verify .new() method exists
console.log("📝 Test 1: Verify .new() method exists in queryMethods");
console.log("──────────────────────────────────────────────────");

try {
    const hasNewMethod = typeof queryMethods.prototype.new === 'function';

    if(hasNewMethod) {
        console.log("   ✓ .new() method exists");
        console.log("   ✓ Method is a function");
        passed++;
    } else {
        console.log(`   ✗ .new() method not found`);
        console.log(`   ✗ typeof queryMethods.prototype.new: ${typeof queryMethods.prototype.new}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Create mock entity and context
console.log("\n📝 Test 2: Create entity with .new() method");
console.log("──────────────────────────────────────────────────");

try {
    // Mock entity definition
    const mockEntity = {
        __name: 'TestEntity',
        id: { type: 'integer', primary: true, auto: true, isNavigational: false },
        name: { type: 'string', nullable: false, isNavigational: false },
        email: { type: 'string', nullable: false, unique: true, isNavigational: false },
        age: { type: 'integer', nullable: true, isNavigational: false }
    };

    // Mock context
    const mockContext = {
        __trackedEntities: [],
        __track: function(entity) {
            this.__trackedEntities.push(entity);
            return entity;
        }
    };

    // Create queryMethods instance
    const qm = new queryMethods(mockEntity, mockContext);

    // Call .new()
    const entity = qm.new();

    if(entity && typeof entity === 'object') {
        console.log("   ✓ .new() returns an object");

        // Check properties
        if(entity.__state === 'insert') {
            console.log("   ✓ Entity.__state = 'insert'");
        } else {
            console.log(`   ✗ Expected __state='insert', got '${entity.__state}'`);
        }

        if(entity.__entity === mockEntity) {
            console.log("   ✓ Entity.__entity reference set");
        } else {
            console.log("   ✗ Entity.__entity not set properly");
        }

        if(entity.__context === mockContext) {
            console.log("   ✓ Entity.__context reference set");
        } else {
            console.log("   ✗ Entity.__context not set properly");
        }

        if(entity.__name === 'TestEntity') {
            console.log("   ✓ Entity.__name = 'TestEntity'");
        } else {
            console.log(`   ✗ Expected __name='TestEntity', got '${entity.__name}'`);
        }

        if(Array.isArray(entity.__dirtyFields)) {
            console.log("   ✓ Entity.__dirtyFields is an array");
        } else {
            console.log("   ✗ Entity.__dirtyFields not initialized");
        }

        passed++;
    } else {
        console.log(`   ✗ .new() returned: ${typeof entity}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    console.log(`   ✗ Stack: ${err.stack}`);
    failed++;
}

// Test 3: Set properties on new entity
console.log("\n📝 Test 3: Set and get properties on new entity");
console.log("──────────────────────────────────────────────────");

try {
    const mockEntity = {
        __name: 'TestEntity',
        id: { type: 'integer', primary: true, auto: true, isNavigational: false },
        name: { type: 'string', nullable: false, isNavigational: false },
        email: { type: 'string', nullable: false, unique: true, isNavigational: false },
        age: { type: 'integer', nullable: true, isNavigational: false }
    };

    const mockContext = {
        __trackedEntities: [],
        __track: function(entity) {
            this.__trackedEntities.push(entity);
            return entity;
        }
    };

    const qm = new queryMethods(mockEntity, mockContext);
    const entity = qm.new();

    // Set properties
    entity.name = "John Doe";
    entity.email = "john@example.com";
    entity.age = 30;

    // Get properties
    const nameValue = entity.name;
    const emailValue = entity.email;
    const ageValue = entity.age;

    if(nameValue === "John Doe" && emailValue === "john@example.com" && ageValue === 30) {
        console.log("   ✓ Properties set and retrieved correctly");
        console.log(`   ✓ name: "${nameValue}"`);
        console.log(`   ✓ email: "${emailValue}"`);
        console.log(`   ✓ age: ${ageValue}`);
        passed++;
    } else {
        console.log(`   ✗ Properties not working correctly`);
        console.log(`   ✗ name: "${nameValue}" (expected "John Doe")`);
        console.log(`   ✗ email: "${emailValue}" (expected "john@example.com")`);
        console.log(`   ✗ age: ${ageValue} (expected 30)`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Verify dirty fields tracking
console.log("\n📝 Test 4: Verify dirty fields tracking");
console.log("──────────────────────────────────────────────────");

try {
    const mockEntity = {
        __name: 'TestEntity',
        name: { type: 'string', nullable: false, isNavigational: false },
        email: { type: 'string', nullable: false, isNavigational: false }
    };

    const mockContext = {
        __trackedEntities: [],
        __track: function(entity) {
            this.__trackedEntities.push(entity);
        }
    };

    const qm = new queryMethods(mockEntity, mockContext);
    const entity = qm.new();

    entity.name = "Test User";
    entity.email = "test@example.com";

    const hasName = entity.__dirtyFields.includes('name');
    const hasEmail = entity.__dirtyFields.includes('email');

    if(hasName && hasEmail) {
        console.log("   ✓ Dirty fields tracked correctly");
        console.log(`   ✓ Dirty fields: [${entity.__dirtyFields.join(', ')}]`);
        passed++;
    } else {
        console.log(`   ✗ Dirty fields not tracked`);
        console.log(`   ✗ Dirty fields: [${entity.__dirtyFields.join(', ')}]`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Verify entity is tracked in context
console.log("\n📝 Test 5: Verify entity is tracked in context");
console.log("──────────────────────────────────────────────────");

try {
    const mockEntity = {
        __name: 'TestEntity',
        name: { type: 'string', nullable: false, isNavigational: false }
    };

    const mockContext = {
        __trackedEntities: [],
        __track: function(entity) {
            this.__trackedEntities.push(entity);
        }
    };

    const qm = new queryMethods(mockEntity, mockContext);
    const entity = qm.new();

    const isTracked = mockContext.__trackedEntities.length === 1;
    const correctEntity = mockContext.__trackedEntities[0] === entity;

    if(isTracked && correctEntity) {
        console.log("   ✓ Entity tracked in context");
        console.log("   ✓ Correct entity reference stored");
        passed++;
    } else {
        console.log(`   ✗ Entity not tracked properly`);
        console.log(`   ✗ Tracked count: ${mockContext.__trackedEntities.length}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 6: Verify navigational properties are skipped
console.log("\n📝 Test 6: Verify navigational properties are skipped");
console.log("──────────────────────────────────────────────────");

try {
    const mockEntity = {
        __name: 'TestEntity',
        id: { type: 'integer', primary: true, isNavigational: false },
        name: { type: 'string', isNavigational: false },
        Posts: { type: 'hasMany', foreignTable: 'Post', isNavigational: true },
        Profile: { type: 'hasOne', foreignTable: 'Profile', isNavigational: true }
    };

    const mockContext = {
        __trackedEntities: [],
        __track: function(entity) {
            this.__trackedEntities.push(entity);
        }
    };

    const qm = new queryMethods(mockEntity, mockContext);
    const entity = qm.new();

    // Check that regular properties exist
    const hasNameDescriptor = Object.getOwnPropertyDescriptor(entity, 'name') !== undefined;
    // Check that navigational properties don't exist
    const hasPostsDescriptor = Object.getOwnPropertyDescriptor(entity, 'Posts') !== undefined;
    const hasProfileDescriptor = Object.getOwnPropertyDescriptor(entity, 'Profile') !== undefined;

    if(hasNameDescriptor && !hasPostsDescriptor && !hasProfileDescriptor) {
        console.log("   ✓ Regular properties created");
        console.log("   ✓ Navigational properties skipped");
        passed++;
    } else {
        console.log(`   ✗ Property creation incorrect`);
        console.log(`   ✗ name: ${hasNameDescriptor ? 'exists' : 'missing'}`);
        console.log(`   ✗ Posts: ${hasPostsDescriptor ? 'exists (should not)' : 'skipped (correct)'}`);
        console.log(`   ✗ Profile: ${hasProfileDescriptor ? 'exists (should not)' : 'skipped (correct)'}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Summary
console.log("\n\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                       Test Summary                             ║");
console.log("╚════════════════════════════════════════════════════════════════╝");

const total = passed + failed;
const successRate = Math.round((passed/total)*100);

console.log(`\n   Total Tests: ${total}`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Success Rate: ${successRate}%\n`);

if(failed === 0){
    console.log("🎉 All unit tests passed!");
    console.log("\n✨ .new() Method Successfully Implemented!");
    console.log("\n📖 What was added:");
    console.log("   - queryMethods.prototype.new() creates empty entity instances");
    console.log("   - Automatically sets __state = 'insert'");
    console.log("   - Creates property getters/setters for all fields");
    console.log("   - Tracks dirty fields as properties are set");
    console.log("   - Skips navigational properties (hasMany, hasOne, etc.)");
    console.log("   - Automatically tracks entity in context");
    console.log("\n   Usage:");
    console.log("   const job = context.QaIntelligenceJob.new();");
    console.log("   job.annotation_id = 123;");
    console.log("   job.job_type = 'auto_rewrite';");
    console.log("   job.status = 'queued';");
    console.log("   context.saveChanges(); // Inserts into database\n");
    process.exit(0);
} else {
    console.log("⚠️  Some tests failed. Review implementation.");
    process.exit(1);
}
