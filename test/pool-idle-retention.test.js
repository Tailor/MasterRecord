/**
 * ADO.NET-style connection pooling: a pooled connection is kept OPEN and idle
 * when its refCount reaches zero (not physically closed), so the next context
 * reuses a warm connection — the reason EF/ADO.NET doesn't reconnect on every
 * scope/DbContext dispose. A background reaper closes truly-idle connections
 * after `MR_POOL_IDLE_MS`. Set `MR_POOL_IDLE_MS=0` to opt out (close immediately).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

class Row { id(db) { db.integer().primary().auto(); } val(db) { db.string(); } }

function ctxClass() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-pool-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-pool-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Row); }
    }
    return testContext;
}

test('a closed connection stays warm and is reused (no reconnect)', async () => {
    const Ctx = ctxClass();
    const a = new Ctx();
    await a._ensureReady();
    const engineA = a._SQLEngine;
    await a.close();                                // refCount 0 -> kept idle, NOT closed

    const b = new Ctx();
    await b._ensureReady();
    assert.equal(b._SQLEngine, engineA, 'the next context reused the same warm connection');

    // still usable
    b._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "val" TEXT)`);
    const r = new Row(); r.val = 'x'; b.Row.add(r); await b.saveChanges();
    assert.equal((await b.Row.toList()).length, 1, 'warm connection works');
    await b.close();
});

// The idle timeout is read at module load, so the reaper / opt-out are exercised
// in child processes with the env set.
function runWithEnv(idleMs, waitMs) {
    const script = `
        process.env.master='development';
        const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
        (async () => {
          const { default: mr } = await import(${JSON.stringify(path.join(root, 'MasterRecord.js'))});
          const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p-'));
          const envDir=fs.mkdtempSync(path.join(os.tmpdir(),'pe-'));
          fs.writeFileSync(path.join(envDir,'env.development.json'), JSON.stringify({C:{env:'development',connection:path.join(dir,'db.sqlite3'),type:'sqlite'}}));
          class C extends mr.context { constructor(){ super(); this.env(envDir);} }
          const a=new C(); await a._ensureReady(); await a.close();
          await new Promise(r=>setTimeout(r, ${waitMs}));
          console.log('POOLSIZE=' + mr.context.getPoolStats().length);
          await mr.context.closeAll();
        })();
    `;
    const res = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, MR_POOL_IDLE_MS: String(idleMs) },
    });
    const m = /POOLSIZE=(\d+)/.exec(res.stdout || '');
    return m ? Number(m[1]) : `no output (stderr: ${res.stderr})`;
}

test('the reaper closes a connection idle past MR_POOL_IDLE_MS', () => {
    // idle timeout 150ms; the reaper scans on a >=1000ms interval, so wait past
    // one tick before asserting the idle connection was closed + removed.
    assert.equal(runWithEnv(150, 1600), 0, 'idle connection reaped after the timeout');
});

test('MR_POOL_IDLE_MS=0 opts out — the connection closes immediately at refCount 0', () => {
    assert.equal(runWithEnv(0, 50), 0, 'with retention disabled, close() removes the pool entry at once');
});
