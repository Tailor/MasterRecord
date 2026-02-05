/**
 * Integration tests for all 5 seed data features
 * Tests: Down Migrations, Conditional Seeding, Dependency Ordering, Factory Integration, Upsert Semantics
 */

const assert = require('assert');
const context = require('../context');
const Migration = require('../Migrations/migrations');
const MigrationTemplate = require('../Migrations/migrationTemplate');
const DependencyGraph = require('../Migrations/dependencyGraph');

// Mock entity definitions for testing
class User {
    static __name = 'User';
    static id = { type: 'integer', primary: true };
    static name = { type: 'string' };
    static email = { type: 'string' };
    static org_id = {
        type: 'integer',
        relationshipType: 'belongsTo',
        foreignTable: 'Organization',
        foreignKey: 'org_id'
    };
}

class Organization {
    static __name = 'Organization';
    static id = { type: 'integer', primary: true };
    static name = { type: 'string' };
    static slug = { type: 'string' };
}

class Post {
    static __name = 'Post';
    static id = { type: 'integer', primary: true };
    static title = { type: 'string' };
    static user_id = {
        type: 'integer',
        relationshipType: 'belongsTo',
        foreignTable: 'User',
        foreignKey: 'user_id'
    };
}

// Test Context
class TestContext extends context {
    constructor() {
        super();
        this.__entities = [User, Organization, Post];
    }
}

describe('Seed Data Features - Integration Tests', function() {

    describe('Feature 1: Down Migrations', function() {
        it('should generate down migration code when enabled', function() {
            const ctx = new TestContext();
            ctx.seedConfig({
                generateDownMigrations: true,
                downStrategy: 'delete',
                onRollbackError: 'warn'
            });

            ctx.dbset(User).seed({ id: 1, name: 'Test User', email: 'test@example.com' });

            const seedData = ctx.__contextSeedData;
            assert.ok(seedData.User, 'User seed data should exist');
            assert.strictEqual(seedData.User.length, 1);
            assert.ok(seedData.User[0].__rollback, 'Rollback metadata should be attached');
            assert.strictEqual(seedData.User[0].__rollback.key, 'id');
            assert.strictEqual(seedData.User[0].__rollback.value, 1);
        });

        it('should generate correct down migration template', function() {
            const MT = new MigrationTemplate('TestMigration');
            const records = [
                { id: 1, name: 'User 1', __rollback: { key: 'id', value: 1 } },
                { id: 2, name: 'User 2', __rollback: { key: 'id', value: 2 } }
            ];
            const config = { generateDownMigrations: true, onRollbackError: 'warn' };

            MT.seedDataDown('down', 'User', records, config);
            const result = MT.get();

            assert.ok(result.includes('async down(table)'), 'Should have down method');
            assert.ok(result.includes('table.User.findById'), 'Should query by ID');
            assert.ok(result.includes('await record.delete()'), 'Should delete record');
            assert.ok(result.includes('console.warn'), 'Should warn on error');
        });

        it('should not generate down migration when disabled', function() {
            const ctx = new TestContext();
            ctx.seedConfig({ generateDownMigrations: false });

            ctx.dbset(User).seed({ id: 1, name: 'Test' });

            assert.ok(!ctx.__contextSeedData.User[0].__rollback, 'Should not have rollback metadata');
        });
    });

    describe('Feature 2: Conditional Seeding', function() {
        it('should attach environment metadata with .when()', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ name: 'Dev User' })
                .when('development', 'test');

            const seedData = ctx.__contextSeedData;
            assert.ok(seedData.User[0].__seedEnv, 'Environment metadata should exist');
            assert.deepStrictEqual(seedData.User[0].__seedEnv.conditions, ['development', 'test']);
            assert.strictEqual(seedData.User[0].__seedEnv.strategy, 'generation-time');
        });

        it('should filter records by environment at generation time', function() {
            const MT = new MigrationTemplate('TestMigration');
            const records = [
                { name: 'Prod User', __seedEnv: { conditions: ['production'], strategy: 'generation-time' } },
                { name: 'Dev User', __seedEnv: { conditions: ['development'], strategy: 'generation-time' } },
                { name: 'All User' }
            ];

            MT.seedData('up', 'User', records, 'development');
            const result = MT.get();

            assert.ok(!result.includes('Prod User'), 'Should not include production-only record');
            assert.ok(result.includes('Dev User'), 'Should include development record');
            assert.ok(result.includes('All User'), 'Should include unconditional record');
        });

        it('should support chaining with seed()', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ name: 'User 1' })
                .when('development')
                .seed({ name: 'User 2' });

            assert.strictEqual(ctx.__contextSeedData.User.length, 2);
            assert.ok(ctx.__contextSeedData.User[0].__seedEnv, 'First record should have env condition');
            assert.ok(!ctx.__contextSeedData.User[1].__seedEnv, 'Second record should not have env condition');
        });
    });

    describe('Feature 3: Dependency Ordering', function() {
        it('should build dependency graph from entities', function() {
            const graph = new DependencyGraph([User, Organization, Post]);
            graph.buildFromEntities();

            assert.ok(graph.graph.has('User'), 'Should have User in graph');
            assert.ok(graph.graph.has('Organization'), 'Should have Organization in graph');
            assert.ok(graph.graph.has('Post'), 'Should have Post in graph');
        });

        it('should perform topological sort correctly', function() {
            const graph = new DependencyGraph([User, Organization, Post]);
            graph.buildFromEntities();
            const sorted = graph.topologicalSort();

            const orgIndex = sorted.indexOf('Organization');
            const userIndex = sorted.indexOf('User');
            const postIndex = sorted.indexOf('Post');

            assert.ok(orgIndex < userIndex, 'Organization should come before User');
            assert.ok(userIndex < postIndex, 'User should come before Post');
        });

        it('should filter to seeded tables only', function() {
            const graph = new DependencyGraph([User, Organization, Post]);
            graph.buildFromEntities();
            const seedData = { User: [], Post: [] }; // Only User and Post have seeds
            const filtered = graph.filterToSeededTables(seedData);

            assert.strictEqual(filtered.length, 2, 'Should only include seeded tables');
            assert.ok(filtered.includes('User'), 'Should include User');
            assert.ok(filtered.includes('Post'), 'Should include Post');
            assert.ok(!filtered.includes('Organization'), 'Should not include Organization');
            assert.ok(filtered.indexOf('User') < filtered.indexOf('Post'), 'User should come before Post');
        });

        it('should handle circular dependencies gracefully', function() {
            // Create entities with circular dependency
            class A {
                static __name = 'A';
                static b_id = { relationshipType: 'belongsTo', foreignTable: 'B' };
            }
            class B {
                static __name = 'B';
                static a_id = { relationshipType: 'belongsTo', foreignTable: 'A' };
            }

            const graph = new DependencyGraph([A, B]);
            graph.buildFromEntities();

            assert.throws(() => {
                graph.topologicalSort();
            }, /Circular dependency/, 'Should throw error on circular dependency');
        });

        it('should order seed data via getOrderedSeedData()', function() {
            const ctx = new TestContext();
            ctx.dbset(Post).seed({ title: 'Post 1', user_id: 1 });
            ctx.dbset(User).seed({ id: 1, name: 'User 1', org_id: 1 });
            ctx.dbset(Organization).seed({ id: 1, name: 'Org 1' });

            const ordered = ctx.getOrderedSeedData();
            const keys = Object.keys(ordered);

            assert.strictEqual(keys.length, 3);
            assert.strictEqual(keys[0], 'Organization', 'Organization should be first');
            assert.strictEqual(keys[1], 'User', 'User should be second');
            assert.strictEqual(keys[2], 'Post', 'Post should be third');
        });
    });

    describe('Feature 4: Factory Integration', function() {
        it('should generate records with seedFactory()', function() {
            const ctx = new TestContext();
            ctx.dbset(User).seedFactory(5, i => ({
                id: i + 1,
                name: `User ${i}`,
                email: `user${i}@example.com`
            }));

            const seedData = ctx.__contextSeedData;
            assert.strictEqual(seedData.User.length, 5, 'Should generate 5 records');
            assert.strictEqual(seedData.User[0].name, 'User 0');
            assert.strictEqual(seedData.User[4].name, 'User 4');
            assert.ok(seedData.User[0].__seedMeta?.generated, 'Should mark as factory-generated');
        });

        it('should throw error if generator is not a function', function() {
            const ctx = new TestContext();
            assert.throws(() => {
                ctx.dbset(User).seedFactory(5, 'not a function');
            }, /requires a generator function/);
        });

        it('should throw error if count is invalid', function() {
            const ctx = new TestContext();
            assert.throws(() => {
                ctx.dbset(User).seedFactory(-1, i => ({ name: `User ${i}` }));
            }, /requires a positive number/);
        });

        it('should generate loop syntax for 10+ factory records', function() {
            const MT = new MigrationTemplate('TestMigration');
            const records = Array.from({ length: 10 }, (_, i) => ({
                name: `User ${i}`,
                __seedMeta: { generated: true, index: i }
            }));

            MT.seedData('up', 'User', records, 'development');
            const result = MT.get();

            assert.ok(result.includes('const factoryRecords = ['), 'Should use array syntax');
            assert.ok(result.includes('for (const record of factoryRecords)'), 'Should use loop');
        });

        it('should use individual inserts for <10 factory records', function() {
            const MT = new MigrationTemplate('TestMigration');
            const records = Array.from({ length: 3 }, (_, i) => ({
                name: `User ${i}`,
                __seedMeta: { generated: true, index: i }
            }));

            MT.seedData('up', 'User', records, 'development');
            const result = MT.get();

            assert.ok(!result.includes('const factoryRecords'), 'Should not use array syntax');
            assert.ok(result.includes('await table.User.create'), 'Should use individual creates');
        });
    });

    describe('Feature 5: Upsert Semantics', function() {
        it('should attach upsert metadata with .upsert()', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ id: 1, name: 'Admin' })
                .upsert();

            const seedData = ctx.__contextSeedData;
            assert.ok(seedData.User[0].__seedStrategy, 'Should have upsert strategy');
            assert.strictEqual(seedData.User[0].__seedStrategy.type, 'upsert');
            assert.strictEqual(seedData.User[0].__seedStrategy.conflictKey, 'primaryKey');
        });

        it('should support custom conflict key', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ email: 'admin@example.com', name: 'Admin' })
                .upsert({ conflictKey: 'email' });

            const strategy = ctx.__contextSeedData.User[0].__seedStrategy;
            assert.strictEqual(strategy.conflictKey, 'email');
        });

        it('should support partial updates', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ id: 1, name: 'Updated Name', email: 'old@example.com' })
                .upsert({ updateFields: ['name'] });

            const strategy = ctx.__contextSeedData.User[0].__seedStrategy;
            assert.deepStrictEqual(strategy.updateFields, ['name']);
        });

        it('should generate check-then-update code', function() {
            const MT = new MigrationTemplate('TestMigration');
            const records = [{
                id: 1,
                name: 'Admin',
                email: 'admin@example.com',
                __seedStrategy: { type: 'upsert', conflictKey: 'primaryKey', updateFields: null }
            }];

            MT.seedData('up', 'User', records, 'development');
            const result = MT.get();

            assert.ok(result.includes('const existing = await table.User.where'), 'Should check for existing');
            assert.ok(result.includes('if (existing)'), 'Should have conditional');
            assert.ok(result.includes('await existing.save()'), 'Should save on update');
            assert.ok(result.includes('await table.User.create'), 'Should create if not exists');
        });

        it('should apply default upsert strategy when configured', function() {
            const ctx = new TestContext();
            ctx.seedConfig({ defaultStrategy: 'upsert' });
            ctx.dbset(User).seed({ id: 1, name: 'Admin' });

            const strategy = ctx.__contextSeedData.User[0].__seedStrategy;
            assert.strictEqual(strategy.type, 'upsert');
        });
    });

    describe('Combined Features', function() {
        it('should support all features together', function() {
            const ctx = new TestContext();
            ctx.seedConfig({
                generateDownMigrations: true,
                defaultStrategy: 'upsert',
                detectCircularDependencies: true,
                circularStrategy: 'warn'
            });

            // Feature 3 (Dependency Ordering) + Feature 4 (Factory) + Feature 2 (Conditional) + Feature 5 (Upsert)
            ctx.dbset(Organization)
                .seed({ id: 1, name: 'Default Org', slug: 'default' })
                .upsert({ conflictKey: 'slug' });

            ctx.dbset(User)
                .seedFactory(3, i => ({ id: i + 1, name: `Admin ${i}`, org_id: 1 }))
                .when('development')
                .upsert();

            ctx.dbset(Post)
                .seed({ id: 1, title: 'Welcome', user_id: 1 })
                .when('development');

            const ordered = ctx.getOrderedSeedData();
            const keys = Object.keys(ordered);

            // Verify ordering
            assert.strictEqual(keys[0], 'Organization');
            assert.strictEqual(keys[1], 'User');
            assert.strictEqual(keys[2], 'Post');

            // Verify features applied
            assert.ok(ordered.Organization[0].__seedStrategy, 'Org should have upsert');
            assert.ok(ordered.User[0].__seedMeta?.generated, 'User should be factory-generated');
            assert.ok(ordered.User[0].__seedEnv, 'User should have env condition');
            assert.ok(ordered.Post[0].__seedEnv, 'Post should have env condition');
        });

        it('should chain all methods together', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seedFactory(5, i => ({ id: i + 1, name: `User ${i}` }))
                .when('development', 'test')
                .upsert({ conflictKey: 'id' });

            const record = ctx.__contextSeedData.User[0];
            assert.ok(record.__seedMeta?.generated, 'Should have factory metadata');
            assert.ok(record.__seedEnv, 'Should have environment metadata');
            assert.ok(record.__seedStrategy, 'Should have upsert strategy');
        });
    });

    describe('Backward Compatibility', function() {
        it('should work without any configuration', function() {
            const ctx = new TestContext();
            ctx.dbset(User).seed({ name: 'Simple User' });

            assert.ok(ctx.__contextSeedData.User);
            assert.strictEqual(ctx.__contextSeedData.User.length, 1);
        });

        it('should support array syntax', function() {
            const ctx = new TestContext();
            ctx.dbset(User).seed([
                { name: 'User 1' },
                { name: 'User 2' }
            ]);

            assert.strictEqual(ctx.__contextSeedData.User.length, 2);
        });

        it('should support chaining without features', function() {
            const ctx = new TestContext();
            ctx.dbset(User)
                .seed({ name: 'User 1' })
                .seed({ name: 'User 2' });

            assert.strictEqual(ctx.__contextSeedData.User.length, 2);
        });
    });
});

console.log('✓ All seed data integration tests defined');
console.log('Run with: npm test or node test/seed-features-integration-test.js');
