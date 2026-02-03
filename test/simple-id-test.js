/**
 * Simple test to check if ID is set after save
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
        this.database = path.join(__dirname, '..', 'database', 'simpleIdTest.db');
    }
    onConfig(db) {
        this.dbset(User);
    }
}

// Clean
if (fs.existsSync(path.join(__dirname, '..', 'database', 'simpleIdTest.db'))) {
    fs.unlinkSync(path.join(__dirname, '..', 'database', 'simpleIdTest.db'));
}

async function test() {
    const db = new TestContext();
    db.onConfig();

    const user = db.User.new();
    user.name = 'Test';

    console.log('Before save - user.id:', user.id);
    console.log('Before save - user.__proto__:', Object.keys(user.__proto__));

    await user.save();

    console.log('After save - user.id:', user.id);
    console.log('After save - user.__proto__:', Object.keys(user.__proto__));
    console.log('After save - user.__proto__._id:', user.__proto__._id);

    // Try direct access
    console.log('Direct access test:');
    for (const key in user) {
        if (key === 'id') {
            console.log('Found id property via for-in');
        }
    }

    console.log('Has own property id?', user.hasOwnProperty('id'));
    console.log('Keys:', Object.keys(user));
}

test().catch(console.error);
