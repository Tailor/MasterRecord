/**
 * Cross-context change-tracking guard (1.4.3).
 *
 * Bug: change tracking is per-context-instance. If you load/mutate an entity via
 * context A and then call saveChanges() on a DIFFERENT context instance B, B
 * silently writes zero rows — no error, no warning — because A owns the tracking.
 * This is the #1 cause of "saveChanges() succeeded but nothing was written".
 *
 * Fix (loud failure, no silent no-op):
 *  - A global (leak-safe) registry of live context instances lets saveChanges()
 *    detect entities with unsaved changes tracked by a different instance and
 *    warn loudly, naming them and pointing at the fix.
 *  - context.attach(entity) re-homes an entity's tracking to a new context (and
 *    now detaches it from its previous one), so intentional cross-context saves
 *    work and stop warning.
 *  - Suppressible via MASTERRECORD_SILENCE_CROSS_CONTEXT=1.
 *
 * (We deliberately do NOT warn on close-with-unsaved-changes: the framework
 * can't tell "forgot to save" from "deliberately abandoned", so it would
 * false-positive on a legitimate load-mutate-abandon flow.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'crossctx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.join(__dirname, 'fixtures', 'cross-context', 'config', 'environments');
const dbDir = path.join(__dirname, 'fixtures', 'cross-context', 'db');
fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
fs.writeFileSync(
    path.join(envDir, 'env.crossctx.json'),
    JSON.stringify({ XCtx: { type: 'better-sqlite3', connection: dbDir + path.sep } })
);

const { default: context } = await import('../context.js');

class Thing { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class XCtx extends context {
    constructor() { super(); this.env(envDir); this.dbset(Thing); }
}

function spyWarn() {
    const original = console.warn;
    const messages = [];
    console.warn = (...args) => { messages.push(args.join(' ')); };
    return { messages, restore: () => { console.warn = original; } };
}

// Fresh table + one row (id=1, name='original'), via a fresh context.
function seed() {
    const ctx = new XCtx();
    ctx._SQLEngine.db.exec(
        "DROP TABLE IF EXISTS Thing; CREATE TABLE Thing (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT); INSERT INTO Thing (name) VALUES ('original');"
    );
    return ctx;
}

async function readName(ctx) {
    const rows = await ctx.Thing.toList();
    return rows.length ? rows[0].name : null;
}

test('mutate via context A, saveChanges on context B → warns loudly AND writes nothing', async () => {
    const ctxA = seed();
    const ctxB = new XCtx();
    const spy = spyWarn();
    try {
        const e = await ctxA.Thing.where(t => t.id == $$, 1).single();
        e.name = 'changed-via-A';           // now dirty, tracked by A

        await ctxB.saveChanges();           // called on the WRONG instance

        const warned = spy.messages.some(m => /different context instance/i.test(m) && /Thing#1/.test(m));
        assert.ok(warned, `expected a cross-context warning naming Thing#1; got: ${spy.messages.join(' | ')}`);

        // The change must NOT have been persisted by the wrong context.
        assert.equal(await readName(ctxB), 'original', 'the mutation must not be written by the wrong context');
    } finally {
        await ctxA.close();
        await ctxB.close();
        spy.restore();
    }
});

test('attach() re-homes the entity so context B persists it and stops warning', async () => {
    const ctxA = seed();
    const ctxB = new XCtx();
    try {
        const e = await ctxA.Thing.where(t => t.id == $$, 1).single();
        e.name = 'changed';

        ctxB.attach(e);                     // move tracking to B (detaches from A)

        const spy = spyWarn();
        await ctxB.saveChanges();
        spy.restore();

        assert.ok(
            !spy.messages.some(m => /different context instance/i.test(m)),
            `re-homed entity must not warn; got: ${spy.messages.join(' | ')}`
        );
        assert.equal(await readName(ctxB), 'changed', 'attach() + saveChanges() must persist the change');
    } finally {
        await ctxA.close();
        await ctxB.close();
    }
});

test('saving via the owning context persists and does not warn', async () => {
    const ctxA = seed();
    const spy = spyWarn();
    try {
        const e = await ctxA.Thing.where(t => t.id == $$, 1).single();
        e.name = 'via-owner';
        await ctxA.saveChanges();
        assert.ok(
            !spy.messages.some(m => /different context instance/i.test(m)),
            `same-context save must not warn; got: ${spy.messages.join(' | ')}`
        );
        assert.equal(await readName(ctxA), 'via-owner');
    } finally {
        spy.restore();
        await ctxA.close();
    }
});

test('single-context insert + save does NOT emit a cross-context warning', async () => {
    const ctx = seed();
    const spy = spyWarn();
    try {
        const t = ctx.Thing.new();
        t.name = 'fresh';
        await ctx.saveChanges();
        assert.ok(
            !spy.messages.some(m => /different context instance/i.test(m)),
            `normal single-context usage must not warn; got: ${spy.messages.join(' | ')}`
        );
    } finally {
        spy.restore();
        await ctx.close();
    }
});

test('MASTERRECORD_SILENCE_CROSS_CONTEXT=1 silences the cross-context warning', async () => {
    const ctxA = seed();
    const ctxB = new XCtx();
    const prev = process.env.MASTERRECORD_SILENCE_CROSS_CONTEXT;
    process.env.MASTERRECORD_SILENCE_CROSS_CONTEXT = '1';
    const spy = spyWarn();
    try {
        const e = await ctxA.Thing.where(t => t.id == $$, 1).single();
        e.name = 'x';
        await ctxB.saveChanges();
        assert.ok(
            !spy.messages.some(m => /different context instance/i.test(m)),
            `suppress flag must silence the warning; got: ${spy.messages.join(' | ')}`
        );
    } finally {
        // Close while still suppressed so tearing down ctxA (which holds the
        // never-saved 'x' mutation) doesn't emit a stray close warning.
        await ctxA.close();
        await ctxB.close();
        if (prev === undefined) { delete process.env.MASTERRECORD_SILENCE_CROSS_CONTEXT; }
        else { process.env.MASTERRECORD_SILENCE_CROSS_CONTEXT = prev; }
        spy.restore();
    }
});
