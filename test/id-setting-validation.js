/**
 * Validation Test: Auto-Increment ID Setting
 *
 * Confirms the critical bug fix: IDs are properly set back on entities after insert
 * Tests both single and batch insert paths
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║          Auto-Increment ID Setting Validation Test            ║");
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
}

class TestContext extends masterrecord.context {
    constructor() {
        super();
    }
    onConfig(db) {
        this.dbset(User);
    }
}

const dbPath = path.join(__dirname, '..', 'database', 'idValidation.db');
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
    db.db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');

    // Test 1: Single insert sets ID
    console.log("📝 Test 1: Single insert sets ID (insertManager path)");
    console.log("──────────────────────────────────────────────────");
    try {
        const user1 = db.User.new();
        user1.name = 'User 1';
        await user1.save();

        if (user1.id === 1) {
            console.log("   ✓ Single insert: ID = 1");
            passed++;
        } else {
            console.log(`   ✗ Single insert: ID = ${user1.id} (expected 1)`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: Batch insert sets IDs (2 entities triggers bulkInsert path)
    console.log("\n📝 Test 2: Batch insert sets IDs (bulkInsert path)");
    console.log("──────────────────────────────────────────────────");
    try {
        const user2 = db.User.new();
        user2.name = 'User 2';

        const user3 = db.User.new();
        user3.name = 'User 3';

        await db.saveChanges(); // Batch insert

        if (user2.id === 2 && user3.id === 3) {
            console.log("   ✓ Batch insert: IDs = 2, 3");
            passed++;
        } else {
            console.log(`   ✗ Batch insert: IDs = ${user2.id}, ${user3.id} (expected 2, 3)`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: Multiple batch inserts
    console.log("\n📝 Test 3: Multiple batch inserts maintain sequence");
    console.log("──────────────────────────────────────────────────");
    try {
        const users = [];
        for (let i = 0; i < 5; i++) {
            const user = db.User.new();
            user.name = `Batch User ${i}`;
            users.push(user);
        }

        await db.saveChanges();

        const ids = users.map(u => u.id);
        const expectedIds = [4, 5, 6, 7, 8];
        const allCorrect = ids.every((id, idx) => id === expectedIds[idx]);

        if (allCorrect) {
            console.log("   ✓ Batch insert: IDs = [4, 5, 6, 7, 8]");
            passed++;
        } else {
            console.log(`   ✗ Batch insert: IDs = [${ids.join(', ')}] (expected [4, 5, 6, 7, 8])`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: ID available immediately after save()
    console.log("\n📝 Test 4: ID available immediately after save()");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Immediate ID Test';

        const idBefore = user.id;
        await user.save();
        const idAfter = user.id;

        if (idBefore === undefined && idAfter === 9) {
            console.log("   ✓ ID undefined before save, set to 9 after save");
            passed++;
        } else {
            console.log(`   ✗ ID before: ${idBefore}, after: ${idAfter} (expected undefined, 9)`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: Can use ID immediately for relationships
    console.log("\n📝 Test 5: Can use ID immediately for relationships");
    console.log("──────────────────────────────────────────────────");
    try {
        const parent = db.User.new();
        parent.name = 'Parent';
        await parent.save();

        // Should be able to use parent.id immediately
        const parentId = parent.id;

        if (typeof parentId === 'number' && parentId === 10) {
            console.log("   ✓ ID available for immediate use: 10");
            passed++;
        } else {
            console.log(`   ✗ ID not available: ${parentId}`);
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

    if (failed === 0) {
        console.log("\n✅ ALL TESTS PASSED - ID setting bug is FIXED!");
        console.log("Auto-increment IDs are properly set for:");
        console.log("  • Single inserts (insertManager path)");
        console.log("  • Batch inserts (bulkInsert path)");
        console.log("  • Multiple sequential operations");
    } else {
        console.log("\n❌ SOME TESTS FAILED - Review output above");
    }

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
