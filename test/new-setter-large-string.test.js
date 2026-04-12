/**
 * Reproduction test for the `.new()` setter bug where larger fields
 * (e.g. a big JSON string) get lost between the setter and the
 * SQL INSERT. This file proves the bug exists before we fix it, and
 * then serves as the regression test after the fix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.master = 'newsetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'new-setter-large-string');
const envDir = path.join(fixturesDir, 'config', 'environments');
const dbDir = path.join(fixturesDir, 'db');
const dbFile = path.join(dbDir, 'NewSetterContext.sqlite');

fs.mkdirSync(envDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });
if (fs.existsSync(dbFile)) fs.rmSync(dbFile);

fs.writeFileSync(
    path.join(envDir, 'env.newsetter.json'),
    JSON.stringify({
        NewSetterContext: {
            type: 'better-sqlite3',
            connection: dbDir + path.sep,
        },
    })
);

const { default: context } = await import('../context.js');

class Template {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
    task_type(db) { db.string(); }
}

class TemplateVersion {
    id(db) { db.integer().primary().auto(); }
    template_id(db) { db.integer(); }
    version(db) { db.integer(); }
    schema_json(db) {
        db.text().transform({
            toDatabase: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
            fromDatabase: (v) => {
                if (typeof v !== 'string') return v;
                try { return JSON.parse(v); } catch { return v; }
            },
        });
    }
    Template(db) { db.belongsTo('Template'); }
}

class NewSetterContext extends context {
    constructor() {
        super();
        this.env(envDir);
        this.dbset(Template);
        this.dbset(TemplateVersion);
    }
}

// Create tables via raw SQL so we bypass the migration machinery.
{
    const ctx = new NewSetterContext();
    ctx._SQLEngine.db.exec(`
        CREATE TABLE IF NOT EXISTS Template (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            task_type TEXT
        );
        CREATE TABLE IF NOT EXISTS TemplateVersion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER,
            version INTEGER,
            schema_json TEXT
        );
    `);
    await ctx.close();
}

const largeJson = JSON.stringify({
    type: 'object',
    properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        payload: {
            type: 'object',
            additionalProperties: false,
            properties: Object.fromEntries(
                Array.from({ length: 25 }, (_, i) => [
                    `field_${i}`,
                    { type: 'string', description: `Description for field ${i} that is long enough to matter.` },
                ])
            ),
        },
    },
    required: ['name', 'payload'],
});

test('.new() persists version row when schema_json is set as a STRING (transformer passthrough)', async () => {
    const db = new NewSetterContext();

    // Create the template row first
    const tpl = db.Template.new();
    tpl.name = 'governance-template';
    tpl.task_type = 'evaluation';
    await tpl.save();

    const tplRow = await db.Template.where('t => t.name == $$', 'governance-template').single();
    assert.ok(tplRow, 'template persisted');
    assert.equal(tplRow.name, 'governance-template');
    assert.equal(tplRow.task_type, 'evaluation');

    // Set schema_json as a string — the transformer passes strings through
    // on write and JSON.parses them on read.
    const ver = db.TemplateVersion.new();
    ver.template_id = tplRow.id;
    ver.version = 1;
    ver.schema_json = largeJson;
    await ver.save();

    const verRow = await db.TemplateVersion
        .where('v => v.template_id == $$', tplRow.id)
        .single();
    assert.ok(verRow, 'version row persisted');
    assert.equal(verRow.template_id, tplRow.id);
    assert.equal(verRow.version, 1);
    // fromDatabase parses the JSON string back into an object on read
    assert.deepEqual(verRow.schema_json, JSON.parse(largeJson));
    await db.close();
});

test('.new() persists template and version rows when reusing the same context', async () => {
    const db = new NewSetterContext();

    const tpl = db.Template.new();
    tpl.name = 'second-template';
    tpl.task_type = 'classification';
    await tpl.save();

    const tplRow = await db.Template.where('t => t.name == $$', 'second-template').single();

    const ver = db.TemplateVersion.new();
    ver.template_id = tplRow.id;
    ver.version = 1;
    ver.schema_json = largeJson;
    await ver.save();

    const verRow = await db.TemplateVersion
        .where('v => v.template_id == $$', tplRow.id)
        .single();
    assert.ok(verRow, 'version row persisted');
    assert.deepEqual(verRow.schema_json, JSON.parse(largeJson));
    await db.close();
});

test('.new() persists version row when schema_json is passed as an OBJECT (transformer path)', async () => {
    const db = new NewSetterContext();

    const tpl = db.Template.new();
    tpl.name = 'object-template';
    tpl.task_type = 'classification';
    await tpl.save();

    const tplRow = await db.Template.where('t => t.name == $$', 'object-template').single();

    const ver = db.TemplateVersion.new();
    ver.template_id = tplRow.id;
    ver.version = 1;
    // Pass an OBJECT — the transform is supposed to JSON.stringify it.
    // This is the path that governance-style seeders use.
    ver.schema_json = JSON.parse(largeJson);
    await ver.save();

    const verRow = await db.TemplateVersion
        .where('v => v.template_id == $$', tplRow.id)
        .single();
    assert.ok(verRow, 'version row persisted');
    assert.ok(
        verRow.schema_json && typeof verRow.schema_json === 'object',
        'schema_json should come back as an object via the transformer'
    );
    assert.deepEqual(verRow.schema_json, JSON.parse(largeJson));
    await db.close();
});
