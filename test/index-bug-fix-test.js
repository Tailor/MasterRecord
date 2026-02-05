/**
 * Test: Index Bug Fix - createTable should not generate "undefined undefined NOT NULL"
 *
 * Verifies that .index() method doesn't cause malformed column definitions in CREATE TABLE statements
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║      Index Bug Fix Test - createTable() Method                ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

const MigrationSQLiteQuery = require('../Migrations/migrationSQLiteQuery.js');
const MigrationMySQLQuery = require('../Migrations/migrationMySQLQuery.js');
const MigrationPostgresQuery = require('../Migrations/migrationPostgresQuery.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.log(`❌ FAIL: ${message}`);
        failed++;
        return false;
    }
    return true;
}

function test(description, fn) {
    try {
        fn();
        console.log(`✓ ${description}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${description}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

// Mock table object with indexes property (simulates what EntityModel creates)
const mockTable = {
    __name: 'TestTable',
    id: {
        name: 'id',
        type: 'integer',
        nullable: false,
        primary: true,
        autoIncrement: true
    },
    organization_id: {
        name: 'organization_id',
        type: 'integer',
        nullable: false,
        indexes: ['idx_org']  // This property on the column caused the original bug
    },
    name: {
        name: 'name',
        type: 'string',
        nullable: false
    },
    // This is the problematic property that was being treated as a column
    indexes: ['idx_org']
};

console.log("Testing SQLite Query Builder...\n");

test('SQLite createTable should skip indexes property', () => {
    const sqliteQuery = new MigrationSQLiteQuery();
    const sql = sqliteQuery.createTable(mockTable);

    assert(!sql.includes('undefined undefined'),
        `SQL should not contain "undefined undefined" but got: ${sql}`);
    assert(sql.includes('id'), 'Should include id column');
    assert(sql.includes('organization_id'), 'Should include organization_id column');
    assert(sql.includes('name'), 'Should include name column');
    assert(sql.startsWith('CREATE TABLE IF NOT EXISTS TestTable'),
        'Should start with CREATE TABLE');

    console.log(`    Generated SQL: ${sql}\n`);
});

console.log("Testing MySQL Query Builder...\n");

test('MySQL createTable should skip indexes property', () => {
    const mysqlQuery = new MigrationMySQLQuery();
    const sql = mysqlQuery.createTable(mockTable);

    assert(!sql.includes('undefined undefined'),
        `SQL should not contain "undefined undefined" but got: ${sql}`);
    assert(sql.includes('id'), 'Should include id column');
    assert(sql.includes('organization_id'), 'Should include organization_id column');
    assert(sql.includes('name'), 'Should include name column');
    assert(sql.startsWith('CREATE TABLE IF NOT EXISTS `TestTable`'),
        'Should start with CREATE TABLE');

    console.log(`    Generated SQL: ${sql}\n`);
});

console.log("Testing PostgreSQL Query Builder...\n");

test('PostgreSQL createTable should skip indexes property', () => {
    const postgresQuery = new MigrationPostgresQuery();
    const sql = postgresQuery.createTable(mockTable);

    assert(!sql.includes('undefined undefined'),
        `SQL should not contain "undefined undefined" but got: ${sql}`);
    assert(sql.includes('id'), 'Should include id column');
    assert(sql.includes('organization_id'), 'Should include organization_id column');
    assert(sql.includes('name'), 'Should include name column');
    assert(sql.startsWith('CREATE TABLE IF NOT EXISTS "TestTable"'),
        'Should start with CREATE TABLE');

    console.log(`    Generated SQL: ${sql}\n`);
});

console.log("Testing metadata properties filtering...\n");

test('Should skip __compositeIndexes and other __ properties', () => {
    const tableWithMetadata = {
        ...mockTable,
        __compositeIndexes: [['col1', 'col2']],
        __someOtherMetadata: 'value'
    };

    const sqliteQuery = new MigrationSQLiteQuery();
    const sql = sqliteQuery.createTable(tableWithMetadata);

    assert(!sql.includes('undefined undefined'),
        `SQL should not contain "undefined undefined" but got: ${sql}`);

    const columnCount = (sql.match(/,/g) || []).length + 1;
    assert(columnCount === 3, `Should have exactly 3 columns (id, organization_id, name), got ${columnCount}`);
});

console.log("Testing relationships filtering...\n");

test('Should handle table with relationships correctly', () => {
    const tableWithRelations = {
        __name: 'User',
        id: {
            name: 'id',
            type: 'integer',
            nullable: false,
            primary: true
        },
        name: {
            name: 'name',
            type: 'string',
            nullable: false
        },
        posts: {
            name: 'posts',
            type: 'hasMany',
            target: 'Post'
        },
        profile: {
            name: 'profile',
            type: 'hasOne',
            target: 'Profile'
        },
        indexes: ['idx_user_name']
    };

    const sqliteQuery = new MigrationSQLiteQuery();
    const sql = sqliteQuery.createTable(tableWithRelations);

    assert(!sql.includes('hasMany'), 'Should not include hasMany');
    assert(!sql.includes('hasOne'), 'Should not include hasOne');
    assert(!sql.includes('undefined undefined'),
        `SQL should not contain "undefined undefined" but got: ${sql}`);
    assert(sql.includes('id'), 'Should include id column');
    assert(sql.includes('name'), 'Should include name column');
    assert(!sql.includes('posts'), 'Should not include posts relationship');
    assert(!sql.includes('profile'), 'Should not include profile relationship');

    console.log(`    Generated SQL: ${sql}\n`);
});

console.log("\n" + "=".repeat(64));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed > 0) {
    console.log("\n❌ Some tests failed!");
    process.exit(1);
} else {
    console.log("\n✅ All tests passed!");
    process.exit(0);
}
