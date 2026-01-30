/**
 * Test: Opt-In Caching Behavior
 *
 * Verifies that caching is disabled by default and only enabled with .cache()
 */

const QueryCache = require('../Cache/QueryCache');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║              Opt-In Caching Test                               ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate queryMethods with opt-in caching
class SimulatedQuery {
    constructor(context) {
        this._context = context;
        this.__useCache = false;  // Default: caching disabled
        this._queryString = 'SELECT * FROM test';
        this._tableName = 'Test';
    }

    // Enable caching for this query
    cache() {
        this.__useCache = true;
        return this;
    }

    // Execute query
    toList() {
        const cacheKey = this._context.cache.generateKey(this._queryString, [], this._tableName);

        // Check cache if enabled
        if (this.__useCache) {
            const cached = this._context.cache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        // Simulate DB query
        const result = [{ id: 1, name: 'Test' }];

        // Store in cache if enabled
        if (this.__useCache) {
            this._context.cache.set(cacheKey, result, this._tableName);
        }

        return result;
    }
}

class SimulatedContext {
    constructor() {
        this.cache = new QueryCache({ ttl: 60000, maxSize: 100 });
    }

    createQuery() {
        return new SimulatedQuery(this);
    }
}

// Test 1: Default behavior - no caching
console.log("📝 Test 1: Queries without .cache() are NOT cached");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    ctx.cache.clear();

    // Execute same query twice WITHOUT .cache()
    const result1 = ctx.createQuery().toList();
    const result2 = ctx.createQuery().toList();

    const stats = ctx.cache.getStats();

    if(stats.size === 0 && stats.hits === 0) {
        console.log("   ✓ Queries without .cache() do not store results");
        console.log("   ✓ No cache hits recorded");
        console.log("   ✓ Cache size remains 0");
        passed++;
    } else {
        console.log(`   ✗ Queries were cached without .cache() call`);
        console.log(`   ✗ Cache size: ${stats.size}, hits: ${stats.hits}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Opt-in with .cache() enables caching
console.log("\n📝 Test 2: Queries with .cache() ARE cached");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    ctx.cache.clear();

    // Execute same query twice WITH .cache()
    const result1 = ctx.createQuery().cache().toList();
    const result2 = ctx.createQuery().cache().toList();

    const stats = ctx.cache.getStats();

    if(stats.size === 1 && stats.hits === 1 && stats.misses === 1) {
        console.log("   ✓ First query with .cache() stored result (miss)");
        console.log("   ✓ Second query with .cache() hit cache (hit)");
        console.log(`   ✓ Cache stats: ${stats.hits} hit, ${stats.misses} miss`);
        passed++;
    } else {
        console.log(`   ✗ Caching with .cache() didn't work properly`);
        console.log(`   ✗ Expected: 1 hit, 1 miss. Got: ${stats.hits} hits, ${stats.misses} misses`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: Mixed queries - cached and non-cached
console.log("\n📝 Test 3: Mixed cached and non-cached queries");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    ctx.cache.clear();

    // Non-cached query (no .cache())
    ctx.createQuery().toList();
    ctx.createQuery().toList();

    // Cached query (with .cache())
    ctx.createQuery().cache().toList();
    ctx.createQuery().cache().toList();

    const stats = ctx.cache.getStats();

    if(stats.size === 1 && stats.hits === 1 && stats.misses === 1) {
        console.log("   ✓ Non-cached queries didn't affect cache");
        console.log("   ✓ Cached queries stored and retrieved correctly");
        console.log(`   ✓ Cache contains only .cache() queries: ${stats.size} entry`);
        passed++;
    } else {
        console.log(`   ✗ Mixed query handling incorrect`);
        console.log(`   ✗ Cache size: ${stats.size}, expected: 1`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Default __useCache flag is false
console.log("\n📝 Test 4: Default __useCache flag is false");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const query = ctx.createQuery();

    if(query.__useCache === false) {
        console.log("   ✓ Default __useCache is false");
        console.log("   ✓ Caching is opt-in by default");
        passed++;
    } else {
        console.log(`   ✗ Default __useCache is ${query.__useCache}, expected false`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: .cache() sets __useCache to true
console.log("\n📝 Test 5: .cache() enables caching flag");
console.log("──────────────────────────────────────────────────");

try {
    const ctx = new SimulatedContext();
    const query = ctx.createQuery();

    const beforeCache = query.__useCache;
    query.cache();
    const afterCache = query.__useCache;

    if(beforeCache === false && afterCache === true) {
        console.log("   ✓ __useCache starts as false");
        console.log("   ✓ .cache() sets __useCache to true");
        console.log("   ✓ Caching is explicitly enabled");
        passed++;
    } else {
        console.log(`   ✗ Flag transition incorrect`);
        console.log(`   ✗ Before: ${beforeCache}, After: ${afterCache}`);
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
    console.log("   ✅ Opt-in caching behavior verified");
    console.log("   ✅ Default is safe (no caching)");
    console.log("   ✅ .cache() explicitly enables caching\n");
    process.exit(0);
} else {
    console.log("   ❌ Some tests failed\n");
    process.exit(1);
}
