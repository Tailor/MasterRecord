/**
 * Real-World Example: Storing JavaScript Arrays as JSON Strings
 *
 * This example demonstrates how to use field transformers to store
 * JavaScript arrays in database string columns, solving the common
 * problem of "Type validation blocking array-to-JSON transformation"
 *
 * BEFORE (using raw SQL - not ideal):
 *   - Some fields saved through ORM
 *   - Array fields saved via raw SQL to bypass validation
 *   - Inconsistent, error-prone, loses ORM benefits
 *
 * AFTER (using transformers - production-ready):
 *   - All fields saved through ORM consistently
 *   - Arrays automatically transformed to/from JSON
 *   - Type-safe, maintainable, elegant
 */

const masterrecord = require('masterrecord');

// ============================================================================
// 1. Define Entity with Transformers
// ============================================================================

class User {
    constructor() {
        // Regular fields - no transformation needed
        this.id = { type: "integer", primary: true, auto: true };
        this.name = { type: "string" };
        this.email = { type: "string" };
        this.role = { type: "string" };

        // 🔥 ARRAY FIELDS WITH TRANSFORMERS
        // These fields store arrays as JSON strings in the database
        this.certified_models = {
            type: "string",  // Database column type
            nullable: true,
            transform: {
                // Transform JavaScript array → JSON string for database
                toDatabase: (value) => {
                    if (value === null || value === undefined) return null;
                    if (Array.isArray(value)) return JSON.stringify(value);
                    // Already a string (maybe from edit scenario)
                    return value;
                },

                // Transform JSON string → JavaScript array from database
                fromDatabase: (value) => {
                    if (!value) return [];
                    if (Array.isArray(value)) return value;  // Already parsed
                    try {
                        return JSON.parse(value);
                    } catch {
                        console.warn(`Failed to parse certified_models: ${value}`);
                        return [];
                    }
                }
            }
        };

        this.certified_agent_types = {
            type: "string",
            nullable: true,
            transform: {
                toDatabase: (value) => {
                    if (value === null || value === undefined) return null;
                    if (Array.isArray(value)) return JSON.stringify(value);
                    return value;
                },
                fromDatabase: (value) => {
                    if (!value) return [];
                    if (Array.isArray(value)) return value;
                    try {
                        return JSON.parse(value);
                    } catch {
                        console.warn(`Failed to parse certified_agent_types: ${value}`);
                        return [];
                    }
                }
            }
        };

        // Regular numeric field
        this.calibration_score = { type: "integer", nullable: true };
    }
}

// ============================================================================
// 2. Create Context
// ============================================================================

class AppContext extends masterrecord.context {
    constructor(config) {
        super(config);
    }

    onConfig(db) {
        this.User = this.dbset(User, "User");
    }
}

// ============================================================================
// 3. Usage Example - Creating a User with Arrays
// ============================================================================

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         JSON Array Transformer - Real-World Example           ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

console.log("📝 Scenario: User certification management system");
console.log("   - Users can be certified for multiple AI models");
console.log("   - Users can handle multiple agent types");
console.log("   - Arrays stored as JSON strings in database\n");

// Simulated context (in real app, this would connect to actual database)
console.log("1️⃣  Creating new user with array fields");
console.log("──────────────────────────────────────────────────");

const user = new User();
user.name = "Alex Rich";
user.email = "alex@example.com";
user.role = "calibrator";

// ✨ Arrays assigned naturally - NO raw SQL needed!
user.certified_models = [1, 2, 5, 8];  // Array of model IDs
user.certified_agent_types = [10, 20, 30];  // Array of agent type IDs
user.calibration_score = 95;

console.log(`   Name: ${user.name}`);
console.log(`   Certified Models (array): [${user.certified_models.join(', ')}]`);
console.log(`   Certified Agent Types (array): [${user.certified_agent_types.join(', ')}]`);
console.log(`   Calibration Score: ${user.calibration_score}\n`);

// When saved, transformers automatically convert:
//   [1, 2, 5, 8] → "[1,2,5,8]" (stored in DB)
console.log("2️⃣  What happens when saving");
console.log("──────────────────────────────────────────────────");
console.log("   User provides: [1, 2, 5, 8]");
console.log("   ↓");
console.log("   Transformer (toDatabase): [1, 2, 5, 8] → '[1,2,5,8]'");
console.log("   ↓");
console.log("   Type Validation: string '[1,2,5,8]' ✓ matches type: 'string'");
console.log("   ↓");
console.log("   Database Stores: '[1,2,5,8]' (as string column)\n");

// Standard save - no raw SQL required!
// context.User.add(user);
// context.saveChanges();

console.log("3️⃣  What happens when loading");
console.log("──────────────────────────────────────────────────");
console.log("   Database Returns: '[1,2,5,8]' (string)");
console.log("   ↓");
console.log("   Transformer (fromDatabase): '[1,2,5,8]' → [1, 2, 5, 8]");
console.log("   ↓");
console.log("   Application Receives: [1, 2, 5, 8] (JavaScript array)");
console.log("   ↓");
console.log("   Code: user.certified_models.includes(2) → true ✓\n");

// When loaded from DB, transformers automatically convert back:
//   "[1,2,5,8]" → [1, 2, 5, 8] (JavaScript array)
// const users = context.User.where(u => u.id == $$, userId).toList();
// console.log(users[0].certified_models);  // [1, 2, 5, 8]

console.log("4️⃣  Updating existing user");
console.log("──────────────────────────────────────────────────");
console.log("   const user = context.User.where(u => u.id == $$, 14).single();");
console.log("   user.certified_models = [1, 2, 5, 8, 12];  // Add model 12");
console.log("   context.saveChanges();  // ✓ Works perfectly!\n");

console.log("5️⃣  Benefits over raw SQL approach");
console.log("──────────────────────────────────────────────────");
console.log("   ✅ Consistent ORM usage (no raw SQL needed)");
console.log("   ✅ Automatic transformation (transparent to application code)");
console.log("   ✅ Type-safe (validation happens after transformation)");
console.log("   ✅ Maintainable (transformation logic in one place)");
console.log("   ✅ Testable (transformers are pure functions)");
console.log("   ✅ Works with all ORM features (tracking, relationships, etc.)\n");

console.log("6️⃣  Common Patterns");
console.log("──────────────────────────────────────────────────");

console.log("\n   Pattern A: Simple Arrays");
console.log("   ─────────────────────────");
console.log("   certified_models: [1, 2, 3] → '[1,2,3]'");

console.log("\n   Pattern B: String Arrays");
console.log("   ─────────────────────────");
console.log("   tags: ['urgent', 'review'] → '[\"urgent\",\"review\"]'");

console.log("\n   Pattern C: Complex Objects");
console.log("   ─────────────────────────");
console.log("   metadata: {key: 'value'} → '{\"key\":\"value\"}'");
console.log("   transform: { toDatabase: JSON.stringify, fromDatabase: JSON.parse }");

console.log("\n   Pattern D: Defaults for Null");
console.log("   ─────────────────────────");
console.log("   fromDatabase: (v) => v ? JSON.parse(v) : []");

console.log("\n\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                      Summary                                   ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

console.log("✨ PROBLEM SOLVED!");
console.log("\nBefore: Had to use raw SQL to bypass type validation");
console.log("        const sql = `UPDATE User SET certified_models = ? WHERE id = ?`;");
console.log("        context.User.raw(sql, [jsonString, userId]);");
console.log("\nAfter:  Use ORM naturally with automatic transformation");
console.log("        user.certified_models = [1, 2, 3];");
console.log("        context.saveChanges();");

console.log("\n🎯 Use Case: This example solves the exact problem from the");
console.log("   BookBag calibration system where arrays needed to bypass ORM.\n");

console.log("📖 See readme.md 'Field Transformers' section for full documentation.\n");
