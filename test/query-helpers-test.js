/**
 * Test: Query Helper Methods
 * Tests: .first(), .last(), .exists(), .pluck()
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              Query Helper Methods Test                        ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Define test entities
class User {
    id(db) {
        db.integer().primary().auto();
    }
    name(db) {
        db.string();
    }
    email(db) {
        db.string();
    }
}

// Create test context
class TestContext extends masterrecord.context {
    constructor() {
        super();
    }
    onConfig(db) {
        this.dbset(User);
    }
}

// Clean test database
const dbPath = path.join(__dirname, '..', 'database', 'testQueryHelpers.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

async function runTests() {
    const db = new TestContext();

    // Initialize SQLite database
    const SQLLiteEngine = require('../SQLLiteEngine');
    const sqlite3 = require('better-sqlite3');
    db.isSQLite = true;
    db.isMySQL = false;
    db.isPostgres = false;
    db._SQLEngine = new SQLLiteEngine();
    db.db = new sqlite3(dbPath);
    db._SQLEngine.setDB(db.db, 'better-sqlite3');

    db.onConfig();

    // Create table
    db.db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT)');

    // Create test data
    const users = [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' },
        { name: 'Charlie', email: 'charlie@example.com' },
        { name: 'Dave', email: 'dave@example.com' },
        { name: 'Eve', email: 'eve@example.com' }
    ];

    for (const userData of users) {
        const user = db.User.new();
        user.name = userData.name;
        user.email = userData.email;
        await user.save();
    }

    // Test 1: .first() returns first record
    console.log("📝 Test 1: .first() returns first record");
    console.log("──────────────────────────────────────────────────");
    try {
        const first = await db.User.first();

        if (first && first.name === 'Alice') {
            console.log("   ✓ .first() returns first record ordered by primary key");
            passed++;
        } else {
            console.log(`   ✗ .first() failed - got: ${first?.name}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: .last() returns last record
    console.log("\n📝 Test 2: .last() returns last record");
    console.log("──────────────────────────────────────────────────");
    try {
        const last = await db.User.last();

        if (last && last.name === 'Eve') {
            console.log("   ✓ .last() returns last record ordered by primary key descending");
            passed++;
        } else {
            console.log(`   ✗ .last() failed - got: ${last?.name}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: .exists() returns true for existing records
    console.log("\n📝 Test 3: .exists() checks record existence");
    console.log("──────────────────────────────────────────────────");
    try {
        const exists = await db.User
            .where(u => u.email == $$, 'alice@example.com')
            .exists();

        const notExists = await db.User
            .where(u => u.email == $$, 'nonexistent@example.com')
            .exists();

        if (exists === true && notExists === false) {
            console.log("   ✓ .exists() returns true for existing records");
            console.log("   ✓ .exists() returns false for non-existing records");
            passed++;
        } else {
            console.log(`   ✗ .exists() failed - exists: ${exists}, notExists: ${notExists}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: .pluck() extracts column values
    console.log("\n📝 Test 4: .pluck() extracts column values");
    console.log("──────────────────────────────────────────────────");
    try {
        const emails = await db.User.pluck('email');

        if (Array.isArray(emails) &&
            emails.length === 5 &&
            emails.includes('alice@example.com') &&
            emails.includes('eve@example.com')) {
            console.log("   ✓ .pluck() extracts column as array");
            console.log("   ✓ All values included");
            passed++;
        } else {
            console.log(`   ✗ .pluck() failed - got: ${emails?.length} items`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: .pluck() with where clause
    console.log("\n📝 Test 5: .pluck() respects where clause");
    console.log("──────────────────────────────────────────────────");
    try {
        const emails = await db.User
            .where(u => u.name == $$, 'Alice')
            .pluck('email');

        if (Array.isArray(emails) &&
            emails.length === 1 &&
            emails[0] === 'alice@example.com') {
            console.log("   ✓ .pluck() respects where clause");
            passed++;
        } else {
            console.log(`   ✗ .pluck() with where failed`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 6: .first() with where clause
    console.log("\n📝 Test 6: .first() respects where clause");
    console.log("──────────────────────────────────────────────────");
    try {
        const first = await db.User
            .where(u => u.name == $$, 'Charlie')
            .first();

        if (first && first.name === 'Charlie') {
            console.log("   ✓ .first() respects where clause");
            passed++;
        } else {
            console.log(`   ✗ .first() with where failed`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 7: .first() returns null if no records
    console.log("\n📝 Test 7: .first() returns null if no records");
    console.log("──────────────────────────────────────────────────");
    try {
        const first = await db.User
            .where(u => u.name == $$, 'NonExistent')
            .first();

        if (first === null) {
            console.log("   ✓ .first() returns null if no records");
            passed++;
        } else {
            console.log(`   ✗ .first() should return null`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 8: .pluck() with ordering
    console.log("\n📝 Test 8: .pluck() respects ordering");
    console.log("──────────────────────────────────────────────────");
    try {
        const names = await db.User
            .orderBy(u => u.name)
            .pluck('name');

        if (names[0] === 'Alice' && names[4] === 'Eve') {
            console.log("   ✓ .pluck() respects orderBy");
            passed++;
        } else {
            console.log(`   ✗ .pluck() ordering failed`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Summary
    console.log("\n" + "=".repeat(64));
    console.log(`Test Results: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(64));

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
