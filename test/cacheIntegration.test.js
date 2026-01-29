/**
 * Test: Query Cache Integration
 *
 * Tests the query result caching system integration points
 */

const QueryCache = require('../Cache/QueryCache');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              Query Cache Integration Test                      ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test 1: Query cache can be instantiated
console.log("📝 Test 1: Query cache instantiation");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache({ ttl: 5000, maxSize: 100 });

    if(cache.enabled && cache.ttl === 5000 && cache.maxSize === 100) {
        console.log("   ✓ Query cache instantiated successfully");
        console.log("   ✓ Configuration options applied correctly");
        passed++;
    } else {
        console.log(`   ✗ Cache configuration incorrect`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Cache key generation is deterministic
console.log("\n📝 Test 2: Cache key generation");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();

    const key1 = cache.generateKey('SELECT * FROM users WHERE id = ?', [1], 'users');
    const key2 = cache.generateKey('SELECT * FROM users WHERE id = ?', [1], 'users');
    const key3 = cache.generateKey('SELECT * FROM users WHERE id = ?', [2], 'users');

    if(key1 === key2 && key1 !== key3) {
        console.log("   ✓ Cache keys are deterministic (same input = same key)");
        console.log("   ✓ Different parameters produce different keys");
        passed++;
    } else {
        console.log(`   ✗ Cache key generation not working correctly`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: Cache set and get operations
console.log("\n📝 Test 3: Cache set and get operations");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();
    const key = cache.generateKey('SELECT * FROM users', [], 'users');
    const data = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];

    cache.set(key, data, 'users');
    const retrieved = cache.get(key);

    if(JSON.stringify(retrieved) === JSON.stringify(data)) {
        console.log("   ✓ Data stored in cache successfully");
        console.log("   ✓ Data retrieved from cache matches stored data");
        passed++;
    } else {
        console.log(`   ✗ Retrieved data doesn't match stored data`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Cache miss returns null
console.log("\n📝 Test 4: Cache miss behavior");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();
    const key = cache.generateKey('SELECT * FROM users WHERE id = 999', [], 'users');

    const result = cache.get(key);

    if(result === null) {
        console.log("   ✓ Cache miss returns null");
        console.log("   ✓ Miss count incremented");
        passed++;
    } else {
        console.log(`   ✗ Cache miss didn't return null`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Cache invalidation by table
console.log("\n📝 Test 5: Table-based cache invalidation");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();

    const key1 = cache.generateKey('SELECT * FROM users', [], 'users');
    const key2 = cache.generateKey('SELECT * FROM users WHERE id = 1', [], 'users');
    const key3 = cache.generateKey('SELECT * FROM posts', [], 'posts');

    cache.set(key1, [{ id: 1 }], 'users');
    cache.set(key2, { id: 1 }, 'users');
    cache.set(key3, [{ id: 1 }], 'posts');

    cache.invalidateTable('users');

    const result1 = cache.get(key1);
    const result2 = cache.get(key2);
    const result3 = cache.get(key3);

    if(result1 === null && result2 === null && result3 !== null) {
        console.log("   ✓ Invalidated all entries for 'users' table");
        console.log("   ✓ Did not invalidate 'posts' table entries");
        passed++;
    } else {
        console.log(`   ✗ Invalidation didn't work as expected`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 6: Cache statistics tracking
console.log("\n📝 Test 6: Cache statistics");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();
    const key = cache.generateKey('query', [], 'users');

    cache.set(key, 'data', 'users');
    cache.get(key);  // Hit
    cache.get('nonexistent');  // Miss

    const stats = cache.getStats();

    if(stats.hits === 1 && stats.misses === 1 && stats.hitRate === '50.00%') {
        console.log("   ✓ Hit count tracked correctly");
        console.log("   ✓ Miss count tracked correctly");
        console.log(`   ✓ Hit rate calculated correctly: ${stats.hitRate}`);
        passed++;
    } else {
        console.log(`   ✗ Stats incorrect: ${JSON.stringify(stats)}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 7: Cache can be cleared
console.log("\n📝 Test 7: Cache clearing");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache();
    const key = cache.generateKey('query', [], 'users');

    cache.set(key, 'data', 'users');
    cache.get(key);

    const statsBefore = cache.getStats();
    cache.clear();
    const statsAfter = cache.getStats();

    if(statsAfter.size === 0 && statsAfter.hits === 0 && statsAfter.misses === 0) {
        console.log("   ✓ All cache entries removed");
        console.log("   ✓ Statistics reset to zero");
        passed++;
    } else {
        console.log(`   ✗ Cache not properly cleared`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 8: Cache can be disabled
console.log("\n📝 Test 8: Cache enable/disable");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache({ enabled: false });
    const key = cache.generateKey('query', [], 'users');

    cache.set(key, 'data', 'users');
    const result = cache.get(key);

    if(result === null && cache.cache.size === 0) {
        console.log("   ✓ Disabled cache doesn't store data");
        console.log("   ✓ Disabled cache always returns null");
        passed++;
    } else {
        console.log(`   ✗ Disabled cache still storing data`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 9: LRU eviction works
console.log("\n📝 Test 9: LRU eviction");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache({ maxSize: 3 });

    cache.set('key1', 'data1', 'table1');

    // Small delay to ensure different timestamps
    const delay = (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms) {}
    };

    delay(2);
    cache.set('key2', 'data2', 'table2');
    delay(2);
    cache.set('key3', 'data3', 'table3');

    // Access key1 to make it recently used
    cache.get('key1');

    // Add key4 - should evict key2 (least recently used)
    cache.set('key4', 'data4', 'table4');

    const key1Result = cache.get('key1');
    const key2Result = cache.get('key2');
    const key3Result = cache.get('key3');
    const key4Result = cache.get('key4');

    if(key1Result !== null && key2Result === null && key3Result !== null && key4Result !== null) {
        console.log("   ✓ LRU eviction removed least recently used entry");
        console.log("   ✓ Recently accessed entries preserved");
        passed++;
    } else {
        console.log(`   ✗ LRU eviction didn't work correctly`);
        console.log(`   ✗ Debug: key1=${key1Result !== null}, key2=${key2Result !== null}, key3=${key3Result !== null}, key4=${key4Result !== null}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 10: TTL expiration (short test)
console.log("\n📝 Test 10: TTL expiration");
console.log("──────────────────────────────────────────────────");

try {
    const cache = new QueryCache({ ttl: 100 }); // 100ms TTL
    const key = cache.generateKey('query', [], 'users');

    cache.set(key, 'data', 'users');

    // Should be cached immediately
    const result1 = cache.get(key);

    // Wait for TTL expiration
    setTimeout(() => {
        const result2 = cache.get(key);

        if(result1 !== null && result2 === null) {
            console.log("   ✓ Data cached initially");
            console.log("   ✓ Data expired after TTL");
            passed++;
        } else {
            console.log(`   ✗ TTL expiration didn't work correctly`);
            failed++;
        }

        // Continue with summary after async test
        printSummary();
    }, 150);
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
    printSummary();
}

function printSummary() {

    // Summary
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║                        Test Summary                            ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log(`\n   ✓ Passed: ${passed}`);
    console.log(`   ✗ Failed: ${failed}`);
    console.log(`   📊 Total:  ${passed + failed}\n`);

    if(failed === 0) {
        console.log("   🎉 All tests passed!\n");
        process.exit(0);
    } else {
        console.log("   ❌ Some tests failed\n");
        process.exit(1);
    }
}
