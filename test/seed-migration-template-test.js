/**
 * Test: Seed Data Migration Template Generation
 *
 * Verifies that seed data correctly generates ORM-based migration code
 */

const MigrationTemplate = require('../Migrations/migrationTemplate');
const os = require('os');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       Seed Data Migration Template Generation Test            ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

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

function assertContains(haystack, needle, message) {
    if (!haystack.includes(needle)) {
        throw new Error(`${message}: expected to find "${needle}" in output`);
    }
}

function assertNotContains(haystack, needle, message) {
    if (haystack.includes(needle)) {
        throw new Error(`${message}: did not expect to find "${needle}" in output`);
    }
}

// Run tests
console.log("Running tests...\n");

test("Single seed record generates single-line create call", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Admin', email: 'admin@example.com' }
    ];

    MT.seedData('up', 'User', seedData);

    const output = MT.get();

    assertContains(output, 'await table.User.create(', 'Should contain create call');
    assertContains(output, '"name":"Admin"', 'Should contain name field');
    assertContains(output, '"email":"admin@example.com"', 'Should contain email field');
});

test("Multiple seed records generate multiple create calls", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { title: 'Post 1', content: 'Content 1' },
        { title: 'Post 2', content: 'Content 2' }
    ];

    MT.seedData('up', 'Post', seedData);

    const output = MT.get();

    assertContains(output, 'await table.Post.create(', 'Should contain create calls');
    assertContains(output, '"title":"Post 1"', 'Should contain Post 1');
    assertContains(output, '"title":"Post 2"', 'Should contain Post 2');
});

test("Large record generates multi-line formatted create call", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        {
            user_name: 'admin',
            first_name: 'System',
            last_name: 'Administrator',
            email: 'admin@bookbag.ai',
            system_role: 'system_admin',
            admin_type: 'engineering'
        }
    ];

    MT.seedData('up', 'User', seedData);

    const output = MT.get();

    // Large record (> 80 chars) should be multi-line
    assertContains(output, 'await table.User.create(', 'Should contain create call');
    assertContains(output, '"user_name"', 'Should contain user_name field');
    assertContains(output, '"system_role"', 'Should contain system_role field');
});

test("Empty seed data generates nothing", () => {
    const MT = new MigrationTemplate('TestMigration');

    MT.seedData('up', 'User', []);

    const output = MT.get();

    // Should not contain any User create calls
    assertNotContains(output, 'await table.User.create(', 'Should not contain create call');
});

test("Down migration does not generate seed code", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Admin', email: 'admin@example.com' }
    ];

    MT.seedData('down', 'User', seedData);

    const output = MT.get();

    // Down migrations should not contain seed data deletion
    // (as per design - seed data not removed in down migrations)
    const downSection = output.split('async down(table)')[1];
    assertNotContains(downSection, 'await table.User.create(', 'Down migration should not create seed data');
});

test("Seed data with special characters is properly escaped", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Test "Quote"', description: "It's working" }
    ];

    MT.seedData('up', 'Item', seedData);

    const output = MT.get();

    assertContains(output, 'await table.Item.create(', 'Should contain create call');
    // JSON.stringify handles escaping automatically
    assertContains(output, 'Test \\"Quote\\"', 'Should escape double quotes');
});

test("Seed data with null values is preserved", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Test', optional_field: null }
    ];

    MT.seedData('up', 'Item', seedData);

    const output = MT.get();

    assertContains(output, 'await table.Item.create(', 'Should contain create call');
    assertContains(output, '"optional_field":null', 'Should preserve null value');
});

test("Seed data with boolean values is preserved", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Admin', is_active: true, is_deleted: false }
    ];

    MT.seedData('up', 'User', seedData);

    const output = MT.get();

    assertContains(output, '"is_active":true', 'Should preserve true value');
    assertContains(output, '"is_deleted":false', 'Should preserve false value');
});

test("Seed data with numbers is preserved", () => {
    const MT = new MigrationTemplate('TestMigration');

    const seedData = [
        { name: 'Product', price: 19.99, quantity: 100, rating: 4.5 }
    ];

    MT.seedData('up', 'Product', seedData);

    const output = MT.get();

    assertContains(output, '"price":19.99', 'Should preserve decimal number');
    assertContains(output, '"quantity":100', 'Should preserve integer');
    assertContains(output, '"rating":4.5', 'Should preserve float');
});

test("Migration template structure is valid", () => {
    const MT = new MigrationTemplate('TestMigration_123');

    const seedData = [
        { name: 'Test User' }
    ];

    MT.seedData('up', 'User', seedData);

    const output = MT.get();

    // Verify basic structure
    assertContains(output, "class TestMigration_123 extends masterrecord.schema", 'Should have class definition');
    assertContains(output, "async up(table)", 'Should have up method');
    assertContains(output, "async down(table)", 'Should have down method');
    assertContains(output, "this.init(table)", 'Should initialize table');
    assertContains(output, "module.exports = TestMigration_123", 'Should export class');
});

// Print summary
console.log("\n" + "─".repeat(64));
console.log(`Tests completed: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.log("\n❌ Some tests failed");
    process.exit(1);
} else {
    console.log("\n✅ All tests passed!");
    process.exit(0);
}
