/**
 * Batched-insert auto-PK handling (1.2.8).
 *
 * Bug: the INSERT builder (_buildSQLInsertObjectParameterized) skipped an
 * unset auto-increment PK only when its value was undefined/null. When the
 * PK surfaced as the schema-definition FUNCTION (`id(db){…}`, e.g. a class
 * instance) or any function/getter, the builder fell through to the type
 * validator and threw "Expected integer, got function" — failing the
 * batched-insert path (which then fell back to individual inserts).
 *
 * Fix: an auto-increment PK is DB-assigned and is never emitted in the
 * INSERT unless the caller set an explicit value; a function value is never
 * a valid column value. Both single- and batched-insert paths share the
 * builder, so both now behave the same.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SQLiteEngine from '../SQLLiteEngine.js';

process.env.master = 'bulkpk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'bulk-autopk');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.bulkpk.json'),
    JSON.stringify({ BulkCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const modelEntity = {
    __name: 'AgentSkill',
    id: { name: 'id', type: 'integer', primary: true, auto: true },
    agent_id: { name: 'agent_id', type: 'integer' },
    skill_id: { name: 'skill_id', type: 'integer' },
};

test('INSERT builder skips an auto-PK that leaked as its schema function', () => {
    const engine = new SQLiteEngine();
    // id is the schema-definition method (the reported leak)
    const fields = { id: function id(db) { db.integer().primary().auto(); }, agent_id: 5, skill_id: 7 };
    const out = engine._buildSQLInsertObjectParameterized(fields, modelEntity);
    const cols = out.columns.split(',').map(s => s.trim().replace(/[[\]]/g, ''));
    assert.ok(!cols.includes('id'), `id must be excluded; got columns: ${out.columns}`);
    assert.ok(cols.includes('agent_id') && cols.includes('skill_id'));
    assert.deepEqual(out.params, [5, 7]);
});

test('INSERT builder still skips an unset (undefined) auto-PK', () => {
    const engine = new SQLiteEngine();
    const out = engine._buildSQLInsertObjectParameterized({ id: undefined, agent_id: 1, skill_id: 2 }, modelEntity);
    const cols = out.columns.split(',').map(s => s.trim().replace(/[[\]]/g, ''));
    assert.ok(!cols.includes('id'));
    assert.deepEqual(out.params, [1, 2]);
});

test('INSERT builder HONORS an explicitly-set auto-PK value', () => {
    const engine = new SQLiteEngine();
    const out = engine._buildSQLInsertObjectParameterized({ id: 42, agent_id: 1, skill_id: 2 }, modelEntity);
    assert.match(out.columns, /\[id\]/);
    assert.ok(out.params.includes(42), 'an explicit PK value must be emitted');
});

// End-to-end: the batched path assigns auto IDs and doesn't error/fall back.
const { default: context } = await import('../context.js');
class BulkCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(class AgentSkill {
            id(db) { db.integer().primary().auto(); }
            agent_id(db) { db.integer(); }
            skill_id(db) { db.integer(); }
        }, 'AgentSkill');
    }
}

test('bulkCreate assigns auto-increment IDs across a batch (no fallback error)', async () => {
    const ctx = new BulkCtx();
    ctx._SQLEngine.db.exec('DROP TABLE IF EXISTS AgentSkill; CREATE TABLE AgentSkill (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id INTEGER, skill_id INTEGER);');

    const rows = await ctx.bulkCreate('AgentSkill', [
        { agent_id: 1, skill_id: 10 },
        { agent_id: 1, skill_id: 11 },
        { agent_id: 2, skill_id: 12 },
    ]);

    assert.equal(rows.length, 3);
    for (const r of rows) {
        assert.equal(typeof r.id, 'number', 'each row must get a DB-assigned id');
        assert.ok(r.id > 0);
    }
    const count = ctx._SQLEngine.db.prepare('SELECT COUNT(*) c FROM AgentSkill').get().c;
    assert.equal(count, 3);
    await ctx.close();
});
