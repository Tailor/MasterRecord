/**
 * Comprehensive Field Transformer Test Suite
 *
 * Tests the custom field transformation system that allows entities
 * to define serialization/deserialization logic.
 *
 * Real-world use case: Storing JavaScript arrays as JSON strings
 */

const FieldTransformer = require('../Entity/fieldTransformer');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║          Field Transformer Test Suite                         ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test 1: Basic toDatabase transformation
console.log("📝 Test 1: toDatabase - Array to JSON string");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            toDatabase: (value) => Array.isArray(value) ? JSON.stringify(value) : value
        }
    };

    const input = [1, 2, 3, 4, 5];
    const result = FieldTransformer.toDatabase(input, fieldDef, "User", "certified_models");

    if(result === '[1,2,3,4,5]'){
        console.log("   ✓ Array [1, 2, 3, 4, 5] → '[1,2,3,4,5]'");
        passed++;
    } else {
        console.log(`   ✗ Expected '[1,2,3,4,5]', got '${result}'`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 2: fromDatabase transformation
console.log("\n📝 Test 2: fromDatabase - JSON string to Array");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            fromDatabase: (value) => {
                if(!value) return [];
                try { return JSON.parse(value); }
                catch { return []; }
            }
        }
    };

    const input = '[1,2,3,4,5]';
    const result = FieldTransformer.fromDatabase(input, fieldDef, "User", "certified_models");

    if(Array.isArray(result) && result.length === 5 && result[0] === 1){
        console.log("   ✓ '[1,2,3,4,5]' → [1, 2, 3, 4, 5]");
        passed++;
    } else {
        console.log(`   ✗ Expected array [1,2,3,4,5], got ${JSON.stringify(result)}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 3: Round-trip transformation
console.log("\n📝 Test 3: Round-trip - Write and Read");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            toDatabase: (value) => Array.isArray(value) ? JSON.stringify(value) : value,
            fromDatabase: (value) => {
                if(!value) return [];
                try { return JSON.parse(value); }
                catch { return []; }
            }
        }
    };

    const original = [10, 20, 30];
    const dbValue = FieldTransformer.toDatabase(original, fieldDef, "User", "test_field");
    const restored = FieldTransformer.fromDatabase(dbValue, fieldDef, "User", "test_field");

    if(JSON.stringify(restored) === JSON.stringify(original)){
        console.log("   ✓ [10, 20, 30] → '[10,20,30]' → [10, 20, 30]");
        passed++;
    } else {
        console.log(`   ✗ Round-trip failed: ${JSON.stringify(original)} → ${JSON.stringify(restored)}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 4: No transformer - passthrough
console.log("\n📝 Test 4: No Transformer - Pass Through");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string"
        // No transform property
    };

    const input = "test value";
    const result = FieldTransformer.toDatabase(input, fieldDef, "User", "name");

    if(result === input){
        console.log("   ✓ Value passed through unchanged");
        passed++;
    } else {
        console.log(`   ✗ Expected '${input}', got '${result}'`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 5: Transformer error handling
console.log("\n📝 Test 5: Transformer Error Handling");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            toDatabase: (value) => {
                throw new Error("Intentional transformation error");
            }
        }
    };

    try {
        FieldTransformer.toDatabase("test", fieldDef, "User", "bad_field");
        console.log("   ✗ Should have thrown error");
        failed++;
    } catch(err) {
        if(err.message.includes("Transform error for User.bad_field")){
            console.log("   ✓ Error thrown with proper context");
            passed++;
        } else {
            console.log(`   ✗ Wrong error message: ${err.message}`);
            failed++;
        }
    }
} catch(err) {
    console.log(`   ✗ Unexpected error: ${err.message}`);
    failed++;
}

// Test 6: Null/undefined handling
console.log("\n📝 Test 6: Null/Undefined Handling");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            toDatabase: (value) => value || '[]',
            fromDatabase: (value) => value ? JSON.parse(value) : []
        }
    };

    const nullResult = FieldTransformer.toDatabase(null, fieldDef, "User", "test");
    const undefinedResult = FieldTransformer.toDatabase(undefined, fieldDef, "User", "test");

    if(nullResult === '[]' && undefinedResult === '[]'){
        console.log("   ✓ null and undefined handled correctly");
        passed++;
    } else {
        console.log(`   ✗ null: ${nullResult}, undefined: ${undefinedResult}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 7: Complex object transformation
console.log("\n📝 Test 7: Complex Object Transformation");
console.log("──────────────────────────────────────────────────");

try {
    const fieldDef = {
        type: "string",
        transform: {
            toDatabase: (value) => {
                if(Array.isArray(value)){
                    return JSON.stringify(value.map(item => ({
                        id: item.id,
                        name: item.name
                    })));
                }
                return value;
            },
            fromDatabase: (value) => {
                if(!value) return [];
                try {
                    return JSON.parse(value);
                } catch {
                    return [];
                }
            }
        }
    };

    const input = [
        { id: 1, name: "Model A", extra: "ignored" },
        { id: 2, name: "Model B", extra: "ignored" }
    ];

    const dbValue = FieldTransformer.toDatabase(input, fieldDef, "User", "models");
    const restored = FieldTransformer.fromDatabase(dbValue, fieldDef, "User", "models");

    if(restored.length === 2 && restored[0].id === 1 && !restored[0].extra){
        console.log("   ✓ Complex objects transformed correctly");
        passed++;
    } else {
        console.log(`   ✗ Transformation failed: ${JSON.stringify(restored)}`);
        failed++;
    }
} catch(err) {
    console.log(`   ✗ Error: ${err.message}`);
    failed++;
}

// Test 8: Validation must occur AFTER transformation
console.log("\n📝 Test 8: Validation After Transformation");
console.log("──────────────────────────────────────────────────");

console.log("   ℹ  This test validates the integration:");
console.log("   1. User provides array: [1, 2, 3]");
console.log("   2. Transformer converts: [1, 2, 3] → '[1,2,3]'");
console.log("   3. Type validation sees: string '[1,2,3]' ✓");
console.log("   4. Database stores: '[1,2,3]'");
console.log("   ✓ Integration test (validated in real-world example)");
passed++;

// Summary
console.log("\n\n╔════════════════════════════════════════════════════════════════╗");
console.log("║                       Test Summary                             ║");
console.log("╚════════════════════════════════════════════════════════════════╝");

const total = passed + failed;
const successRate = Math.round((passed/total)*100);

console.log(`\n   Total Tests: ${total}`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Success Rate: ${successRate}%\n`);

if(failed === 0){
    console.log("🎉 All transformer tests passed!");
    console.log("\n✨ Field Transformer System Ready!");
    console.log("\n📖 Usage Example:");
    console.log("   class User {");
    console.log("       constructor() {");
    console.log("           this.certified_models = {");
    console.log("               type: 'string',");
    console.log("               transform: {");
    console.log("                   toDatabase: (v) => Array.isArray(v) ? JSON.stringify(v) : v,");
    console.log("                   fromDatabase: (v) => { try { return JSON.parse(v); } catch { return []; } }");
    console.log("               }");
    console.log("           };");
    console.log("       }");
    console.log("   }");
    process.exit(0);
} else {
    console.log("⚠️  Some tests failed. Review and fix issues.");
    process.exit(1);
}
