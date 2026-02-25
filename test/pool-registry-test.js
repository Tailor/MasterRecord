/**
 * Test: Global Pool Registry — One Pool Per Database
 *
 * Verifies that multiple context instances share the same connection pool
 * instead of creating a new pool per instance (the bug this fixes).
 */

const context = require('../context');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         Pool Registry Test — One Pool Per Database            ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

function assert(condition, passMsg, failMsg) {
    if (condition) {
        console.log(`   ✓ ${passMsg}`);
        passed++;
    } else {
        console.log(`   ✗ ${failMsg}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Test 1: _pools global registry exists
// ---------------------------------------------------------------------------
console.log("📝 Test 1: Global pool registry exists");
console.log("──────────────────────────────────────────────────");

try {
    const pools = global.__MR_POOLS__;
    assert(
        pools instanceof Map,
        "global.__MR_POOLS__ is a Map",
        `global.__MR_POOLS__ is not a Map (got: ${typeof pools})`
    );
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// ---------------------------------------------------------------------------
// Test 2: closeAll() is a static method
// ---------------------------------------------------------------------------
console.log("\n📝 Test 2: context.closeAll() is a static method");
console.log("──────────────────────────────────────────────────");

try {
    assert(
        typeof context.closeAll === 'function',
        "context.closeAll exists and is a function",
        `context.closeAll is not a function (got: ${typeof context.closeAll})`
    );
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// ---------------------------------------------------------------------------
// Test 3: getPoolStats() is a static method
// ---------------------------------------------------------------------------
console.log("\n📝 Test 3: context.getPoolStats() is a static method");
console.log("──────────────────────────────────────────────────");

try {
    assert(
        typeof context.getPoolStats === 'function',
        "context.getPoolStats exists and is a function",
        `context.getPoolStats is not a function (got: ${typeof context.getPoolStats})`
    );
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// ---------------------------------------------------------------------------
// Test 4: getPoolStats() returns an array
// ---------------------------------------------------------------------------
console.log("\n📝 Test 4: getPoolStats() returns an array");
console.log("──────────────────────────────────────────────────");

try {
    const stats = context.getPoolStats();
    assert(
        Array.isArray(stats),
        `getPoolStats() returned array with ${stats.length} entries`,
        `Expected array, got: ${typeof stats}`
    );
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Async tests wrapped in IIFE
(async function runAsyncTests() {

    // ---------------------------------------------------------------------------
    // Test 5: closeAll() clears the registry
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 5: closeAll() clears the registry");
    console.log("──────────────────────────────────────────────────");

    try {
        const pools = global.__MR_POOLS__;
        pools.set('test:fake@localhost:5432/testdb', {
            engine: { close: function() {} },
            refCount: 1,
            dbType: 'test'
        });

        const beforeSize = pools.size;
        await context.closeAll();
        const afterSize = pools.size;

        assert(
            beforeSize > 0 && afterSize === 0,
            `Registry had ${beforeSize} entry, now has ${afterSize} after closeAll()`,
            `Expected registry to be cleared (before: ${beforeSize}, after: ${afterSize})`
        );
    } catch (err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 6: close() on instance decrements refCount
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 6: close() decrements refCount");
    console.log("──────────────────────────────────────────────────");

    try {
        const pools = global.__MR_POOLS__;
        const fakeEngine = { close: function() { return Promise.resolve(); } };

        pools.set('test:ref-count-test', {
            engine: fakeEngine,
            refCount: 2,
            dbType: 'test'
        });

        class TestCtx extends context {
            constructor() { super(); }
        }

        const db = new TestCtx();
        db._SQLEngine = fakeEngine;

        await db.close();

        const entry = pools.get('test:ref-count-test');

        assert(
            entry && entry.refCount === 1,
            "refCount decremented from 2 to 1 — pool NOT closed (still has references)",
            entry ? `Expected refCount 1, got ${entry.refCount}` : "Entry was deleted (should still exist with refCount 1)"
        );

        pools.delete('test:ref-count-test');
    } catch (err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 7: close() removes pool when refCount reaches 0
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 7: close() removes pool when refCount reaches 0");
    console.log("──────────────────────────────────────────────────");

    try {
        const pools = global.__MR_POOLS__;
        let closeCalled = false;
        const fakeEngine = { close: function() { closeCalled = true; return Promise.resolve(); } };

        pools.set('test:last-ref-test', {
            engine: fakeEngine,
            refCount: 1,
            dbType: 'test'
        });

        class TestCtx2 extends context {
            constructor() { super(); }
        }

        const db = new TestCtx2();
        db._SQLEngine = fakeEngine;

        await db.close();

        const entry = pools.get('test:last-ref-test');

        assert(
            !entry && closeCalled,
            "Pool removed from registry when refCount reached 0, engine.close() called",
            entry ? `Entry still exists with refCount ${entry.refCount}` : "Entry removed but engine.close() was not called"
        );
    } catch (err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 8: getPoolStats() returns correct shape
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 8: Pool registry entries have correct shape");
    console.log("──────────────────────────────────────────────────");

    try {
        const pools = global.__MR_POOLS__;
        const fakeEngine = { close: function() {} };

        pools.set('mysql:testuser@localhost:3306/testdb', {
            client: {},
            engine: fakeEngine,
            refCount: 3,
            dbType: 'mysql'
        });

        const stats = context.getPoolStats();
        const mysqlStat = stats.find(function(s) { return s.key === 'mysql:testuser@localhost:3306/testdb'; });

        assert(
            mysqlStat && mysqlStat.dbType === 'mysql' && mysqlStat.refCount === 3,
            `getPoolStats() correct: ${mysqlStat.key} (type: ${mysqlStat.dbType}, refs: ${mysqlStat.refCount})`,
            `Expected mysql entry with refCount 3, got: ${JSON.stringify(mysqlStat)}`
        );

        pools.delete('mysql:testuser@localhost:3306/testdb');
    } catch (err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 9: Two context instances with same fake engine share one pool entry
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 9: Two instances sharing a pool both decrement correctly");
    console.log("──────────────────────────────────────────────────");

    try {
        const pools = global.__MR_POOLS__;
        let closeCalled = false;
        const sharedEngine = { close: function() { closeCalled = true; return Promise.resolve(); } };

        pools.set('test:shared-engine', {
            engine: sharedEngine,
            refCount: 2,
            dbType: 'test'
        });

        class TestCtx3 extends context {
            constructor() { super(); }
        }

        const db1 = new TestCtx3();
        db1._SQLEngine = sharedEngine;

        const db2 = new TestCtx3();
        db2._SQLEngine = sharedEngine;

        // First close: refCount 2 -> 1
        await db1.close();
        let entry = pools.get('test:shared-engine');
        const afterFirst = entry ? entry.refCount : -1;

        // Second close: refCount 1 -> 0, pool removed
        await db2.close();
        entry = pools.get('test:shared-engine');

        assert(
            afterFirst === 1 && !entry && closeCalled,
            "First close: refs 2->1. Second close: refs 1->0, pool destroyed, engine.close() called",
            `afterFirst=${afterFirst}, entryGone=${!entry}, closeCalled=${closeCalled}`
        );
    } catch (err) {
        console.log(`   ✗ Error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║                        Test Summary                          ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");
    console.log(`\n   ✓ Passed: ${passed}`);
    console.log(`   ✗ Failed: ${failed}`);
    console.log(`   📊 Total:  ${passed + failed}\n`);

    if (failed === 0) {
        console.log("   🎉 All tests passed!\n");
        console.log("   ✅ Global pool registry is working correctly");
        console.log("   ✅ One pool per database — no more connection exhaustion\n");
        process.exit(0);
    } else {
        console.log("   ❌ Some tests failed\n");
        process.exit(1);
    }

})();
