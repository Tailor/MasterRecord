/**
 * Friendly error when a context/migration file's dependencies aren't installed
 * (1.4.1).
 *
 * A user's context file typically does `import masterrecord from 'masterrecord'`.
 * Run the CLI in a checkout with no `node_modules` and Node throws a cryptic
 * ERR_MODULE_NOT_FOUND naming the bare specifier, buried in a stack trace. The
 * CLI now translates that into "run `npm install` first".
 *
 * This test confirms the DETECTION matches Node's real error shape (code +
 * "Cannot find package '<bare>'"), which is what the CLI's __loadUserModule
 * branch keys off. It imports a module that requires a non-existent package.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('a bare-specifier ERR_MODULE_NOT_FOUND is detectable and yields the package name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-missingdep-'));
    const file = path.join(dir, 'ctx.mjs');
    fs.writeFileSync(file, "import x from 'definitely-not-a-real-pkg-xyz';\nexport default x;\n");

    let caught = null;
    try {
        await import(pathToFileURL(file).href);
    } catch (err) {
        caught = err;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    assert.ok(caught, 'import of a missing bare dependency must throw');
    assert.equal(caught.code, 'ERR_MODULE_NOT_FOUND');

    // This is exactly the branch the CLI uses to produce the friendly message.
    const m = /Cannot find package '([^']+)'|Cannot find module '([^']+)'/.exec(caught.message || '');
    const missing = m ? (m[1] || m[2]) : null;
    assert.equal(missing, 'definitely-not-a-real-pkg-xyz');
    assert.ok(missing && !missing.startsWith('.') && !path.isAbsolute(missing), 'a bare specifier signals a missing dependency');
});
