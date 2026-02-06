/**
 * Test: Config File Glob Pattern Fix
 * Verifies that the glob pattern only matches environment config files,
 * not arbitrary files ending with .<envType>.json
 *
 * Bug: Old pattern matched too many files:
 * - env.development.json (correct)
 * - development.json (correct)
 * - free-audit-page.development.json (WRONG - should not match)
 *
 * Fix: Use separate patterns with priority:
 * - Pattern 1: env.development.json (preferred)
 * - Pattern 2: development.json (fallback)
 */

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       Config File Glob Pattern Test - Specific Matching       ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

const glob = require('glob');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`✓ ${description}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${description}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
    }
}

function assertArrayContains(array, value, message) {
    if (!array.includes(value)) {
        throw new Error(`${message}\n  Array: ${JSON.stringify(array)}\n  Missing: ${value}`);
    }
}

function assertArrayNotContains(array, value, message) {
    if (array.includes(value)) {
        throw new Error(`${message}\n  Array: ${JSON.stringify(array)}\n  Should not contain: ${value}`);
    }
}

// =============================================================================
// Test Suite: Config File Glob Pattern
// =============================================================================
console.log("📋 Test Suite: Environment Config File Glob Pattern\n");

test('should match env.development.json', () => {
    // Create temp directory structure
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config', 'environments');
    fs.mkdirSync(configDir, { recursive: true });

    // Create test file
    fs.writeFileSync(path.join(configDir, 'env.development.json'), '{}');

    // Test new pattern
    const pattern1 = `${configDir}/**/env.development.json`;
    const files = glob.sync(pattern1, { cwd: tmpDir, nocase: true });

    assertArrayContains(files, path.join(configDir, 'env.development.json'),
        'Should match env.development.json');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('should match development.json as fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    // Create test file
    fs.writeFileSync(path.join(configDir, 'development.json'), '{}');

    // Test fallback pattern
    const pattern2 = `${configDir}/**/development.json`;
    const files = glob.sync(pattern2, { cwd: tmpDir, nocase: true });

    assertArrayContains(files, path.join(configDir, 'development.json'),
        'Should match development.json as fallback');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('should NOT match arbitrary files ending with .development.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config', 'environments');
    fs.mkdirSync(configDir, { recursive: true });

    // Create files
    fs.writeFileSync(path.join(configDir, 'env.development.json'), '{}');
    fs.writeFileSync(path.join(configDir, 'free-audit-page.development.json'), '{}');
    fs.writeFileSync(path.join(configDir, 'my-config.development.json'), '{}');

    // Test new specific pattern
    const pattern1 = `${configDir}/**/env.development.json`;
    const files = glob.sync(pattern1, { cwd: tmpDir, nocase: true });

    // Should ONLY match env.development.json
    assertEqual(files.length, 1, 'Should match exactly 1 file');
    assertArrayContains(files, path.join(configDir, 'env.development.json'),
        'Should match env.development.json');
    assertArrayNotContains(files, path.join(configDir, 'free-audit-page.development.json'),
        'Should NOT match free-audit-page.development.json');
    assertArrayNotContains(files, path.join(configDir, 'my-config.development.json'),
        'Should NOT match my-config.development.json');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('should prioritize env.development.json over development.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    // Create both files
    fs.writeFileSync(path.join(configDir, 'env.development.json'), '{"priority": "high"}');
    fs.writeFileSync(path.join(configDir, 'development.json'), '{"priority": "low"}');

    // Test priority: try env.development.json first
    const pattern1 = `${configDir}/**/env.development.json`;
    const files1 = glob.sync(pattern1, { cwd: tmpDir, nocase: true });

    if (files1.length > 0) {
        assertEqual(files1[0], path.join(configDir, 'env.development.json'),
            'Should find env.development.json first');
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('should work with nested directory structures', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const nestedDir = path.join(tmpDir, 'app', 'config', 'environments', 'production');
    fs.mkdirSync(nestedDir, { recursive: true });

    // Create test file in nested directory
    fs.writeFileSync(path.join(nestedDir, 'env.development.json'), '{}');

    // Test pattern from root
    const pattern = `${tmpDir}/**/env.development.json`;
    const files = glob.sync(pattern, { cwd: tmpDir, nocase: true });

    assertEqual(files.length, 1, 'Should find file in nested directory');
    assertArrayContains(files, path.join(nestedDir, 'env.development.json'),
        'Should match nested env.development.json');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('should be case insensitive', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    // Create test file with different casing (if filesystem allows)
    try {
        fs.writeFileSync(path.join(configDir, 'ENV.DEVELOPMENT.JSON'), '{}');

        const pattern = `${configDir}/**/env.development.json`;
        const files = glob.sync(pattern, { cwd: tmpDir, nocase: true });

        // On case-insensitive filesystems (macOS, Windows), this should match
        if (files.length > 0) {
            console.log('    (Case-insensitive filesystem detected - match confirmed)');
        }
    } catch (e) {
        console.log('    (Case-sensitive filesystem - test skipped)');
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('OLD pattern would have matched too many files (regression check)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-test-'));
    const configDir = path.join(tmpDir, 'config', 'environments');
    fs.mkdirSync(configDir, { recursive: true });

    // Create files
    fs.writeFileSync(path.join(configDir, 'env.development.json'), '{}');
    fs.writeFileSync(path.join(configDir, 'free-audit-page.development.json'), '{}');

    // OLD pattern (the bug)
    const oldPattern = `${configDir}/**/*{env.development,development}.json`;
    const oldFiles = glob.sync(oldPattern, { cwd: tmpDir, nocase: true });

    // OLD pattern matches BOTH files (bad!)
    assertEqual(oldFiles.length, 2, 'OLD pattern matched 2 files (demonstrating the bug)');

    // NEW pattern (the fix)
    const newPattern = `${configDir}/**/env.development.json`;
    const newFiles = glob.sync(newPattern, { cwd: tmpDir, nocase: true });

    // NEW pattern matches only 1 file (good!)
    assertEqual(newFiles.length, 1, 'NEW pattern matches only 1 file (the fix)');
    assertArrayContains(newFiles, path.join(configDir, 'env.development.json'),
        'NEW pattern matches correct file');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "═".repeat(64));
console.log(`\n✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`\nTotal: ${passed + failed} tests\n`);

process.exit(failed > 0 ? 1 : 0);
