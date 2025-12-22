/**
 * Test: .new() Method for Creating Empty Entity Instances
 *
 * Verifies that all dbsets have access to .new() method
 * which creates empty entity instances ready for property assignment.
 *
 * Bug Report: QaIntelligenceJob.new() was not a function
 * Root Cause: .new() method was never implemented in queryMethods.js
 * Fix: Added .new() method to create tracked entity instances
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              .new() Method Test Suite                         ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test 1: Define test entities
console.log("📝 Test 1: Define test entities");
console.log("──────────────────────────────────────────────────");

class TestUser {
    id(db) {
        db.integer().primary().auto();
    }

    name(db) {
        db.string().notNullable();
    }

    email(db) {
        db.string().notNullable().unique();
    }

    age(db) {
        db.integer().nullable();
    }

    created_at(db) {
        db.string().notNullable();
        db.get(function(value) {
            return value || Date.now().toString();
        });
    }
}

class TestPost {
    id(db) {
        db.integer().primary().auto();
    }

    title(db) {
        db.string().notNullable();
    }

    content(db) {
        db.string().nullable();
    }

    user_id(db) {
        db.integer().notNullable();
    }
}

console.log("   ✓ TestUser entity defined");
console.log("   ✓ TestPost entity defined");
passed++;

// Test 2: Create context and register dbsets
console.log("\n📝 Test 2: Create context and register dbsets");
console.log("──────────────────────────────────────────────────");

class TestContext extends masterrecord.context {
    constructor() {
        super();
        // Use in-memory SQLite for testing
        this.tablePrefix = "test_";
    }

    onConfig(db) {
        this.dbset(TestUser);
        this.dbset(TestPost);
    }
}

try {
    const ctx = new TestContext();
    ctx.onConfig();

    if(ctx.TestUser && ctx.TestPost) {
        console.log("   ✓ Context created");
        console.log("   ✓ TestUser dbset registered");
        console.log("   ✓ TestPost dbset registered");
        passed++;
    } else {
        console.log("   ✗ Dbsets not registered properly");
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: Verify .new() method exists on all dbsets
console.log("\n📝 Test 3: Verify .new() method exists");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const hasNewOnUser = typeof ctx.TestUser.new === 'function';
    const hasNewOnPost = typeof ctx.TestPost.new === 'function';

    if(hasNewOnUser && hasNewOnPost) {
        console.log("   ✓ TestUser.new is a function");
        console.log("   ✓ TestPost.new is a function");
        passed++;
    } else {
        console.log(`   ✗ TestUser.new: ${typeof ctx.TestUser.new}`);
        console.log(`   ✗ TestPost.new: ${typeof ctx.TestPost.new}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Create entity instance with .new()
console.log("\n📝 Test 4: Create entity instance with .new()");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const user = ctx.TestUser.new();

    if(user && typeof user === 'object') {
        console.log("   ✓ .new() returns an object");

        // Check internal properties
        if(user.__state === 'insert') {
            console.log("   ✓ Entity has __state = 'insert'");
        } else {
            console.log(`   ✗ Expected __state='insert', got '${user.__state}'`);
        }

        if(user.__entity) {
            console.log("   ✓ Entity has __entity reference");
        } else {
            console.log("   ✗ Entity missing __entity reference");
        }

        if(user.__context) {
            console.log("   ✓ Entity has __context reference");
        } else {
            console.log("   ✗ Entity missing __context reference");
        }

        passed++;
    } else {
        console.log(`   ✗ .new() returned: ${typeof user}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Set properties on new entity
console.log("\n📝 Test 5: Set properties on new entity");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const user = ctx.TestUser.new();
    user.name = "John Doe";
    user.email = "john@example.com";
    user.age = 30;

    if(user.name === "John Doe" && user.email === "john@example.com" && user.age === 30) {
        console.log("   ✓ Properties set successfully");
        console.log(`   ✓ user.name = "${user.name}"`);
        console.log(`   ✓ user.email = "${user.email}"`);
        console.log(`   ✓ user.age = ${user.age}`);
        passed++;
    } else {
        console.log(`   ✗ Properties not set correctly`);
        console.log(`   ✗ user.name = "${user.name}"`);
        console.log(`   ✗ user.email = "${user.email}"`);
        console.log(`   ✗ user.age = ${user.age}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 6: Verify entity is tracked
console.log("\n📝 Test 6: Verify entity is tracked in context");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const user = ctx.TestUser.new();
    user.name = "Jane Doe";
    user.email = "jane@example.com";

    // Check if entity is in tracked entities
    const isTracked = ctx.__trackedEntities.some(e => e.__ID === user.__ID);

    if(isTracked) {
        console.log("   ✓ Entity is tracked in context");
        console.log(`   ✓ Tracked entities count: ${ctx.__trackedEntities.length}`);
        passed++;
    } else {
        console.log("   ✗ Entity not found in tracked entities");
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 7: Verify dirty fields tracking
console.log("\n📝 Test 7: Verify dirty fields are tracked");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const user = ctx.TestUser.new();
    user.name = "Test User";
    user.email = "test@example.com";

    const hasDirtyFields = user.__dirtyFields && user.__dirtyFields.length > 0;
    const hasNameInDirty = user.__dirtyFields.includes('name');
    const hasEmailInDirty = user.__dirtyFields.includes('email');

    if(hasDirtyFields && hasNameInDirty && hasEmailInDirty) {
        console.log("   ✓ Dirty fields tracked");
        console.log(`   ✓ Dirty fields: [${user.__dirtyFields.join(', ')}]`);
        passed++;
    } else {
        console.log(`   ✗ Dirty fields not tracked properly`);
        console.log(`   ✗ Dirty fields: [${user.__dirtyFields.join(', ')}]`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 8: Multiple entities from same dbset
console.log("\n📝 Test 8: Create multiple entities from same dbset");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new TestContext();
    ctx.onConfig();

    const user1 = ctx.TestUser.new();
    user1.name = "User 1";
    user1.email = "user1@example.com";

    const user2 = ctx.TestUser.new();
    user2.name = "User 2";
    user2.email = "user2@example.com";

    const differentIDs = user1.__ID !== user2.__ID;
    const bothTracked = ctx.__trackedEntities.length === 2;

    if(differentIDs && bothTracked) {
        console.log("   ✓ Multiple entities created");
        console.log("   ✓ Entities have different IDs");
        console.log("   ✓ Both entities tracked");
        passed++;
    } else {
        console.log(`   ✗ Multiple entity creation failed`);
        console.log(`   ✗ Different IDs: ${differentIDs}`);
        console.log(`   ✗ Both tracked: ${bothTracked}`);
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
    console.log("🎉 All .new() tests passed!");
    console.log("\n✨ Feature Implemented!");
    console.log("\n📖 What was fixed:");
    console.log("   - Added .new() method to queryMethods.js");
    console.log("   - Creates empty entity instances with property setters");
    console.log("   - Automatically tracks entities for INSERT operations");
    console.log("   - Sets __state = 'insert' for new entities");
    console.log("   - Tracks dirty fields as properties are set");
    console.log("\n   Usage example:");
    console.log("   const job = context.QaIntelligenceJob.new();");
    console.log("   job.annotation_id = 123;");
    console.log("   job.job_type = 'auto_rewrite';");
    console.log("   context.saveChanges(); // Inserts the job\n");
    process.exit(0);
} else {
    console.log("⚠️  Some tests failed. Review and fix issues.");
    process.exit(1);
}
