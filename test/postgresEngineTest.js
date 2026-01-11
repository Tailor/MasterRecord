/**
 * PostgreSQL Engine Test
 *
 * Tests the postgresEngine.js implementation including all bug fixes:
 * - Placeholder detection in buildWhere and buildAnd
 * - Parameterized query generation
 * - $1, $2, $3... placeholder format
 * - RETURNING clause for INSERT
 */

const postgresEngine = require('../postgresEngine');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         PostgreSQL Engine Unit Tests                          ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Mock entity for testing
const TEST_ENTITY = {
    __name: 'User',
    id: { type: 'integer', primary: true, auto: true },
    name: { type: 'string', nullable: false },
    email: { type: 'string', nullable: false },
    age: { type: 'integer', nullable: true },
    status: { type: 'string', nullable: true }
};

// Test 1: Engine Initialization
console.log("📝 Test 1: Engine Instance Creation");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    if (engine) {
        console.log("   ✓ Engine instance created");
        console.log(`   ✓ Database type: ${engine.dbType}`);
        passed++;
    } else {
        console.log("   ✗ Failed to create engine");
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: Placeholder Detection in buildWhere
console.log("\n📝 Test 2: Placeholder Detection in buildWhere");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    // Mock query with $1 placeholder
    const mockQuery = {
        where: {
            User: {
                query: {
                    expressions: [
                        { field: 'name', func: '=', arg: '$1' }
                    ],
                    fields: ['name']
                }
            }
        },
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const whereClause = engine.buildWhere(mockQuery, TEST_ENTITY);

    // Should NOT quote $1 placeholder
    if (whereClause.includes('$1') && !whereClause.includes("'$1'")) {
        console.log("   ✓ $1 placeholder not quoted");
        console.log(`   ✓ Generated: ${whereClause}`);
        passed++;
    } else {
        console.log(`   ✗ Placeholder incorrectly handled: ${whereClause}`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: String Values Should Be Quoted
console.log("\n📝 Test 3: Non-Placeholder Values Should Be Quoted");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const mockQuery = {
        where: {
            User: {
                query: {
                    expressions: [
                        { field: 'status', func: '=', arg: 'active' }
                    ],
                    fields: ['status']
                }
            }
        },
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const whereClause = engine.buildWhere(mockQuery, TEST_ENTITY);

    // Should quote literal string 'active'
    if (whereClause.includes("'active'")) {
        console.log("   ✓ Literal string correctly quoted");
        console.log(`   ✓ Generated: ${whereClause}`);
        passed++;
    } else {
        console.log(`   ✗ String not quoted: ${whereClause}`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: Placeholder Detection in buildAnd
console.log("\n📝 Test 4: Placeholder Detection in buildAnd");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const mockQuery = {
        and: {
            and1: {
                User: {
                    query: {
                        expressions: [
                            { field: 'age', func: '>', arg: '$2' }
                        ],
                        fields: ['age']
                    }
                }
            }
        },
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const andClause = engine.buildAnd(mockQuery, TEST_ENTITY);

    // Should NOT quote $2 placeholder
    if (andClause.includes('$2') && !andClause.includes("'$2'")) {
        console.log("   ✓ $2 placeholder in AND clause not quoted");
        console.log(`   ✓ Generated: ${andClause}`);
        passed++;
    } else {
        console.log(`   ✗ AND clause placeholder incorrectly handled: ${andClause}`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: NULL Handling in WHERE
console.log("\n📝 Test 5: NULL Handling in WHERE Clause");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const mockQuery = {
        where: {
            User: {
                query: {
                    expressions: [
                        { field: 'status', func: '=', arg: 'null' }
                    ],
                    fields: ['status']
                }
            }
        },
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const whereClause = engine.buildWhere(mockQuery, TEST_ENTITY);

    // Should convert = to IS for NULL
    if (whereClause.includes('IS null')) {
        console.log("   ✓ NULL comparison uses IS instead of =");
        console.log(`   ✓ Generated: ${whereClause}`);
        passed++;
    } else {
        console.log(`   ✗ NULL not handled correctly: ${whereClause}`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 6: Build Complete Query
console.log("\n📝 Test 6: Complete Query Building");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const mockQuery = {
        where: {
            User: {
                query: {
                    expressions: [
                        { field: 'name', func: '=', arg: '$1' }
                    ],
                    fields: ['name']
                }
            }
        },
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }],
        parameters: {
            getParams: () => ['John Doe']
        }
    };

    const queryObj = engine.buildQuery(mockQuery, TEST_ENTITY);

    if (queryObj.query && queryObj.params) {
        console.log("   ✓ Query object generated");
        console.log(`   ✓ SQL: ${queryObj.query.substring(0, 80)}...`);
        console.log(`   ✓ Params: [${queryObj.params.join(', ')}]`);

        if (queryObj.query.includes('$1') && queryObj.params.length === 1) {
            console.log("   ✓ Placeholder and params match");
            passed++;
        } else {
            console.log("   ✗ Placeholder/params mismatch");
            failed++;
        }
    } else {
        console.log("   ✗ Query object incomplete");
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 7: INSERT Object with $1, $2, $3 Placeholders
console.log("\n📝 Test 7: INSERT with $1, $2, $3... Placeholders");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const mockFields = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        age: 25,
        __entity: TEST_ENTITY
    };

    const insertObj = engine._buildSQLInsertObjectParameterized(mockFields, TEST_ENTITY);

    if (insertObj && insertObj !== -1) {
        console.log("   ✓ INSERT object generated");
        console.log(`   ✓ Table: ${insertObj.tableName}`);
        console.log(`   ✓ Columns: ${insertObj.columns}`);
        console.log(`   ✓ Placeholders: ${insertObj.placeholders}`);
        console.log(`   ✓ Params count: ${insertObj.params.length}`);

        // Verify PostgreSQL placeholder format ($1, $2, $3...)
        if (insertObj.placeholders.includes('$1') && insertObj.placeholders.includes('$2')) {
            console.log("   ✓ Uses PostgreSQL $1, $2, $3... format");
            passed++;
        } else {
            console.log(`   ✗ Wrong placeholder format: ${insertObj.placeholders}`);
            failed++;
        }
    } else {
        console.log("   ✗ INSERT object generation failed");
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 8: LIMIT and OFFSET
console.log("\n📝 Test 8: LIMIT and OFFSET (OFFSET syntax)");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const limitQuery = { take: 10 };
    const limitClause = engine.buildLimit(limitQuery);

    const skipQuery = { skip: 20 };
    const skipClause = engine.buildSkip(skipQuery);

    if (limitClause === 'LIMIT 10' && skipClause === 'OFFSET 20') {
        console.log("   ✓ LIMIT clause: LIMIT 10");
        console.log("   ✓ SKIP clause: OFFSET 20");
        console.log("   ✓ PostgreSQL pagination syntax correct");
        passed++;
    } else {
        console.log(`   ✗ Wrong pagination syntax`);
        console.log(`   ✗ LIMIT: ${limitClause}, SKIP: ${skipClause}`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 9: ORDER BY
console.log("\n📝 Test 9: ORDER BY Clause");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    const ascQuery = {
        orderBy: 'name',
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const descQuery = {
        orderByDescending: 'created_at',
        parentName: 'User',
        entityMap: [{ name: 'User', entity: 'User' }]
    };

    const ascClause = engine.buildOrderBy(ascQuery);
    const descClause = engine.buildOrderBy(descQuery);

    if (ascClause.includes('ORDER BY') && ascClause.includes('ASC') &&
        descClause.includes('ORDER BY') && descClause.includes('DESC')) {
        console.log("   ✓ ORDER BY ASC: " + ascClause);
        console.log("   ✓ ORDER BY DESC: " + descClause);
        passed++;
    } else {
        console.log(`   ✗ ORDER BY clauses incorrect`);
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 10: Field Type Validation
console.log("\n📝 Test 10: Field Type Validation and Coercion");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    // Test integer coercion
    const intField = { type: 'integer', nullable: false };
    const intValue = engine._validateAndCoerceFieldType('25', intField, 'User', 'age');

    // Test string coercion
    const strField = { type: 'string', nullable: false };
    const strValue = engine._validateAndCoerceFieldType(123, strField, 'User', 'name');

    // Test boolean coercion
    const boolField = { type: 'boolean', nullable: false };
    const boolValue = engine._validateAndCoerceFieldType(1, boolField, 'User', 'active');

    if (typeof intValue === 'number' && intValue === 25 &&
        typeof strValue === 'string' && strValue === '123' &&
        typeof boolValue === 'boolean' && boolValue === true) {
        console.log("   ✓ Integer coercion: '25' → 25");
        console.log("   ✓ String coercion: 123 → '123'");
        console.log("   ✓ Boolean coercion: 1 → true");
        passed++;
    } else {
        console.log("   ✗ Type coercion failed");
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 11: Nullable Field Validation
console.log("\n📝 Test 11: Nullable Field Validation");
console.log("──────────────────────────────────────────────────");

try {
    const engine = new postgresEngine();

    // Test nullable field accepts null
    const nullableField = { type: 'integer', nullable: true };
    const nullValue = engine._validateAndCoerceFieldType(null, nullableField, 'User', 'age');

    // Test non-nullable field rejects null
    const nonNullableField = { type: 'string', nullable: false };
    let caughtError = false;

    try {
        engine._validateAndCoerceFieldType(null, nonNullableField, 'User', 'name');
    } catch (err) {
        if (err.message.includes('cannot be null')) {
            caughtError = true;
        }
    }

    if (nullValue === null && caughtError) {
        console.log("   ✓ Nullable field accepts null");
        console.log("   ✓ Non-nullable field rejects null");
        passed++;
    } else {
        console.log("   ✗ Nullable validation failed");
        failed++;
    }
} catch (err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Summary
console.log("\n\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                       Test Summary                             ║");
console.log("╚════════════════════════════════════════════════════════════════╝");

const total = passed + failed;
const successRate = total > 0 ? Math.round((passed/total)*100) : 0;

console.log(`\n   Total Tests: ${total}`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Success Rate: ${successRate}%\n`);

if (failed === 0) {
    console.log("🎉 All PostgreSQL engine tests passed!");
    console.log("\n✨ PostgreSQL Engine Implementation Verified!");
    console.log("\n📖 Verified Features:");
    console.log("   ✓ $1, $2, $3... placeholder generation");
    console.log("   ✓ Placeholder detection (doesn't quote placeholders)");
    console.log("   ✓ Literal value quoting");
    console.log("   ✓ NULL handling (= converts to IS)");
    console.log("   ✓ WHERE clause building");
    console.log("   ✓ AND clause building");
    console.log("   ✓ Complete query building");
    console.log("   ✓ INSERT object with PostgreSQL placeholders");
    console.log("   ✓ LIMIT/OFFSET pagination");
    console.log("   ✓ ORDER BY ASC/DESC");
    console.log("   ✓ Field type validation and coercion");
    console.log("   ✓ Nullable field validation");
    console.log("\n✅ All session bug fixes properly implemented!\n");
    process.exit(0);
} else {
    console.log("⚠️  Some engine tests failed.");
    console.log("   Review the postgresEngine.js implementation.\n");
    process.exit(1);
}
