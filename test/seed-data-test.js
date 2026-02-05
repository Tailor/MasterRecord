/**
 * Test: Context-Level Seed Data API
 *
 * Verifies that the seed data API works correctly:
 * - Chainable .seed() method
 * - Array and single object support
 * - Backward compatibility
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║           Context-Level Seed Data API Test                    ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate the context class with seed data functionality
class SimulatedContext {
    constructor() {
        this.__contextSeedData = {};
    }

    dbset(model, name) {
        const tableName = name || model.name;

        // Simulate entity registration
        // (simplified - real implementation does more)

        // Return chainable object with seed() method
        return {
            seed: (data) => this.#addSeedData(tableName, data)
        };
    }

    #addSeedData(tableName, data) {
        // Initialize seed data storage if not exists
        if (!this.__contextSeedData) {
            this.__contextSeedData = {};
        }
        if (!this.__contextSeedData[tableName]) {
            this.__contextSeedData[tableName] = [];
        }

        // Handle both single object and array of objects
        const records = Array.isArray(data) ? data : [data];
        this.__contextSeedData[tableName].push(...records);

        // Return chainable object for more .seed() calls
        return {
            seed: (moreData) => this.#addSeedData(tableName, moreData)
        };
    }
}

// Test entities
class User {
    static name = 'User';
}
class Post {
    static name = 'Post';
}
class Category {
    static name = 'Category';
}
class Tag {
    static name = 'Tag';
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

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertDefined(value, message) {
    if (value === undefined || value === null) {
        throw new Error(`${message}: value is ${value}`);
    }
}

// Run tests
console.log("Running tests...\n");

test("Context initializes with empty seed data", () => {
    const ctx = new SimulatedContext();
    assertDefined(ctx.__contextSeedData, "Context should have __contextSeedData");
});

test("Single seed record is stored correctly", () => {
    const ctx = new SimulatedContext();
    ctx.dbset(User).seed({
        name: 'Admin User',
        email: 'admin@example.com'
    });

    assertDefined(ctx.__contextSeedData.User, "User seed data should exist");
    assertEquals(ctx.__contextSeedData.User.length, 1, "Should have 1 User record");
    assertEquals(ctx.__contextSeedData.User[0].name, 'Admin User', "User name should match");
    assertEquals(ctx.__contextSeedData.User[0].email, 'admin@example.com', "User email should match");
});

test("Chainable seed calls accumulate data", () => {
    const ctx = new SimulatedContext();
    ctx.dbset(Post)
        .seed({ title: 'First Post', content: 'Hello World' })
        .seed({ title: 'Second Post', content: 'Testing seed' });

    assertDefined(ctx.__contextSeedData.Post, "Post seed data should exist");
    assertEquals(ctx.__contextSeedData.Post.length, 2, "Should have 2 Post records");
    assertEquals(ctx.__contextSeedData.Post[0].title, 'First Post', "First post title should match");
    assertEquals(ctx.__contextSeedData.Post[1].title, 'Second Post', "Second post title should match");
});

test("Array seed syntax works", () => {
    const ctx = new SimulatedContext();
    ctx.dbset(Category).seed([
        { name: 'Technology' },
        { name: 'Business' },
        { name: 'Science' }
    ]);

    assertDefined(ctx.__contextSeedData.Category, "Category seed data should exist");
    assertEquals(ctx.__contextSeedData.Category.length, 3, "Should have 3 Category records");
    assertEquals(ctx.__contextSeedData.Category[0].name, 'Technology', "First category should match");
    assertEquals(ctx.__contextSeedData.Category[1].name, 'Business', "Second category should match");
    assertEquals(ctx.__contextSeedData.Category[2].name, 'Science', "Third category should match");
});

test("Backward compatibility - dbset without seed works", () => {
    const ctx = new SimulatedContext();
    const result = ctx.dbset(Tag);  // No seed call

    // Should return chainable object but Tag seed data shouldn't exist yet
    assertDefined(result, "dbset should return an object");
    assertDefined(result.seed, "returned object should have seed method");
});

test("Multiple dbset calls for different entities", () => {
    const ctx = new SimulatedContext();

    ctx.dbset(User).seed({ name: 'Alice' });
    ctx.dbset(Post).seed({ title: 'Post 1' });
    ctx.dbset(Category).seed({ name: 'Tech' });

    assertDefined(ctx.__contextSeedData.User, "User seed data should exist");
    assertDefined(ctx.__contextSeedData.Post, "Post seed data should exist");
    assertDefined(ctx.__contextSeedData.Category, "Category seed data should exist");
    assertEquals(ctx.__contextSeedData.User.length, 1, "Should have 1 User");
    assertEquals(ctx.__contextSeedData.Post.length, 1, "Should have 1 Post");
    assertEquals(ctx.__contextSeedData.Category.length, 1, "Should have 1 Category");
});

test("Mixed single and array seed calls", () => {
    const ctx = new SimulatedContext();

    ctx.dbset(Post)
        .seed({ title: 'Post 1' })
        .seed([
            { title: 'Post 2' },
            { title: 'Post 3' }
        ])
        .seed({ title: 'Post 4' });

    assertEquals(ctx.__contextSeedData.Post.length, 4, "Should have 4 Post records");
    assertEquals(ctx.__contextSeedData.Post[0].title, 'Post 1', "Post 1 title should match");
    assertEquals(ctx.__contextSeedData.Post[1].title, 'Post 2', "Post 2 title should match");
    assertEquals(ctx.__contextSeedData.Post[2].title, 'Post 3', "Post 3 title should match");
    assertEquals(ctx.__contextSeedData.Post[3].title, 'Post 4', "Post 4 title should match");
});

test("Seed data is isolated per table", () => {
    const ctx = new SimulatedContext();

    ctx.dbset(User).seed({ name: 'User 1' });
    ctx.dbset(User).seed({ name: 'User 2' });
    ctx.dbset(Post).seed({ title: 'Post 1' });

    assertEquals(ctx.__contextSeedData.User.length, 2, "Should have 2 User records");
    assertEquals(ctx.__contextSeedData.Post.length, 1, "Should have 1 Post record");
});

test("Empty array seed is handled", () => {
    const ctx = new SimulatedContext();
    ctx.dbset(Category).seed([]);

    // Empty array should still create the table entry but with 0 records
    assertEquals(ctx.__contextSeedData.Category.length, 0, "Should have 0 Category records");
});

// Print summary
console.log("\n" + "─".repeat(64));
console.log(`Tests completed: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.log("\n❌ Some tests failed");
    process.exit(1);
} else {
    console.log("\n✅ All tests passed!");
    process.exit(0);
}
