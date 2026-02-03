/**
 * Debug test to trace ID setting
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
        this.database = path.join(__dirname, '..', 'database', 'debugIdTest.db');
    }
    onConfig(db) {
        this.dbset(User);
    }
}

// Clean
if (fs.existsSync(path.join(__dirname, '..', 'database', 'debugIdTest.db'))) {
    fs.unlinkSync(path.join(__dirname, '..', 'database', 'debugIdTest.db'));
}

async function test() {
    const db = new TestContext();
    db.onConfig();

    const user = db.User.new();
    user.name = 'Test';

    console.log('\n=== Manual ID set test ===');
    console.log('Before manual set - user.id:', user.id);

    user.id = 123;
    console.log('After user.id = 123 - user.id:', user.id);
    console.log('After manual set - user.__proto__._id:', user.__proto__._id);

    user.id = 456;
    console.log('After user.id = 456 - user.id:', user.id);

    console.log('\n=== Now test with save ===');
    const user2 = db.User.new();
    user2.name = 'Test2';

    console.log('Before save - tracked entities:', db.__trackedEntities.length);
    console.log('Before save - user2.__state:', user2.__state);

    await user2.save();

    console.log('After save - user2.id:', user2.id);
    console.log('After save - user2.__proto__._id:', user2.__proto__._id);
}

test().catch(console.error);
