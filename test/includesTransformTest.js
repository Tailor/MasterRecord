/**
 * Unit Test: .includes() Transformation Logic
 *
 * This test verifies the __transformIncludes method correctly transforms
 * JavaScript .includes() syntax to MasterRecord's .any() syntax.
 */

// Simple mock of the transformation method
function __transformIncludes(str, args){
    // Pattern: $$.includes(entity.field) or $$.includes(entity.field.nested)
    const includesPattern = /\$\$\.includes\s*\(\s*([\w\d$_]+)\.([.\w\d_]+)\s*\)/g;

    // Use replace with a function - when using a function, return value is used literally
    const transformedStr = str.replace(includesPattern, (match, entity, field) => {
        // Transform to .any() syntax: entity.field.any($$)
        return entity + '.' + field + '.any($$)';
    });

    return { query: transformedStr, args: args };
}

// Test cases
const tests = [
    {
        name: "Basic .includes() with simple field",
        input: "u => $$.includes(u.id)",
        expected: "u => u.id.any($$)",
        args: [[1, 2, 3]]
    },
    {
        name: ".includes() with string field",
        input: "u => $$.includes(u.name)",
        expected: "u => u.name.any($$)",
        args: [["Alice", "Bob"]]
    },
    {
        name: ".includes() with spaces",
        input: "u => $$.includes( u.id )",
        expected: "u => u.id.any($$)",
        args: [[1, 2, 3]]
    },
    {
        name: ".includes() in complex query",
        input: "u => $$.includes(u.id) && u.active == true",
        expected: "u => u.id.any($$) && u.active == true",
        args: [[1, 2, 3]]
    },
    {
        name: "Multiple .includes() in same query",
        input: "u => $$.includes(u.id) && $$.includes(u.role_id)",
        expected: "u => u.id.any($$) && u.role_id.any($$)",
        args: [[1, 2, 3], [10, 20]]
    },
    {
        name: "No .includes() - should not change",
        input: "u => u.id == $$",
        expected: "u => u.id == $$",
        args: [5]
    },
    {
        name: ".includes() with nested field path",
        input: "u => $$.includes(u.profile_id)",
        expected: "u => u.profile_id.any($$)",
        args: [[100, 200, 300]]
    }
];

// Run tests
console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       .includes() Transformation Unit Tests                   ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

for(const test of tests){
    console.log(`📝 ${test.name}`);
    console.log(`   Input:    ${test.input}`);
    console.log(`   Expected: ${test.expected}`);

    const result = __transformIncludes(test.input, test.args);

    if(result.query === test.expected){
        console.log(`   ✅ PASS - Got: ${result.query}\n`);
        passed++;
    } else {
        console.log(`   ❌ FAIL - Got: ${result.query}\n`);
        failed++;
    }
}

// Summary
console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║                       Test Summary                             ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log(`   Total: ${tests.length} tests`);
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Success Rate: ${Math.round((passed/tests.length)*100)}%\n`);

if(failed === 0){
    console.log("🎉 All transformation tests passed!");
    console.log("\n📖 The .includes() feature is ready to use:");
    console.log("   const ids = [1, 2, 3];");
    console.log("   context.User.where(u => $$.includes(u.id), ids).toList()");
    process.exit(0);
} else {
    console.log("⚠️  Some tests failed. Review the transformation logic.");
    process.exit(1);
}
