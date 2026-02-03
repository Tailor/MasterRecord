/**
 * Test: Business Logic Validation
 * Tests: required, email, minLength, maxLength, pattern, min, max, custom
 */

const masterrecord = require('../MasterRecord.js');
const path = require('path');
const fs = require('fs');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              Business Logic Validation Test                   ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

class User {
    id(db) {
        db.integer().primary().auto();
    }
    name(db) {
        db.string().required('Name is required').minLength(3, 'Name must be at least 3 characters');
    }
    email(db) {
        db.string().required().email('Invalid email format');
    }
    password(db) {
        db.string().minLength(8, 'Password must be at least 8 characters').maxLength(100);
    }
    username(db) {
        db.string().pattern(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');
    }
    age(db) {
        db.integer().min(18, 'Must be at least 18 years old').max(120, 'Age cannot exceed 120');
    }
    status(db) {
        db.string().custom((value) => {
            return ['active', 'inactive', 'pending'].includes(value);
        }, 'Status must be active, inactive, or pending');
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

const dbPath = path.join(__dirname, '..', 'database', 'validation.db');
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
    db.db.exec('CREATE TABLE IF NOT EXISTS User (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, password TEXT, username TEXT, age INTEGER, status TEXT)');

    // Test 1: required() validation
    console.log("📝 Test 1: required() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.name = '';
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('Name is required')) {
                console.log("   ✓ required() prevents empty values");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 2: email() validation
    console.log("\n📝 Test 2: email() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.email = 'not-an-email';
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('Invalid email format')) {
                console.log("   ✓ email() rejects invalid format");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 3: minLength() validation
    console.log("\n📝 Test 3: minLength() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.name = 'AB'; // Too short
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('at least 3 characters')) {
                console.log("   ✓ minLength() enforces minimum length");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 4: maxLength() validation
    console.log("\n📝 Test 4: maxLength() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.password = 'a'.repeat(101); // Too long
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('at most 100 characters')) {
                console.log("   ✓ maxLength() enforces maximum length");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 5: pattern() validation
    console.log("\n📝 Test 5: pattern() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.username = 'user@name'; // Invalid character @
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('letters, numbers, and underscores')) {
                console.log("   ✓ pattern() enforces regex pattern");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 6: min() validation for numbers
    console.log("\n📝 Test 6: min() validation for numbers");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.age = 17; // Too young
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('at least 18')) {
                console.log("   ✓ min() enforces minimum value");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 7: max() validation for numbers
    console.log("\n📝 Test 7: max() validation for numbers");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.age = 121; // Too old
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('cannot exceed 120')) {
                console.log("   ✓ max() enforces maximum value");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 8: custom() validation
    console.log("\n📝 Test 8: custom() validation");
    console.log("──────────────────────────────────────────────────");
    try {
        const user = db.User.new();
        try {
            user.status = 'invalid-status';
            console.log(`   ✗ Should have thrown validation error`);
            failed++;
        } catch (validationError) {
            if (validationError.message.includes('active, inactive, or pending')) {
                console.log("   ✓ custom() executes custom validation function");
                passed++;
            } else {
                console.log(`   ✗ Wrong error: ${validationError.message}`);
                failed++;
            }
        }
    } catch(err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // Test 9: Valid data passes all validations
    console.log("\n📝 Test 9: Valid data passes all validations");
    console.log("──────────────────────────────────────────────────");
    try {
        // Clear tracked entities from previous tests (they have invalid/missing values)
        db.__trackedEntities = [];
        db.__trackedEntitiesMap = new Map();

        const user = db.User.new();
        user.name = 'John Doe';
        user.email = 'john@example.com';
        user.password = 'secure-password-123';
        user.username = 'john_doe_123';
        user.age = 25;
        user.status = 'active';
        await user.save();

        if (user.id) {
            console.log("   ✓ Valid data passes all validations");
            console.log(`   ✓ Entity saved with ID: ${user.id}`);
            passed++;
        } else {
            console.log(`   ✗ Entity not saved`);
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
