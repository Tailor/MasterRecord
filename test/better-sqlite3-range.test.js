/**
 * The better-sqlite3 range must keep accepting 12.x.
 *
 * 1.31.0 narrowed it to ^13.0.3. Apps that pin better-sqlite3 12 themselves then got a
 * second, nested 13.x copy under masterrecord, and npm 10 (bundled with Node 20/22) runs
 * `node-gyp rebuild` for it — which needs Python, so builds on slim images (Nixpacks) failed.
 * With 12.x accepted, npm shares the app's copy, and 12.6.2+ ships prebuilt binaries
 * for Node 22/24/26.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('better-sqlite3 range accepts 12.6.2+ and 13.x (shares an app-pinned 12.x copy)', () => {
    assert.equal(pkg.dependencies['better-sqlite3'], '>=12.6.2 <14');
});
