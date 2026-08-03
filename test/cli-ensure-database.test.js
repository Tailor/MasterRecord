/**
 * `ensure-database` must not require a migration file (1.4.1).
 *
 * The CLI used to exit with "Cannot read or find migration file" before it ever
 * tried to create the database — so a brand-new context couldn't be
 * bootstrapped until a migration had been authored, an awkward ordering for a
 * command whose entire job is "make the database exist".
 *
 * Fix: when no migration file is present, `ensure-database` falls back to the
 * `schema` layer directly (its `createDatabase()` is the same method the
 * migration class inherits). This test verifies the fallback object the CLI now
 * builds exposes that method and runs as a safe no-op on SQLite (whose file is
 * created on open — nothing to create).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import schema from '../Migrations/schema.js';

process.env.master = 'ensuredb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.join(__dirname, 'fixtures', 'ensure-db', 'config', 'environments');
const dbDir = path.join(__dirname, 'fixtures', 'ensure-db', 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.ensuredb.json'),
    JSON.stringify({ EnsureCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Thing { id(db) { db.integer().primary().auto(); } }
class EnsureCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Thing); }
}

test('schema fallback (no migration) exposes createDatabase / createdatabase', async () => {
    const sch = new schema(EnsureCtx);
    try {
        assert.equal(typeof sch.createDatabase, 'function');
        assert.equal(typeof sch.createdatabase, 'function');
        // On SQLite there is no separate database to create (the file exists on
        // open), so this must resolve as a safe no-op — never throw.
        await assert.doesNotReject(() => sch.createDatabase());
    } finally {
        if (sch.context && typeof sch.context.close === 'function') {
            await sch.context.close();
        }
    }
});
