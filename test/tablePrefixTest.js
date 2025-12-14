// Test for tablePrefix functionality
// Run with: node test/tablePrefixTest.js

var masterrecord = require('../MasterRecord');

// Define a simple test model
class TestUser extends masterrecord.model {
    id(db) {
        db.integer().primaryKey().autoIncrement();
    }

    name(db) {
        db.string();
    }

    email(db) {
        db.string();
    }
}

class TestPost extends masterrecord.model {
    id(db) {
        db.integer().primaryKey().autoIncrement();
    }

    title(db) {
        db.string();
    }
}

// Test 1: Context WITHOUT prefix
class TestContextNoPrefix extends masterrecord.context {
    constructor() {
        super();
        this.dbset(TestUser, 'User');
        this.dbset(TestPost, 'Post');
    }
}

// Test 2: Context WITH prefix
class TestContextWithPrefix extends masterrecord.context {
    constructor() {
        super();
        this.tablePrefix = 'myapp_';
        this.dbset(TestUser, 'User');
        this.dbset(TestPost, 'Post');
    }
}

// Test 3: Context WITH prefix using default names
class TestContextWithPrefixDefault extends masterrecord.context {
    constructor() {
        super();
        this.tablePrefix = 'test_';
        this.dbset(TestUser);
        this.dbset(TestPost);
    }
}

// Run tests
console.log('=== MasterRecord tablePrefix Tests ===\n');

// Test 1: No prefix
console.log('Test 1: Context without prefix');
const ctx1 = new TestContextNoPrefix();
const user1TableName = ctx1.__entities[0].__name;
const post1TableName = ctx1.__entities[1].__name;
console.log(`  User table name: ${user1TableName}`);
console.log(`  Post table name: ${post1TableName}`);
console.log(`  Expected: User, Post`);
console.log(`  Result: ${user1TableName === 'User' && post1TableName === 'Post' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 2: With prefix and custom names
console.log('Test 2: Context with prefix "myapp_" and custom table names');
const ctx2 = new TestContextWithPrefix();
const user2TableName = ctx2.__entities[0].__name;
const post2TableName = ctx2.__entities[1].__name;
console.log(`  User table name: ${user2TableName}`);
console.log(`  Post table name: ${post2TableName}`);
console.log(`  Expected: myapp_User, myapp_Post`);
console.log(`  Result: ${user2TableName === 'myapp_User' && post2TableName === 'myapp_Post' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 3: With prefix using default names
console.log('Test 3: Context with prefix "test_" and default table names');
const ctx3 = new TestContextWithPrefixDefault();
const user3TableName = ctx3.__entities[0].__name;
const post3TableName = ctx3.__entities[1].__name;
console.log(`  TestUser table name: ${user3TableName}`);
console.log(`  TestPost table name: ${post3TableName}`);
console.log(`  Expected: test_TestUser, test_TestPost`);
console.log(`  Result: ${user3TableName === 'test_TestUser' && post3TableName === 'test_TestPost' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 4: Verify query builder has correct table name
console.log('Test 4: Query builder references');
console.log(`  ctx2.myapp_User exists: ${ctx2.myapp_User !== undefined ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  ctx2.myapp_Post exists: ${ctx2.myapp_Post !== undefined ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  ctx3.test_TestUser exists: ${ctx3.test_TestUser !== undefined ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  ctx3.test_TestPost exists: ${ctx3.test_TestPost !== undefined ? '✓ PASS' : '✗ FAIL'}\n`);

console.log('=== Tests Complete ===');
