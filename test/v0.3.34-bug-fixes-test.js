/**
 * Comprehensive Tests for v0.3.34 Bug Fixes
 *
 * Tests:
 * 1. Whitelist validation in query builders
 * 2. No duplicate index creation
 * 3. Seed API migration generation (no duplicates, correct API usage)
 * 4. All async operations have await keywords
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║            MasterRecord v0.3.34 Bug Fixes Test                ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

const Migrations = require('../Migrations/migrations');
const MigrationSQLiteQuery = require('../Migrations/migrationSQLiteQuery');
const MigrationMySQLQuery = require('../Migrations/migrationMySQLQuery');
const MigrationPostgresQuery = require('../Migrations/migrationPostgresQuery');

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
    } catch (e) {
        console.log(`❌ FAIL: ${description}`);
        console.log(`   Error: ${e.message}`);
        failed++;
    }
}

// =============================================================================
// Test Suite 1: Whitelist Validation
// =============================================================================
console.log("\n📋 Test Suite 1: Whitelist Validation in Query Builders\n");

test('SQLite query builder skips objects without name property', () => {
    const queryBuilder = new MigrationSQLiteQuery();
    const table = {
        __name: 'TestTable',
        id: { name: 'id', type: 'integer', primaryKey: true },
        weirdMetadata: { foo: 'bar' },  // No name or type - should be skipped
        name: { name: 'name', type: 'string' }
    };

    const query = queryBuilder.createTable(table);

    assert(!query.includes('undefined'), 'SQLite: Should not contain undefined');
    assert(query.includes('id'), 'SQLite: Should contain id column');
    assert(query.includes('name'), 'SQLite: Should contain name column');
    assert(!query.includes('foo'), 'SQLite: Should not process metadata without name/type');
});

test('MySQL query builder skips objects without name property', () => {
    const queryBuilder = new MigrationMySQLQuery();
    const table = {
        __name: 'TestTable',
        id: { name: 'id', type: 'integer', primaryKey: true },
        weirdMetadata: { foo: 'bar' },
        name: { name: 'name', type: 'string' }
    };

    const query = queryBuilder.createTable(table);

    assert(!query.includes('undefined'), 'MySQL: Should not contain undefined');
    assert(query.includes('id'), 'MySQL: Should contain id column');
    assert(query.includes('name'), 'MySQL: Should contain name column');
});

test('PostgreSQL query builder skips objects without name property', () => {
    const queryBuilder = new MigrationPostgresQuery();
    const table = {
        __name: 'TestTable',
        id: { name: 'id', type: 'integer', primaryKey: true },
        weirdMetadata: { foo: 'bar' },
        name: { name: 'name', type: 'string' }
    };

    const query = queryBuilder.createTable(table);

    assert(!query.includes('undefined'), 'PostgreSQL: Should not contain undefined');
    assert(query.includes('id'), 'PostgreSQL: Should contain id column');
    assert(query.includes('name'), 'PostgreSQL: Should contain name column');
});

test('Query builders correctly skip indexes property', () => {
    const queryBuilder = new MigrationSQLiteQuery();
    const table = {
        __name: 'TestTable',
        id: { name: 'id', type: 'integer', primaryKey: true },
        email: { name: 'email', type: 'string', indexes: ['idx_email'] },
        indexes: ['some', 'array']  // This is metadata, should be skipped
    };

    const query = queryBuilder.createTable(table);

    assert(!query.includes('undefined'), 'Should not contain undefined');
    assert(query.includes('email'), 'Should contain email column');
    assert(!query.match(/some.*NOT NULL/), 'Should not process indexes array as column');
});

// =============================================================================
// Test Suite 2: Index Creation with Await
// =============================================================================
console.log("\n📋 Test Suite 2: Index Creation with Await Keywords\n");

test('createIndex generates code with await keyword', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [{
        __name: 'User',
        id: { name: 'id', type: 'integer', primaryKey: true },
        email: { name: 'email', type: 'text', indexes: ['idx_user_email'] }
    }];

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema);

    const createIndexMatches = migrationCode.match(/await this\.createIndex/g);
    assert(createIndexMatches && createIndexMatches.length > 0, 'createIndex should have await keyword');
    assert(!migrationCode.match(/\n\s+this\.createIndex\(/), 'Should not have createIndex without await');
});

test('createCompositeIndex generates code with await keyword', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [{
        __name: 'User',
        id: { name: 'id', type: 'integer' },
        __compositeIndexes: [{
            name: 'idx_composite',
            columns: ['col1', 'col2'],
            unique: false
        }]
    }];

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema);

    const compositeMatches = migrationCode.match(/await this\.createCompositeIndex/g);
    assert(compositeMatches && compositeMatches.length > 0, 'createCompositeIndex should have await keyword');
});

// =============================================================================
// Test Suite 3: Seed API Migration Generation
// =============================================================================
console.log("\n📋 Test Suite 3: Seed API Migration Generation\n");

test('Seed data uses correct API (this.seed instead of table.EntityName.create)', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [{
        __name: 'Settings',
        id: { name: 'id', type: 'integer', primaryKey: true },
        disable_rag: { name: 'disable_rag', type: 'integer' }
    }];
    const seedData = {
        Settings: [{ disable_rag: 0 }]
    };

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema, seedData);

    assert(migrationCode.includes("this.seed('Settings'"), 'Should use this.seed() method');
    assert(!migrationCode.includes('table.Settings.create'), 'Should NOT use table.Settings.create()');
});

test('No duplicate createTable calls for tables with seed data', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [
        {
            __name: 'Document',
            id: { name: 'id', type: 'integer', primaryKey: true }
        },
        {
            __name: 'Settings',
            id: { name: 'id', type: 'integer', primaryKey: true }
        }
    ];
    const seedData = {
        Settings: [{ id: 1 }]
    };

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema, seedData);

    const settingsCreateMatches = migrationCode.match(/createTable\(table\.Settings\)/g);
    const settingsCreateCount = settingsCreateMatches ? settingsCreateMatches.length : 0;

    assert(settingsCreateCount === 1, `Expected 1 createTable for Settings, got ${settingsCreateCount}`);
});

test('No duplicate seed insertion calls', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [{
        __name: 'Settings',
        id: { name: 'id', type: 'integer', primaryKey: true }
    }];
    const seedData = {
        Settings: [{ id: 1, value: 'test' }]
    };

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema, seedData);

    const seedMatches = migrationCode.match(/this\.seed\('Settings'/g);
    const seedCount = seedMatches ? seedMatches.length : 0;

    assert(seedCount === 1, `Expected 1 seed call, got ${seedCount}`);
});

test('No duplicate dropTable calls in down migration', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [{
        __name: 'Settings',
        id: { name: 'id', type: 'integer', primaryKey: true }
    }];
    const seedData = {
        Settings: [{ id: 1 }]
    };

    const migrationCode = migrations.template('TestMigration', oldSchema, newSchema, seedData);

    const dropMatches = migrationCode.match(/dropTable\(table\.Settings\)/g);
    const dropCount = dropMatches ? dropMatches.length : 0;

    assert(dropCount === 1, `Expected 1 dropTable call, got ${dropCount}`);
});

test('Complex scenario: Multiple tables with seed data, indexes, and composite indexes', () => {
    const migrations = new Migrations();
    const oldSchema = [];
    const newSchema = [
        {
            __name: 'Document',
            id: { name: 'id', type: 'integer', primaryKey: true },
            embedding_model_id: { name: 'embedding_model_id', type: 'integer', indexes: ['idx_doc_embed'] }
        },
        {
            __name: 'DocumentChunk',
            id: { name: 'id', type: 'integer', primaryKey: true },
            __compositeIndexes: [{
                name: 'idx_chunk_unique',
                columns: ['doc_id', 'chunk_index'],
                unique: true
            }]
        },
        {
            __name: 'Settings',
            id: { name: 'id', type: 'integer', primaryKey: true },
            disable_rag: { name: 'disable_rag', type: 'integer' }
        },
        {
            __name: 'Job',
            id: { name: 'id', type: 'integer', primaryKey: true }
        }
    ];
    const seedData = {
        Settings: [{ disable_rag: 0 }]
    };

    const migrationCode = migrations.template('InitialCreate', oldSchema, newSchema, seedData);

    // Check each table appears exactly once
    const docCreate = (migrationCode.match(/createTable\(table\.Document\)/g) || []).length;
    const chunkCreate = (migrationCode.match(/createTable\(table\.DocumentChunk\)/g) || []).length;
    const settingsCreate = (migrationCode.match(/createTable\(table\.Settings\)/g) || []).length;
    const jobCreate = (migrationCode.match(/createTable\(table\.Job\)/g) || []).length;

    assert(docCreate === 1, `Document: Expected 1 createTable, got ${docCreate}`);
    assert(chunkCreate === 1, `DocumentChunk: Expected 1 createTable, got ${chunkCreate}`);
    assert(settingsCreate === 1, `Settings: Expected 1 createTable, got ${settingsCreate}`);
    assert(jobCreate === 1, `Job: Expected 1 createTable, got ${jobCreate}`);

    // Check seed uses correct API
    assert(migrationCode.includes("this.seed('Settings'"), 'Should use this.seed() for Settings');
    assert(!migrationCode.includes('table.Settings.create'), 'Should NOT use table.Settings.create');

    // Check indexes have await
    assert(migrationCode.includes('await this.createIndex'), 'Indexes should have await');
    assert(migrationCode.includes('await this.createCompositeIndex'), 'Composite indexes should have await');
});

// =============================================================================
// Test Results Summary
// =============================================================================
console.log("\n" + "=".repeat(68));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
    console.log("✅ All tests passed! v0.3.34 fixes are working correctly.\n");
    process.exit(0);
} else {
    console.log(`⚠️  ${failed} test(s) failed. Please review the output above.\n`);
    process.exit(1);
}
