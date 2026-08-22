/**
 * Pluggable logging with parameter redaction — EF Core LogTo() +
 * EnableSensitiveDataLogging (off by default).
 *
 *  - Nothing is logged unless logSql is on (previously SQL + parameter values
 *    were printed whenever NODE_ENV !== 'production').
 *  - Parameter values are redacted to '?' unless sensitiveData: true.
 *  - slowQueryMs warns on slow commands even when logSql is off.
 *  - Migration DDL is logged at info unless migrations: false.
 *  - Failed commands are logged at error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import { configureLogging } from '../logging.js';

process.env.master = 'development';

class Row { id(db) { db.integer().primary().auto(); } secret(db) { db.string(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-log-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-log-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Row); } }
    return new testContext();
}
function capture() {
    const lines = [];
    const mk = (level) => (msg, data) => lines.push({ level, msg: String(msg), data });
    return { lines, logger: { debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') } };
}
const reset = () => configureLogging({ logger: console, level: 'info', logSql: false, sensitiveData: false, slowQueryMs: 0, migrations: true });

test('default: SQL is not logged; with logSql the SQL is logged and params are REDACTED', async () => {
    const ctx = makeCtx(); await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "secret" TEXT)`);
    const cap = capture();
    try {
        configureLogging({ logger: cap.logger, level: 'debug' });       // logSql still false
        await ctx.Row.where('r => r.secret == $$', 'hunter2').toList();
        assert.equal(cap.lines.filter(l => /masterrecord:sql/.test(l.msg)).length, 0, 'nothing logged by default');

        configureLogging({ logSql: true });
        await ctx.Row.where('r => r.secret == $$', 'hunter2').toList();
        const sqlLines = cap.lines.filter(l => /masterrecord:sql/.test(l.msg));
        assert.ok(sqlLines.length >= 1, 'SQL logged when logSql is on');
        const withParams = sqlLines.find(l => l.data && l.data.params);
        assert.ok(withParams, 'params included');
        assert.deepEqual(withParams.data.params, ['?'], 'parameter VALUES are redacted by default');
        assert.ok(!JSON.stringify(cap.lines).includes('hunter2'), 'the sensitive value never reaches the log');

        configureLogging({ sensitiveData: true });
        await ctx.Row.where('r => r.secret == $$', 'hunter2').toList();
        assert.ok(cap.lines.some(l => l.data && Array.isArray(l.data.params) && l.data.params.includes('hunter2')), 'values shown only when opted in');
    } finally { reset(); await ctx.close(); }
});

test('slow-query warning fires even with logSql off; migration DDL logged at info; failures at error', async () => {
    const ctx = makeCtx(); await ctx._ensureReady();
    const cap = capture();
    try {
        configureLogging({ logger: cap.logger, level: 'debug', logSql: false, slowQueryMs: 0.0001 });
        ctx._execute(`CREATE TABLE IF NOT EXISTS "Row" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "secret" TEXT)`);
        await ctx.Row.toList();
        assert.ok(cap.lines.some(l => l.level === 'warn' && /SLOW/.test(l.msg)), 'slow query warned');

        configureLogging({ slowQueryMs: 0 });
        ctx._SQLEngine._executeWithParams(`CREATE TABLE IF NOT EXISTS "Other" ("id" INTEGER)`);
        assert.ok(cap.lines.some(l => l.level === 'info' && /masterrecord:migration/.test(l.msg)), 'migration DDL logged at info');

        configureLogging({ migrations: false });
        const before = cap.lines.length;
        ctx._SQLEngine._executeWithParams(`CREATE TABLE IF NOT EXISTS "Other2" ("id" INTEGER)`);
        assert.equal(cap.lines.length, before, 'migrations: false silences DDL logging');

        assert.throws(() => ctx._execute(`SELECT * FROM no_such_table_xyz`));
        assert.ok(cap.lines.some(l => l.level === 'error' && /FAILED/.test(l.msg)), 'failed command logged at error');
    } finally { reset(); await ctx.close(); }
});

test('configureLogging validates input and reports config', () => {
    assert.throws(() => configureLogging({ level: 'loud' }), /unknown log level/);
    assert.throws(() => configureLogging({ logger: 42 }), /expects an object/);
    const cfg = configureLogging({ logSql: true, sensitiveData: false, slowQueryMs: 250 });
    assert.equal(cfg.logSql, true); assert.equal(cfg.sensitiveData, false); assert.equal(cfg.slowQueryMs, 250);
    reset();
});
