// Test for where() chaining functionality
// This test verifies that multiple .where() calls combine properly with AND

var queryScript = require('../QueryLanguage/queryScript');

console.log('=== MasterRecord where() Chaining Test ===\n');

// Simulate what happens in the query builder
const qs = new queryScript();

// Test Case: Two chained where() calls (like the user's example)
// let query = this._qaContext.QaTask;
// query = query.where(t => t.assigned_worker_id == $$, this._currentUser.id);
// query = query.where(t => t.status == $$, status);

console.log('Test: Chaining two where() calls');
console.log('  First:  where(t => t.assigned_worker_id == 123)');
console.log('  Second: where(t => t.status == "pending")');
console.log();

// First where call
qs.where('t => t.assigned_worker_id == 123', 'QaTask');

console.log('After first where():');
console.log('  script.where exists:', qs.script.where !== false);
console.log('  script.where.QaTask exists:', qs.script.where && qs.script.where.QaTask !== undefined);
if (qs.script.where && qs.script.where.QaTask && qs.script.where.QaTask.query) {
    const exprs1 = qs.script.where.QaTask.query.expressions || [];
    console.log('  Expressions count:', exprs1.length);
    console.log('  Expression 1:', JSON.stringify(exprs1[0]));
}
console.log();

// Second where call (this should MERGE, not overwrite)
qs.where('t => t.status == "pending"', 'QaTask');

console.log('After second where():');
console.log('  script.where exists:', qs.script.where !== false);
console.log('  script.where.QaTask exists:', qs.script.where && qs.script.where.QaTask !== undefined);

if (qs.script.where && qs.script.where.QaTask && qs.script.where.QaTask.query) {
    const exprs2 = qs.script.where.QaTask.query.expressions || [];
    console.log('  Expressions count:', exprs2.length);
    console.log('  Expression 1:', JSON.stringify(exprs2[0]));
    console.log('  Expression 2:', JSON.stringify(exprs2[1]));
    console.log();

    // Verify results
    console.log('=== Test Results ===');
    if (exprs2.length === 2) {
        console.log('✓ PASS: Both where conditions are present');
        console.log('  - First condition: assigned_worker_id == 123');
        console.log('  - Second condition: status == "pending"');
        console.log('  - These should be combined with AND in the SQL');
    } else {
        console.log('✗ FAIL: Expected 2 expressions, got', exprs2.length);
        if (exprs2.length === 1) {
            console.log('  - Only the last where() was applied (bug not fixed)');
        }
    }
} else {
    console.log('✗ FAIL: script.where structure is invalid');
}

console.log();
console.log('=== Additional Test: Three where() calls ===');

// Test with three chained where calls
const qs2 = new queryScript();
qs2.where('t => t.user_id == 1', 'Task');
qs2.where('t => t.status == "active"', 'Task');
qs2.where('t => t.priority == "high"', 'Task');

if (qs2.script.where && qs2.script.where.Task && qs2.script.where.Task.query) {
    const exprs3 = qs2.script.where.Task.query.expressions || [];
    console.log('Expressions count:', exprs3.length);
    if (exprs3.length === 3) {
        console.log('✓ PASS: All three where conditions are present');
        exprs3.forEach((expr, idx) => {
            console.log(`  ${idx + 1}. ${expr.field} ${expr.func} ${expr.arg}`);
        });
    } else {
        console.log('✗ FAIL: Expected 3 expressions, got', exprs3.length);
    }
}

console.log();
console.log('=== Test Complete ===');
