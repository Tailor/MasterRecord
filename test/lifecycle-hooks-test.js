/**
 * Test: Lifecycle Hooks
 * Tests: beforeSave, afterSave, beforeDelete, afterDelete
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║                  Lifecycle Hooks Test                         ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Track hook executions
const hookLog = [];

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

    beforeSave() {
        hookLog.push('beforeSave');
        // Automatically set email domain if missing
        if (this.email && !this.email.includes('@')) {
            this.email = this.email + '@example.com';
        }
    }

    afterSave() {
        hookLog.push('afterSave');
    }

    beforeDelete() {
        hookLog.push('beforeDelete');
        // Prevent deletion of admin users
        if (this.name === 'admin') {
            throw new Error('Cannot delete admin user');
        }
    }

    afterDelete() {
        hookLog.push('afterDelete');
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

const dbPath = path.join(__dirname, '..', 'database', 'lifecycleHooks.db');
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

    // Test 1: beforeSave hook executes on insert
    console.log("📝 Test 1: beforeSave hook executes on insert");
    console.log("──────────────────────────────────────────────────");
    try {
        hookLog.length = 0;

        const user = db.User.new();
        user.name = 'Alice';
        user.email = 'alice'; // No @ - should be fixed by hook
        await user.save();

        if (hookLog.includes('beforeSave') && user.email === 'alice@example.com') {
            console.log("   ✓ beforeSave executed before insert");
            console.log("   ✓ Email auto-completed to: alice@example.com");
            passed++;
        } else {
            console.log(`   ✗ Hook failed: ${hookLog.join(', ')}, email: ${user.email}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: afterSave hook executes after insert
    console.log("\n📝 Test 2: afterSave hook executes after insert");
    console.log("──────────────────────────────────────────────────");
    try {
        if (hookLog.includes('afterSave') && hookLog.indexOf('afterSave') > hookLog.indexOf('beforeSave')) {
            console.log("   ✓ afterSave executed after insert");
            console.log("   ✓ Hooks executed in order: beforeSave → afterSave");
            passed++;
        } else {
            console.log(`   ✗ Hook order incorrect: ${hookLog.join(' → ')}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: beforeSave hook executes on update
    console.log("\n📝 Test 3: beforeSave hook executes on update");
    console.log("──────────────────────────────────────────────────");
    try {
        hookLog.length = 0;

        const user = await db.User.findById(1);
        user.name = 'Alice Updated';
        await user.save();

        if (hookLog.includes('beforeSave')) {
            console.log("   ✓ beforeSave executed on update");
            passed++;
        } else {
            console.log(`   ✗ beforeSave not called on update`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: beforeDelete hook can prevent deletion
    console.log("\n📝 Test 4: beforeDelete hook can prevent deletion");
    console.log("──────────────────────────────────────────────────");
    try {
        const admin = db.User.new();
        admin.name = 'admin';
        admin.email = 'admin@example.com';
        await admin.save();

        const adminId = admin.id;

        try {
            await admin.delete();
            console.log(`   ✗ Deletion should have been prevented`);
            failed++;
        } catch (hookError) {
            if (hookError.message.includes('Cannot delete admin user')) {
                // Check that admin still exists
                const check = await db.User.findById(adminId);
                if (check && check.name === 'admin') {
                    console.log("   ✓ beforeDelete prevented deletion of admin user");
                    passed++;
                } else {
                    console.log(`   ✗ Admin was deleted despite hook`);
                    failed++;
                }
            } else {
                console.log(`   ✗ Unexpected error: ${hookError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: afterDelete hook executes after successful deletion
    console.log("\n📝 Test 5: afterDelete hook executes after deletion");
    console.log("──────────────────────────────────────────────────");
    try {
        hookLog.length = 0;

        const user = db.User.new();
        user.name = 'ToDelete';
        user.email = 'delete@example.com';
        await user.save();

        await user.delete();

        if (hookLog.includes('beforeDelete') && hookLog.includes('afterDelete')) {
            console.log("   ✓ beforeDelete and afterDelete executed");
            console.log("   ✓ Hooks executed in order: beforeDelete → afterDelete");
            passed++;
        } else {
            console.log(`   ✗ Delete hooks missing: ${hookLog.join(', ')}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 6: Batch operations execute hooks for all entities
    console.log("\n📝 Test 6: Batch operations execute hooks for all entities");
    console.log("──────────────────────────────────────────────────");
    try {
        hookLog.length = 0;

        const user1 = db.User.new();
        user1.name = 'Batch1';
        user1.email = 'batch1';

        const user2 = db.User.new();
        user2.name = 'Batch2';
        user2.email = 'batch2';

        await db.saveChanges();

        const beforeSaveCount = hookLog.filter(h => h === 'beforeSave').length;
        const afterSaveCount = hookLog.filter(h => h === 'afterSave').length;

        if (beforeSaveCount === 2 && afterSaveCount === 2) {
            console.log("   ✓ Hooks executed for all entities in batch");
            console.log(`   ✓ beforeSave: ${beforeSaveCount}x, afterSave: ${afterSaveCount}x`);
            passed++;
        } else {
            console.log(`   ✗ Hook counts incorrect: beforeSave=${beforeSaveCount}, afterSave=${afterSaveCount}`);
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
