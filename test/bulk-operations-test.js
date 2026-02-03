/**
 * Test: Bulk Operations API
 * Tests: bulkCreate, bulkUpdate, bulkDelete
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║                 Bulk Operations API Test                      ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

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
    status(db) {
        db.string();
    }
}

class TestContext extends masterrecord.context {
    constructor() {
        super();
    }
    onConfig(db) {
        this.dbset(User);
    }
}

const dbPath = path.join(__dirname, '..', 'database', 'bulkOperations.db');
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
    db.db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, status TEXT)');

    // Test 1: bulkCreate creates multiple entities
    console.log("📝 Test 1: bulkCreate creates multiple entities");
    console.log("──────────────────────────────────────────────────");
    try {
        const users = await db.bulkCreate('User', [
            { name: 'Alice', email: 'alice@example.com', status: 'active' },
            { name: 'Bob', email: 'bob@example.com', status: 'active' },
            { name: 'Charlie', email: 'charlie@example.com', status: 'inactive' },
            { name: 'Dave', email: 'dave@example.com', status: 'active' },
            { name: 'Eve', email: 'eve@example.com', status: 'pending' }
        ]);

        if (users.length === 5 && users.every(u => u.id)) {
            console.log("   ✓ Created 5 entities");
            console.log(`   ✓ All entities have IDs: ${users.map(u => u.id).join(', ')}`);
            passed++;
        } else {
            console.log(`   ✗ bulkCreate failed: ${users.length} entities created`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: bulkCreate returns entities in order
    console.log("\n📝 Test 2: bulkCreate returns entities in order");
    console.log("──────────────────────────────────────────────────");
    try {
        const users = await db.User.toList();
        const names = users.map(u => u.name);

        if (names[0] === 'Alice' && names[4] === 'Eve') {
            console.log("   ✓ Entities created in correct order");
            passed++;
        } else {
            console.log(`   ✗ Order incorrect: ${names.join(', ')}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: bulkUpdate updates multiple entities
    console.log("\n📝 Test 3: bulkUpdate updates multiple entities");
    console.log("──────────────────────────────────────────────────");
    try {
        await db.bulkUpdate('User', [
            { id: 1, status: 'inactive' },
            { id: 2, status: 'inactive' },
            { id: 4, status: 'inactive' }
        ]);

        const user1 = await db.User.findById(1);
        const user2 = await db.User.findById(2);
        const user4 = await db.User.findById(4);

        if (user1.status === 'inactive' && user2.status === 'inactive' && user4.status === 'inactive') {
            console.log("   ✓ Updated 3 entities");
            console.log("   ✓ Status changed to: inactive");
            passed++;
        } else {
            console.log(`   ✗ Update failed: statuses are ${user1.status}, ${user2.status}, ${user4.status}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: bulkUpdate leaves other fields unchanged
    console.log("\n📝 Test 4: bulkUpdate leaves other fields unchanged");
    console.log("──────────────────────────────────────────────────");
    try {
        const user1 = await db.User.findById(1);

        if (user1.name === 'Alice' && user1.email === 'alice@example.com') {
            console.log("   ✓ Other fields unchanged");
            passed++;
        } else {
            console.log(`   ✗ Fields changed: name=${user1.name}, email=${user1.email}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: bulkDelete deletes multiple entities
    console.log("\n📝 Test 5: bulkDelete deletes multiple entities");
    console.log("──────────────────────────────────────────────────");
    try {
        await db.bulkDelete('User', [3, 5]);

        const user3 = await db.User.findById(3);
        const user5 = await db.User.findById(5);
        const remaining = await db.User.toList();

        if (user3 === null && user5 === null && remaining.length === 3) {
            console.log("   ✓ Deleted 2 entities");
            console.log(`   ✓ Remaining entities: ${remaining.length}`);
            passed++;
        } else {
            console.log(`   ✗ Delete failed: user3=${user3}, user5=${user5}, remaining=${remaining.length}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 6: bulkCreate with empty array throws error
    console.log("\n📝 Test 6: bulkCreate with empty array throws error");
    console.log("──────────────────────────────────────────────────");
    try {
        await db.bulkCreate('User', []);
        console.log(`   ✗ Should have thrown error`);
        failed++;
    } catch(err) {
        if (err.message.includes('non-empty array')) {
            console.log("   ✓ Empty array rejected");
            passed++;
        } else {
            console.log(`   ✗ Wrong error: ${err.message}`);
            failed++;
        }
    }

    // Test 7: bulkUpdate with invalid entity throws error
    console.log("\n📝 Test 7: bulkUpdate with invalid entity throws error");
    console.log("──────────────────────────────────────────────────");
    try {
        await db.bulkUpdate('NonExistentEntity', [{ id: 1, name: 'Test' }]);
        console.log(`   ✗ Should have thrown error`);
        failed++;
    } catch(err) {
        if (err.message.includes('not found')) {
            console.log("   ✓ Invalid entity name rejected");
            passed++;
        } else {
            console.log(`   ✗ Wrong error: ${err.message}`);
            failed++;
        }
    }

    // Test 8: bulkDelete with non-existent IDs doesn't throw
    console.log("\n📝 Test 8: bulkDelete with non-existent IDs doesn't throw");
    console.log("──────────────────────────────────────────────────");
    try {
        await db.bulkDelete('User', [999, 1000, 1001]);
        console.log("   ✓ Non-existent IDs handled gracefully");
        passed++;
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
