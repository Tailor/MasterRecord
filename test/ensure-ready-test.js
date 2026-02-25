/**
 * Test: _ensureReady(), validateDatabaseOptions rename, and async guards
 *
 * Verifies:
 * - Query before env() resolves → throws clear DatabaseConnectionError
 * - Query after await env() → works normally (no regression)
 * - SQLite works without _initPromise (fast path)
 * - validateDatabaseOptions works, validateSQLiteOptions alias works
 * - _execute() throws when engine is null
 * - saveChanges() throws when engine is null
 */

const context = require('../context');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       _ensureReady + Rename + Async Guards Test              ║");
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
// Test 1: _ensureReady() throws when engine is null and no init promise
// ---------------------------------------------------------------------------
console.log("📝 Test 1: _ensureReady() throws DatabaseConnectionError when engine is null");
console.log("──────────────────────────────────────────────────────────────────");

(async () => {
    try {
        const ctx = new context();
        // No env() called — _SQLEngine is null, no _initPromise
        try {
            await ctx._ensureReady();
            assert(false, "", "_ensureReady() did not throw when engine is null");
        } catch (err) {
            assert(
                err.name === 'DatabaseConnectionError',
                `Throws DatabaseConnectionError (got: ${err.name})`,
                `Expected DatabaseConnectionError, got: ${err.name}`
            );
            assert(
                err.message.includes('Database engine not initialized'),
                `Error message is descriptive: "${err.message.substring(0, 60)}..."`,
                `Unexpected error message: ${err.message}`
            );
        }
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 2: _ensureReady() is a no-op after _ready is set
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 2: _ensureReady() fast path — no-op when _ready is true");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        ctx._SQLEngine = {};  // Fake engine
        ctx.isSQLite = true;
        await ctx._ensureReady();  // Should set _ready = true
        assert(ctx._ready === true, "_ready is true after first call", "_ready was not set");

        // Second call should be instant (no-op)
        await ctx._ensureReady();
        assert(true, "Second call completes without error (fast path)", "");
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 3: _ensureReady() awaits _initPromise if present
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 3: _ensureReady() awaits _initPromise");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        ctx.isMySQL = true;
        // Simulate async init that sets _SQLEngine after a tick
        ctx._initPromise = new Promise((resolve) => {
            setTimeout(() => {
                ctx._SQLEngine = {};  // Fake engine
                resolve();
            }, 10);
        });
        // Prevent unhandled rejection
        ctx._initPromise.catch(() => {});

        await ctx._ensureReady();
        assert(
            ctx._SQLEngine !== null,
            "_SQLEngine is set after _ensureReady() awaits _initPromise",
            "_SQLEngine is still null"
        );
        assert(ctx._ready === true, "_ready is true", "_ready was not set");
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 4: _ensureReady() propagates _initPromise rejection
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 4: _ensureReady() propagates _initPromise rejection");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        ctx.isMySQL = true;
        ctx._initPromise = Promise.reject(new Error('Connection refused'));
        // Prevent unhandled rejection warning
        ctx._initPromise.catch(() => {});

        try {
            await ctx._ensureReady();
            assert(false, "", "_ensureReady() did not throw when _initPromise rejected");
        } catch (err) {
            assert(
                err.message === 'Connection refused',
                `Propagates original rejection: "${err.message}"`,
                `Unexpected error: ${err.message}`
            );
        }
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 5: validateDatabaseOptions exists and works
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 5: validateDatabaseOptions() exists and works");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        assert(
            typeof ctx.validateDatabaseOptions === 'function',
            "validateDatabaseOptions is a function",
            `validateDatabaseOptions is ${typeof ctx.validateDatabaseOptions}`
        );

        // Test with a valid SQLite config
        const options = { type: 'sqlite', connection: './test.db' };
        ctx.validateDatabaseOptions(options);
        assert(true, "validateDatabaseOptions accepts valid SQLite config", "");
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 6: validateSQLiteOptions deprecated alias works
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 6: validateSQLiteOptions() deprecated alias works");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        assert(
            typeof ctx.validateSQLiteOptions === 'function',
            "validateSQLiteOptions alias exists",
            `validateSQLiteOptions is ${typeof ctx.validateSQLiteOptions}`
        );

        // Should delegate to validateDatabaseOptions
        const options = { type: 'sqlite', connection: './test.db' };
        ctx.validateSQLiteOptions(options);
        assert(true, "validateSQLiteOptions alias delegates correctly", "");
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 7: _execute() throws when _SQLEngine is null
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 7: _execute() throws when _SQLEngine is null");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        // _SQLEngine is null by default
        try {
            ctx._execute('SELECT 1');
            assert(false, "", "_execute() did not throw when engine is null");
        } catch (err) {
            assert(
                err.name === 'DatabaseConnectionError',
                `Throws DatabaseConnectionError (got: ${err.name})`,
                `Expected DatabaseConnectionError, got: ${err.name}`
            );
            assert(
                err.message.includes('database engine not initialized'),
                `Error message is descriptive`,
                `Unexpected error message: ${err.message}`
            );
        }
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Test 8: saveChanges() throws when engine is null (via _ensureReady)
    // ---------------------------------------------------------------------------
    console.log("\n📝 Test 8: saveChanges() throws when engine is null");
    console.log("──────────────────────────────────────────────────────────────────");

    try {
        const ctx = new context();
        // No env() called — should throw via _ensureReady()
        try {
            await ctx.saveChanges();
            // saveChanges returns early if no tracked entities — that's OK
            // The _ensureReady check happens before the tracked-entities check
            assert(false, "", "saveChanges() did not throw when engine is null");
        } catch (err) {
            assert(
                err.name === 'DatabaseConnectionError',
                `Throws DatabaseConnectionError (got: ${err.name})`,
                `Expected DatabaseConnectionError, got: ${err.name}`
            );
        }
    } catch (err) {
        console.log(`   ✗ Unexpected error: ${err.message}`);
        failed++;
    }

    // ---------------------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------------------
    console.log("\n══════════════════════════════════════════════════════════════════");
    console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
    console.log("══════════════════════════════════════════════════════════════════\n");

    process.exit(failed > 0 ? 1 : 0);
})();
