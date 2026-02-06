/**
 * Test: Global Model Registry
 * Verifies that multiple context instances don't trigger duplicate warnings (CLI pattern)
 * while genuine duplicates in constructors still warn properly.
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║           Global Model Registry Test - Context Class          ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate context class with global model registry
class SimulatedContext {
    static _globalModelRegistry = {};

    constructor() {
        this.__name = this.constructor.name;
        this.__entities = [];
        this.__builderEntities = [];

        // Track if this is the first instance of this context class
        const globalRegistry = SimulatedContext._globalModelRegistry[this.__name];
        this.__isFirstInstance = !globalRegistry || globalRegistry.size === 0;

        // Initialize global model registry for this context class if not exists
        if (!SimulatedContext._globalModelRegistry[this.__name]) {
            SimulatedContext._globalModelRegistry[this.__name] = new Set();
        }
    }

    dbset(model, tableName = null) {
        const entityName = tableName || model.name;

        // Create a simple model object
        const validModel = {
            __name: entityName,
            ...model.schema
        };

        // Check if model is registered in this specific instance
        const existingIndex = this.__entities.findIndex(e => e.__name === entityName);

        if (existingIndex !== -1) {
            // Model already registered in THIS instance - duplicate within same constructor
            // Only warn on first instance (subsequent instances expected to have same pattern)
            if (this.__isFirstInstance) {
                console.warn(`Warning: dbset() called multiple times for table '${entityName}' in constructor - updating existing registration`);
            }
            // Update existing registration
            this.__entities[existingIndex] = validModel;
            this.__builderEntities[existingIndex] = { type: 'builder', model: validModel };
        } else {
            // Model not registered in this instance - add it
            this.__entities.push(validModel);
            this.__builderEntities.push({ type: 'builder', model: validModel });
        }

        // Always mark as globally seen (after handling instance registration)
        const globalRegistry = SimulatedContext._globalModelRegistry[this.__name];
        globalRegistry.add(entityName);

        return {
            seed: (data) => {}  // Mock seed method
        };
    }
}

// Test entity models
const User = { name: 'User', schema: { id: 'int', name: 'string' } };
const Auth = { name: 'Auth', schema: { id: 'int', token: 'string' } };
const Settings = { name: 'Settings', schema: { id: 'int', key: 'string' } };

// Helper to capture console warnings
function captureWarnings(fn) {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);

    try {
        fn();
    } finally {
        console.warn = originalWarn;
    }

    return warnings;
}

// Test helper
function test(description, fn) {
    try {
        // Clear registry before each test
        SimulatedContext._globalModelRegistry = {};

        fn();
        passed++;
        console.log(`✓ ${description}`);
    } catch (error) {
        failed++;
        console.log(`✗ ${description}`);
        console.log(`  Error: ${error.message}`);
    }
}

// ============================================================================
// TEST 1: Multiple Context Instances (CLI Pattern) - No Warnings
// ============================================================================

test('Multiple instances should not warn (CLI pattern)', () => {
    class TestContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(Auth);
            this.dbset(Settings);
        }
    }

    const warnings = captureWarnings(() => {
        const ctx1 = new TestContext();
        const ctx2 = new TestContext();
        const ctx3 = new TestContext();

        if (ctx1.__entities.length !== 3) throw new Error('ctx1 should have 3 entities');
        if (ctx2.__entities.length !== 3) throw new Error('ctx2 should have 3 entities');
        if (ctx3.__entities.length !== 3) throw new Error('ctx3 should have 3 entities');
    });

    if (warnings.length !== 0) {
        throw new Error(`Should not emit warnings, but got ${warnings.length}`);
    }
});

// ============================================================================
// TEST 2: Models Registered in Global Registry
// ============================================================================

test('Models should be added to global registry on first instance', () => {
    class TestContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(Auth);
        }
    }

    const ctx1 = new TestContext();

    const registry = SimulatedContext._globalModelRegistry['TestContext'];
    if (!registry) throw new Error('Global registry should exist');
    if (!registry.has('User')) throw new Error('Registry should have User');
    if (!registry.has('Auth')) throw new Error('Registry should have Auth');
    if (registry.size !== 2) throw new Error('Registry should have 2 models');
});

// ============================================================================
// TEST 3: No Duplicates in Global Registry
// ============================================================================

test('Global registry should not have duplicates after multiple instances', () => {
    class TestContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    const ctx1 = new TestContext();
    const ctx2 = new TestContext();
    const ctx3 = new TestContext();

    const registry = SimulatedContext._globalModelRegistry['TestContext'];
    if (registry.size !== 1) {
        throw new Error('Registry should have 1 model, not ' + registry.size);
    }
});

// ============================================================================
// TEST 4: Genuine Duplicate in Constructor - Should Warn
// ============================================================================

test('Genuine duplicate in constructor should warn', () => {
    class BuggyContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(User);  // Duplicate
        }
    }

    const warnings = captureWarnings(() => {
        const ctx = new BuggyContext();
    });

    if (warnings.length !== 1) {
        throw new Error(`Should emit 1 warning, but got ${warnings.length}`);
    }

    if (!warnings[0].includes('Warning: dbset() called multiple times')) {
        throw new Error('Warning should mention duplicate dbset call');
    }

    if (!warnings[0].includes('User')) {
        throw new Error('Warning should mention table name');
    }
});

// ============================================================================
// TEST 5: Warn Only Once for Duplicate
// ============================================================================

test('Duplicate should warn only on first instance', () => {
    class BuggyContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(User);
        }
    }

    const warnings = captureWarnings(() => {
        const ctx1 = new BuggyContext();
        const ctx2 = new BuggyContext();
        const ctx3 = new BuggyContext();
    });

    if (warnings.length !== 1) {
        throw new Error(`Should warn only once, but got ${warnings.length} warnings`);
    }
});

// ============================================================================
// TEST 6: Entity Count Correct Despite Duplicate
// ============================================================================

test('Entity should be registered once despite duplicate in constructor', () => {
    class BuggyContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(User);
        }
    }

    const ctx = new BuggyContext();

    if (ctx.__entities.length !== 1) {
        throw new Error('Should have 1 entity, not ' + ctx.__entities.length);
    }

    if (ctx.__entities[0].__name !== 'User') {
        throw new Error('Entity should be User');
    }
});

// ============================================================================
// TEST 7: Different Context Classes - No Warnings
// ============================================================================

test('Same model in different context classes should not warn', () => {
    class UserContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    class AdminContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    const warnings = captureWarnings(() => {
        const userCtx = new UserContext();
        const adminCtx = new AdminContext();
    });

    if (warnings.length !== 0) {
        throw new Error('Different context classes should not warn');
    }
});

// ============================================================================
// TEST 8: Separate Registries Per Context Class
// ============================================================================

test('Different context classes should have separate registries', () => {
    class UserContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(Auth);
        }
    }

    class AdminContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            this.dbset(Settings);
        }
    }

    const userCtx = new UserContext();
    const adminCtx = new AdminContext();

    const userRegistry = SimulatedContext._globalModelRegistry['UserContext'];
    const adminRegistry = SimulatedContext._globalModelRegistry['AdminContext'];

    if (!userRegistry.has('User')) throw new Error('UserContext should have User');
    if (!userRegistry.has('Auth')) throw new Error('UserContext should have Auth');
    if (userRegistry.has('Settings')) throw new Error('UserContext should not have Settings');

    if (!adminRegistry.has('User')) throw new Error('AdminContext should have User');
    if (!adminRegistry.has('Settings')) throw new Error('AdminContext should have Settings');
    if (adminRegistry.has('Auth')) throw new Error('AdminContext should not have Auth');
});

// ============================================================================
// TEST 9: Multiple Instances of Different Contexts
// ============================================================================

test('Multiple instances of different contexts should not warn', () => {
    class UserContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    class AdminContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    const warnings = captureWarnings(() => {
        const userCtx1 = new UserContext();
        const adminCtx1 = new AdminContext();
        const userCtx2 = new UserContext();
        const adminCtx2 = new AdminContext();
    });

    if (warnings.length !== 0) {
        throw new Error('Multiple instances of different contexts should not warn');
    }
});

// ============================================================================
// TEST 10: qaContext Pattern (dbset then dbset.seed)
// ============================================================================

test('qaContext pattern (dbset then dbset.seed) should warn about duplicate', () => {
    class QAContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
            // ... imagine 150 lines ...
            this.dbset(User).seed([{ id: 1, name: 'Test' }]);
        }
    }

    const warnings = captureWarnings(() => {
        const ctx = new QAContext();
    });

    if (warnings.length !== 1) {
        throw new Error('Should warn about duplicate in constructor');
    }
});

// ============================================================================
// TEST 11: Mixed Registration (Some New, Some Duplicate)
// ============================================================================

test('Mixed registration should warn only about duplicates', () => {
    class MixedContext extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);      // New
            this.dbset(Auth);      // New
            this.dbset(User);      // Duplicate
            this.dbset(Settings);  // New
            this.dbset(Auth);      // Duplicate
        }
    }

    const warnings = captureWarnings(() => {
        const ctx = new MixedContext();
    });

    if (warnings.length !== 2) {
        throw new Error(`Should warn about 2 duplicates, got ${warnings.length}`);
    }

    const ctx = new MixedContext();
    if (ctx.__entities.length !== 3) {
        throw new Error('Should have 3 unique entities');
    }
});

// ============================================================================
// TEST 12: Empty Context
// ============================================================================

test('Empty context should not warn', () => {
    class EmptyContext extends SimulatedContext {
        constructor() {
            super();
        }
    }

    const warnings = captureWarnings(() => {
        const ctx1 = new EmptyContext();
        const ctx2 = new EmptyContext();
    });

    if (warnings.length !== 0) {
        throw new Error('Empty context should not warn');
    }

    const registry = SimulatedContext._globalModelRegistry['EmptyContext'];
    if (!registry) throw new Error('Registry should exist');
    if (registry.size !== 0) throw new Error('Registry should be empty');
});

// ============================================================================
// TEST 13: Large Context (50 models)
// ============================================================================

test('Large context with 50 models should not warn on multiple instances', () => {
    class LargeContext extends SimulatedContext {
        constructor() {
            super();
            for (let i = 0; i < 50; i++) {
                this.dbset({ name: `Model${i}`, schema: { id: 'int' } });
            }
        }
    }

    const warnings = captureWarnings(() => {
        const ctx1 = new LargeContext();
        const ctx2 = new LargeContext();
    });

    if (warnings.length !== 0) {
        throw new Error('Large context should not warn');
    }

    const registry = SimulatedContext._globalModelRegistry['LargeContext'];
    if (registry.size !== 50) {
        throw new Error(`Registry should have 50 models, got ${registry.size}`);
    }
});

// ============================================================================
// TEST 14: Registry Isolation
// ============================================================================

test('Registry should not pollute other context classes', () => {
    class ContextA extends SimulatedContext {
        constructor() {
            super();
            this.dbset(User);
        }
    }

    class ContextB extends SimulatedContext {
        constructor() {
            super();
            this.dbset(Auth);
        }
    }

    const ctxA = new ContextA();
    const ctxB = new ContextB();

    const registryA = SimulatedContext._globalModelRegistry['ContextA'];
    const registryB = SimulatedContext._globalModelRegistry['ContextB'];

    if (!registryA.has('User')) throw new Error('ContextA should have User');
    if (registryA.has('Auth')) throw new Error('ContextA should not have Auth');

    if (!registryB.has('Auth')) throw new Error('ContextB should have Auth');
    if (registryB.has('User')) throw new Error('ContextB should not have User');
});

// ============================================================================
// TEST 15: Many Context Classes
// ============================================================================

test('Many context classes should work independently', () => {
    const warnings = captureWarnings(() => {
        for (let i = 0; i < 10; i++) {
            const ContextClass = class extends SimulatedContext {
                constructor() {
                    super();
                    this.dbset(User);
                }
            };
            Object.defineProperty(ContextClass, 'name', { value: `Context${i}` });

            // Create 3 instances of each
            new ContextClass();
            new ContextClass();
            new ContextClass();
        }
    });

    if (warnings.length !== 0) {
        throw new Error('Multiple context classes should not warn');
    }

    if (Object.keys(SimulatedContext._globalModelRegistry).length !== 10) {
        throw new Error('Should have 10 registries');
    }
});

// ============================================================================
// RESULTS
// ============================================================================

console.log("\n" + "=".repeat(70));
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log("=".repeat(70));

if (failed > 0) {
    console.log("\n❌ Some tests failed!\n");
    process.exit(1);
} else {
    console.log("\n✅ All tests passed!\n");
    process.exit(0);
}
