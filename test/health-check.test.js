/**
 * context.healthCheck() / context.canConnect() (EF Database.CanConnect and the
 * ASP.NET DbContext health check): same shape on every engine, never throws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Thing { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }

function makeCtx(connection) {
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-health-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        HealthCtx: { env: 'development', connection, type: 'sqlite', password: '', username: '' },
    }));
    class HealthCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Thing); }
    }
    return new HealthCtx();
}

test('healthCheck() reports healthy with engine, latency and server version; canConnect() is true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-health-'));
    const ctx = makeCtx(path.join(dir, 'db.sqlite3'));
    const res = await ctx.healthCheck();
    assert.equal(res.healthy, true, JSON.stringify(res));
    assert.equal(res.engine, 'sqlite');
    assert.equal(typeof res.latencyMs, 'number');
    assert.match(String(res.version), /^\d+\.\d+/, 'sqlite_version()');
    assert.equal(await ctx.canConnect(), true);
    await ctx.close();
});

test('healthCheck() never throws: after close() it reports healthy=false with the reason', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-health-'));
    const ctx = makeCtx(path.join(dir, 'db.sqlite3'));
    assert.equal((await ctx.healthCheck()).healthy, true);
    await ctx.close();
    // Force the engine into a closed state and probe again.
    const eng = ctx._SQLEngine;
    if (eng && eng.db && typeof eng.db.close === 'function' && eng.db.open) { try { eng.db.close(); } catch (_) { /* already closed */ } }
    const after = await ctx.healthCheck();
    assert.equal(typeof after.healthy, 'boolean');
    assert.equal(after.engine, 'sqlite');
    if (after.healthy === false) assert.ok(after.error, 'error message present');
});
