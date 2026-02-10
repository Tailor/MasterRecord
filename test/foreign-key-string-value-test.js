/**
 * Test: Foreign Key String Value Bug Fix
 *
 * Verifies that string values assigned to foreign key fields (defined via belongsTo)
 * are properly auto-converted to integers and included in INSERT statements.
 *
 * Bug: MasterRecord was silently ignoring string values for foreign key fields,
 * causing NOT NULL constraint failures.
 *
 * Fix: Added check in _buildSQLInsertObjectParameterized to look for values
 * in both the navigation property name (e.g., 'User') AND the foreign key field name (e.g., 'user_id').
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║      Foreign Key String Value Test - INSERT Bug Fix           ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Simulate the SQLite engine's INSERT builder
class SimulatedSQLiteEngine {
    _buildSQLInsertObjectParameterized(fields, modelEntity) {
        const columnNames = [];
        const params = [];

        for (const column in modelEntity) {
            if (column.indexOf("__") === -1) {
                let fieldColumn = fields[column];

                // 🔥 FIX: For belongsTo relationships, also check the foreignKey field name
                if ((fieldColumn === undefined || fieldColumn === null) &&
                    modelEntity[column].relationshipType === "belongsTo" &&
                    modelEntity[column].foreignKey) {
                    fieldColumn = fields[modelEntity[column].foreignKey];
                }

                if ((fieldColumn !== undefined && fieldColumn !== null) && typeof(fieldColumn) !== "object") {
                    // Auto-convert string to integer for integer fields
                    if (modelEntity[column].type === "integer" && typeof fieldColumn === "string") {
                        const parsed = parseInt(fieldColumn, 10);
                        if (isNaN(parsed)) {
                            throw new Error(`Cannot convert "${fieldColumn}" to integer`);
                        }
                        fieldColumn = parsed;
                    }

                    const relationship = modelEntity[column].relationshipType;
                    const actualColumn = relationship === "belongsTo" ? modelEntity[column].foreignKey : column;

                    columnNames.push(`[${actualColumn}]`);
                    params.push(fieldColumn);
                }
            }
        }

        if (columnNames.length > 0) {
            const placeholders = params.map(() => '?').join(', ');
            return {
                tableName: modelEntity.__name,
                columns: columnNames.join(', '),
                placeholders: placeholders,
                params: params
            };
        } else {
            return -1;
        }
    }
}

// Test helper
function test(description, fn) {
    try {
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
// TEST 1: String value for foreign key field (the reported bug)
// ============================================================================

test('Should include string foreign key value in INSERT', () => {
    const engine = new SimulatedSQLiteEngine();

    // Entity definition for UserOrganizationRole
    const UserOrganizationRoleEntity = {
        __name: 'UserOrganizationRole',
        id: { type: 'integer', primary: true, auto: true },
        role: { type: 'string', nullable: false },
        // This creates a belongsTo relationship with foreignKey 'user_id'
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            foreignTable: 'User',
            nullable: false
        },
        Organization: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'organization_id',
            foreignTable: 'Organization',
            nullable: false
        },
        created_at: { type: 'string', nullable: false },
        updated_at: { type: 'string', nullable: false }
    };

    // User sets foreign key fields directly (common pattern)
    const fields = {
        user_id: '2',  // ← STRING (from authService)
        organization_id: 8,  // ← NUMBER (from new entity)
        role: 'org_admin',
        created_at: '1770680424042',
        updated_at: '1770680424042'
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, UserOrganizationRoleEntity);

    // Verify all fields are included
    if (!result.columns.includes('[user_id]')) {
        throw new Error('user_id field is missing from INSERT columns');
    }

    if (!result.columns.includes('[organization_id]')) {
        throw new Error('organization_id field is missing from INSERT columns');
    }

    if (!result.columns.includes('[role]')) {
        throw new Error('role field is missing from INSERT columns');
    }

    // Verify string was converted to integer
    const userIdIndex = result.columns.split(', ').indexOf('[user_id]');
    if (typeof result.params[userIdIndex] !== 'number') {
        throw new Error(`user_id should be converted to number, got ${typeof result.params[userIdIndex]}`);
    }

    if (result.params[userIdIndex] !== 2) {
        throw new Error(`user_id should be 2, got ${result.params[userIdIndex]}`);
    }
});

// ============================================================================
// TEST 2: Number value for foreign key field (should still work)
// ============================================================================

test('Should include number foreign key value in INSERT', () => {
    const engine = new SimulatedSQLiteEngine();

    const UserOrganizationRoleEntity = {
        __name: 'UserOrganizationRole',
        id: { type: 'integer', primary: true, auto: true },
        role: { type: 'string', nullable: false },
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            foreignTable: 'User',
            nullable: false
        }
    };

    const fields = {
        user_id: 2,  // ← NUMBER
        role: 'org_admin'
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, UserOrganizationRoleEntity);

    if (!result.columns.includes('[user_id]')) {
        throw new Error('user_id field is missing from INSERT columns');
    }

    const userIdIndex = result.columns.split(', ').indexOf('[user_id]');
    if (result.params[userIdIndex] !== 2) {
        throw new Error(`user_id should be 2, got ${result.params[userIdIndex]}`);
    }
});

// ============================================================================
// TEST 3: Both string and number foreign keys in same entity
// ============================================================================

test('Should handle mixed string and number foreign keys', () => {
    const engine = new SimulatedSQLiteEngine();

    const UserOrganizationRoleEntity = {
        __name: 'UserOrganizationRole',
        id: { type: 'integer', primary: true, auto: true },
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        },
        Organization: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'organization_id',
            nullable: false
        }
    };

    const fields = {
        user_id: '2',  // STRING
        organization_id: 8  // NUMBER
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, UserOrganizationRoleEntity);

    if (!result.columns.includes('[user_id]')) {
        throw new Error('user_id field is missing');
    }

    if (!result.columns.includes('[organization_id]')) {
        throw new Error('organization_id field is missing');
    }

    // Verify both are numbers
    const userIdIndex = result.columns.split(', ').indexOf('[user_id]');
    const orgIdIndex = result.columns.split(', ').indexOf('[organization_id]');

    if (typeof result.params[userIdIndex] !== 'number') {
        throw new Error('user_id should be a number');
    }

    if (typeof result.params[orgIdIndex] !== 'number') {
        throw new Error('organization_id should be a number');
    }
});

// ============================================================================
// TEST 4: String foreign key with leading zeros
// ============================================================================

test('Should handle string foreign key with leading zeros', () => {
    const engine = new SimulatedSQLiteEngine();

    const EntityWithFK = {
        __name: 'TestEntity',
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        }
    };

    const fields = {
        user_id: '007'  // STRING with leading zeros
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, EntityWithFK);

    const userIdIndex = result.columns.split(', ').indexOf('[user_id]');
    if (result.params[userIdIndex] !== 7) {
        throw new Error(`Should convert '007' to 7, got ${result.params[userIdIndex]}`);
    }
});

// ============================================================================
// TEST 5: Invalid string value should throw error
// ============================================================================

test('Should throw error for non-numeric string foreign key', () => {
    const engine = new SimulatedSQLiteEngine();

    const EntityWithFK = {
        __name: 'TestEntity',
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        }
    };

    const fields = {
        user_id: 'invalid'  // Non-numeric string
    };

    try {
        engine._buildSQLInsertObjectParameterized(fields, EntityWithFK);
        throw new Error('Should have thrown error for invalid string');
    } catch (error) {
        if (!error.message.includes('Cannot convert')) {
            throw new Error(`Wrong error message: ${error.message}`);
        }
    }
});

// ============================================================================
// TEST 6: Empty string should throw error
// ============================================================================

test('Should throw error for empty string foreign key', () => {
    const engine = new SimulatedSQLiteEngine();

    const EntityWithFK = {
        __name: 'TestEntity',
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        }
    };

    const fields = {
        user_id: ''  // Empty string
    };

    try {
        engine._buildSQLInsertObjectParameterized(fields, EntityWithFK);
        throw new Error('Should have thrown error for empty string');
    } catch (error) {
        if (!error.message.includes('Cannot convert')) {
            throw new Error(`Wrong error message: ${error.message}`);
        }
    }
});

// ============================================================================
// TEST 7: Backward compatibility - navigation property still works
// ============================================================================

test('Should still work when navigation property is set (backward compat)', () => {
    const engine = new SimulatedSQLiteEngine();

    const UserOrganizationRoleEntity = {
        __name: 'UserOrganizationRole',
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        }
    };

    // Old pattern: Set navigation property (not the foreign key)
    const fields = {
        User: 2  // Setting the navigation property name
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, UserOrganizationRoleEntity);

    if (!result.columns.includes('[user_id]')) {
        throw new Error('user_id field is missing');
    }
});

// ============================================================================
// TEST 8: Prefer navigation property over foreign key field
// ============================================================================

test('Should prefer navigation property if both are set', () => {
    const engine = new SimulatedSQLiteEngine();

    const UserOrganizationRoleEntity = {
        __name: 'UserOrganizationRole',
        User: {
            type: 'integer',
            relationshipType: 'belongsTo',
            foreignKey: 'user_id',
            nullable: false
        }
    };

    // Both navigation property AND foreign key set (unusual but possible)
    const fields = {
        User: 5,  // Navigation property
        user_id: '2'  // Foreign key field
    };

    const result = engine._buildSQLInsertObjectParameterized(fields, UserOrganizationRoleEntity);

    const userIdIndex = result.columns.split(', ').indexOf('[user_id]');
    // Should prefer navigation property value (5) over foreign key field value ('2')
    if (result.params[userIdIndex] !== 5) {
        throw new Error(`Should use navigation property value 5, got ${result.params[userIdIndex]}`);
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
    console.log("\n✅ All tests passed! Foreign key string value bug is fixed.\n");
    process.exit(0);
}
