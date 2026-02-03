/**
 * Single user ID test
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

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

// Clean
const dbPath = path.join(__dirname, '..', 'database', 'singleUserTest.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

async function test() {
    const db = new TestContext();

    // Manually initialize SQLite for testing
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

    const user = db.User.new();
    user.name = 'Test';

    console.log('Before save - user.id:', user.id);
    console.log('Before save - tracked:', db.__trackedEntities.length);

    await user.save();

    console.log('After save - user.id:', user.id);
    console.log('After save - user.__proto__._id:', user.__proto__._id);

    if (user.id) {
        console.log('✓ SUCCESS - ID was set to:', user.id);
    } else {
        console.log('✗ FAIL - ID is still undefined');
    }
}

test().catch(console.error);
