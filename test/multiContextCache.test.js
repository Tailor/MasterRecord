/**
 * Test: Multi-Context Cache Sharing
 *
 * Verifies that cache is shared across context instances
 * so invalidation in one context affects all contexts
 */

const context = require('../context');
const QueryCache = require('../Cache/QueryCache');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         Multi-Context Cache Sharing Test                      ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test 1: Multiple context instances share the same cache
console.log("📝 Test 1: Multiple contexts share same cache instance");
console.log("──────────────────────────────────────────────────");

try {
    class TestContext extends context {
        constructor() {
            super();
        }
    }

    const db1 = new TestContext();
    const db2 = new TestContext();

    const areSameInstance = db1._queryCache === db2._queryCache;
    const isSharedCache = db1._queryCache === context._sharedQueryCache;

    if(areSameInstance && isSharedCache) {
        console.log("   ✓ Both context instances share the same cache");
        console.log("   ✓ Cache is stored in static property");
        passed++;
    } else {
        console.log(`   ✗ Contexts have separate caches (BUG!)`);
        console.log(`   ✗ db1._queryCache === db2._queryCache: ${areSameInstance}`);
        console.log(`   ✗ Shared cache exists: ${isSharedCache}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Cache operations in one context affect another context
console.log("\n📝 Test 2: Cache operations are shared");
console.log("──────────────────────────────────────────────────");

try {
    class TestContext extends context {
        constructor() {
            super();
        }
    }

    const db1 = new TestContext();
    const db2 = new TestContext();

    // Context 1: Add to cache
    const key = db1._queryCache.generateKey('SELECT * FROM users', [], 'users');
    db1._queryCache.set(key, [{ id: 1, name: 'John' }], 'users');

    // Context 2: Should see the same cached data
    const cached = db2._queryCache.get(key);

    if(cached && cached[0].name === 'John') {
        console.log("   ✓ Cache data visible across contexts");
        passed++;
    } else {
        console.log(`   ✗ Cache data not shared across contexts`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: Cache invalidation in one context affects another
console.log("\n📝 Test 3: Cache invalidation is shared");
console.log("──────────────────────────────────────────────────");

try {
    class TestContext extends context {
        constructor() {
            super();
        }
    }

    const db1 = new TestContext();
    const db2 = new TestContext();

    // Context 1: Add multiple entries to cache
    const key1 = db1._queryCache.generateKey('SELECT * FROM users WHERE id=1', [], 'users');
    const key2 = db1._queryCache.generateKey('SELECT * FROM users WHERE id=2', [], 'users');
    db1._queryCache.set(key1, { id: 1, name: 'John' }, 'users');
    db1._queryCache.set(key2, { id: 2, name: 'Jane' }, 'users');

    // Verify both are cached
    const beforeCached1 = db1._queryCache.get(key1);
    const beforeCached2 = db1._queryCache.get(key2);

    // Context 2: Invalidate User table
    db2._queryCache.invalidateTable('users');

    // Context 1: Should see invalidation
    const afterCached1 = db1._queryCache.get(key1);
    const afterCached2 = db1._queryCache.get(key2);

    if(beforeCached1 !== null && beforeCached2 !== null && afterCached1 === null && afterCached2 === null) {
        console.log("   ✓ Data was cached in context 1");
        console.log("   ✓ Invalidation in context 2 affected context 1");
        console.log("   ✓ Cache properly shared across contexts");
        passed++;
    } else {
        console.log(`   ✗ Invalidation not shared properly`);
        console.log(`   ✗ Before: cached1=${beforeCached1 !== null}, cached2=${beforeCached2 !== null}`);
        console.log(`   ✗ After:  cached1=${afterCached1 !== null}, cached2=${afterCached2 !== null}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Cache statistics are shared
console.log("\n📝 Test 4: Cache statistics are shared");
console.log("──────────────────────────────────────────────────");

try {
    // Clear existing cache for clean test
    context._sharedQueryCache.clear();

    class TestContext extends context {
        constructor() {
            super();
        }
    }

    const db1 = new TestContext();
    const db2 = new TestContext();

    // Context 1: Generate hits/misses
    const key = db1._queryCache.generateKey('query', [], 'users');
    db1._queryCache.set(key, 'data', 'users');
    db1._queryCache.get(key);  // Hit
    db1._queryCache.get('nonexistent');  // Miss

    // Context 2: Should see same stats
    const stats1 = db1.getCacheStats();
    const stats2 = db2.getCacheStats();

    if(stats1.hits === 1 && stats2.hits === 1 && stats1.misses === 1 && stats2.misses === 1) {
        console.log("   ✓ Cache statistics shared across contexts");
        console.log(`   ✓ Both contexts see: ${stats1.hits} hit, ${stats1.misses} miss`);
        passed++;
    } else {
        console.log(`   ✗ Statistics not shared`);
        console.log(`   ✗ db1 stats: ${JSON.stringify(stats1)}`);
        console.log(`   ✗ db2 stats: ${JSON.stringify(stats2)}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Clear cache from one context affects all
console.log("\n📝 Test 5: Clear cache affects all contexts");
console.log("──────────────────────────────────────────────────");

try {
    class TestContext extends context {
        constructor() {
            super();
        }
    }

    const db1 = new TestContext();
    const db2 = new TestContext();

    // Context 1: Add data
    const key = db1._queryCache.generateKey('query', [], 'users');
    db1._queryCache.set(key, 'data', 'users');

    // Verify cached in both
    const before1 = db1._queryCache.get(key);
    const before2 = db2._queryCache.get(key);

    // Context 2: Clear cache
    db2.clearQueryCache();

    // Both contexts should see empty cache
    const after1 = db1._queryCache.get(key);
    const after2 = db2._queryCache.get(key);

    if(before1 !== null && before2 !== null && after1 === null && after2 === null) {
        console.log("   ✓ Data cached in both contexts initially");
        console.log("   ✓ Clear from context 2 affected context 1");
        passed++;
    } else {
        console.log(`   ✗ Clear not shared across contexts`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Summary
console.log("\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                        Test Summary                            ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log(`\n   ✓ Passed: ${passed}`);
console.log(`   ✗ Failed: ${failed}`);
console.log(`   📊 Total:  ${passed + failed}\n`);

if(failed === 0) {
    console.log("   🎉 All tests passed!\n");
    console.log("   ✅ Cache is properly shared across context instances");
    console.log("   ✅ Bug fix verified: Multi-context cache invalidation works\n");
    process.exit(0);
} else {
    console.log("   ❌ Some tests failed\n");
    process.exit(1);
}
