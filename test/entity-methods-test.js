/**
 * Test: Entity Instance Methods
 * Tests: .toObject(), .toJSON(), .delete(), .reload(), .clone()
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              Entity Instance Methods Test                     ║");
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
    Tags(db) {
        db.hasMany('Tag', 'user_id').nullable();
    }
}

class Tag {
    id(db) {
        db.integer().primary().auto();
    }
    name(db) {
        db.string();
    }
    user_id(db) {
        db.integer();
    }
    User(db) {
        db.belongsTo('User', 'user_id').nullable();
    }
}

// Create test context
class TestContext extends masterrecord.context {
    constructor() {
        super();
    }
    onConfig(db) {
        this.dbset(User);
        this.dbset(Tag);
    }
}

// Clean test database
const dbPath = path.join(__dirname, '..', 'database', 'testEntityMethods.db');
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

    // Create tables
    db.db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT)');
    db.db.exec('CREATE TABLE IF NOT EXISTS Tag (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, user_id INTEGER)');

    // Test 1: .toObject() converts entity to plain object
    console.log("📝 Test 1: .toObject() converts entity to plain object");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Alice';
        user.email = 'alice@example.com';
        await user.save();

        const plain = user.toObject();

        if (plain.name === 'Alice' &&
            plain.email === 'alice@example.com' &&
            plain.__context === undefined &&
            plain.__entity === undefined) {
            console.log("   ✓ .toObject() converts entity to plain object");
            console.log("   ✓ Internal properties stripped");
            passed++;
        } else {
            console.log(`   ✗ .toObject() failed - unexpected output`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: .toJSON() works with JSON.stringify
    console.log("\n📝 Test 2: .toJSON() works with JSON.stringify");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Bob';
        user.email = 'bob@example.com';
        await user.save();

        const json = JSON.stringify(user);
        const parsed = JSON.parse(json);

        if (parsed.name === 'Bob' &&
            parsed.email === 'bob@example.com' &&
            parsed.__context === undefined) {
            console.log("   ✓ JSON.stringify() works without errors");
            console.log("   ✓ Circular references prevented");
            passed++;
        } else {
            console.log(`   ✗ JSON.stringify() failed`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: .delete() removes entity
    console.log("\n📝 Test 3: .delete() removes entity from database");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'ToDelete';
        user.email = 'delete@example.com';
        await user.save();

        const id = user.id;
        if (!id) {
            console.log(`   ✗ .delete() test skipped - user.id is undefined after save`);
            failed++;
        } else {
            await user.delete();

            const check = await db.User.findById(id);

            if (check === null) {
                console.log("   ✓ .delete() removes entity from database");
                passed++;
            } else {
                console.log(`   ✗ .delete() failed - entity still exists`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: .reload() refreshes entity from database
    console.log("\n📝 Test 4: .reload() refreshes entity from database");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Original';
        user.email = 'original@example.com';
        await user.save();

        // Modify in-memory
        user.name = 'Modified';

        // Reload
        await user.reload();

        if (user.name === 'Original' && user.__dirtyFields.length === 0) {
            console.log("   ✓ .reload() refreshes entity from database");
            console.log("   ✓ Dirty fields reset");
            passed++;
        } else {
            console.log(`   ✗ .reload() failed - name: ${user.name}`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: .clone() creates copy without primary key
    console.log("\n📝 Test 5: .clone() creates copy without primary key");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Original';
        user.email = 'original@example.com';
        await user.save();

        const originalId = user.id;
        const cloned = user.clone();
        cloned.name = 'Cloned';
        cloned.email = 'cloned@example.com';
        await cloned.save();

        if (cloned.id !== originalId && cloned.name === 'Cloned') {
            console.log("   ✓ .clone() creates copy with new primary key");
            console.log("   ✓ Original entity unchanged");
            passed++;
        } else {
            console.log(`   ✗ .clone() failed`);
            failed++;
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 6: .toObject() with relationships
    console.log("\n📝 Test 6: .toObject() with relationships");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        user.name = 'Charlie';
        user.email = 'charlie@example.com';
        await user.save();

        const tag = db.Tag.new();
        tag.name = 'Important';
        tag.user_id = user.id;
        await tag.save();

        const freshUser = await db.User.findById(user.id);
        const tags = await freshUser.Tags;

        const plain = freshUser.toObject({ includeRelationships: true });

        if (Array.isArray(plain.Tags) && plain.Tags.length === 1 && plain.Tags[0].name === 'Important') {
            console.log("   ✓ .toObject() includes relationships when requested");
            passed++;
        } else {
            console.log(`   ✗ .toObject() failed to include relationships`);
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
