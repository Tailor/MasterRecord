/**
 * belongsTo FK column setter on `.new()` entities.
 *
 * Bug: `belongsTo('Run')` declares a navigation property `Run` and an
 * implicit foreign-key column `run_id`. `.new()` walks the entity
 * definition and creates a setter for `Run`, but NOT for `run_id` (the
 * FK column doesn't appear as a top-level field in `__entity`).
 *
 * Effect: `step.run_id = 'run_xyz'` lands as a plain JS property — the
 * tracker never sees it, the INSERT builder never picks it up, the row
 * goes in without the FK. Users were forced to either use the
 * navigation setter (`step.Run = id`) or drop to raw SQL.
 *
 * Fix: when defining `.new()` setters, for each `belongsTo` column,
 * also define a setter on the foreignKey field name that stores the
 * value and marks the FK as dirty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'fk-setter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'belongs-to-fk-setter');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

fs.writeFileSync(
    path.join(envDir, 'env.fk-setter.json'),
    JSON.stringify({
        FkSetterCtx: { type: 'better-sqlite3', connection: dbDir + path.sep },
    })
);

const { default: context } = await import('../context.js');

class Run {
    id(db) { db.string().primary(); }
    name(db) { db.string(); }
}

class Step {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    Run(db) { db.belongsTo('Run').notNullable(); }
}

class FkSetterCtx extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Run);
        this.dbset(Step);
    }
}

test('.new() entity has a setter for the belongsTo foreignKey column', () => {
    const ctx = new FkSetterCtx();
    const step = ctx.Step.new();

    // The navigation property setter has always worked
    step.Run = 'run_abc';
    assert.equal(step.Run, 'run_abc');

    // The FK column setter is what was broken
    step.run_id = 'run_xyz';
    assert.equal(step.run_id, 'run_xyz', 'run_id should be readable');
    // The assignment must be tracked. Internally we canonicalize to the
    // navigation-property name ('Run') so the engine UPDATE/INSERT
    // builders' existing belongsTo handling picks it up. Either name in
    // __dirtyFields is acceptable; what matters is that the entity is
    // marked as having a pending change.
    const dirtyHas = step.__dirtyFields.includes('Run') ||
                     step.__dirtyFields.includes('run_id');
    assert.ok(
        dirtyHas,
        `FK assignment must be marked dirty, got: ${JSON.stringify(step.__dirtyFields)}`
    );
});

test('loaded entity allows reassigning run_id and persists the UPDATE', async () => {
    const ctx = new FkSetterCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Run (
            id TEXT PRIMARY KEY,
            name TEXT
        );
        CREATE TABLE IF NOT EXISTS Step (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            run_id TEXT NOT NULL
        );
        DELETE FROM Step;
        DELETE FROM Run;
        INSERT INTO Run (id, name) VALUES ('run_alpha', 'first');
        INSERT INTO Run (id, name) VALUES ('run_beta', 'second');
        INSERT INTO Step (id, name, run_id) VALUES (1, 'step 1', 'run_alpha');
    `);

    const step = await ctx.Step.where(s => s.id == $$, 1).single();
    assert.equal(step.run_id, 'run_alpha', 'loaded step has the FK');

    // Reassign the FK. Pre-fix this throws because the tracker setter
    // does `currentEntity[modelField].set` without a null guard — and
    // currentEntity has no 'run_id' key (only 'Run' with foreignKey).
    step.run_id = 'run_beta';
    assert.equal(step.run_id, 'run_beta');
    const dirtyHas = step.__dirtyFields.includes('Run') ||
                     step.__dirtyFields.includes('run_id');
    assert.ok(dirtyHas, `dirty fields: ${JSON.stringify(step.__dirtyFields)}`);

    await ctx.saveChanges();

    const after = ctx._SQLEngine.db.prepare('SELECT run_id FROM Step WHERE id = 1').get();
    assert.equal(after.run_id, 'run_beta');

    await ctx.close();
});

test('.new() then setting run_id ends up in SQLite INSERT', async () => {
    const ctx = new FkSetterCtx();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Run (
            id TEXT PRIMARY KEY,
            name TEXT
        );
        CREATE TABLE IF NOT EXISTS Step (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            run_id TEXT NOT NULL
        );
        DELETE FROM Step;
        DELETE FROM Run;
        INSERT INTO Run (id, name) VALUES ('run_abc', 'first');
    `);

    const step = ctx.Step.new();
    step.name = 'step 1';
    step.run_id = 'run_abc'; // ← this is the case the bug forbade
    await ctx.saveChanges();

    const rows = ctx._SQLEngine.db.prepare('SELECT * FROM Step').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run_id, 'run_abc');
    assert.equal(rows[0].name, 'step 1');

    await ctx.close();
});
