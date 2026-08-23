/**
 * `db.boolean()` columns materialize as real booleans on read (EF Core value
 * conversion). SQLite stores them as INTEGER 0/1 (MySQL as TINYINT(1)), and until
 * 1.22.1 a row read back through toList()/find()/single() exposed `1`/`0` — so an
 * API echoed `{ published: 1 }` after an update but `{ published: true }` right
 * after the insert (the in-memory value). null stays null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import FieldTransformer from '../Entity/fieldTransformer.js';

process.env.master = 'development';

class Post {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
    published(db) { db.boolean(); }
    featured(db) { db.boolean().nullable(); }
}

// One database shared by every context in this file (a fresh context = reads from disk, not memory).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-bool-'));
const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-bool-env-'));
fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
    testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
}));

function makeCtx() {
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Post); }
    }
    return new testContext();
}

test('FieldTransformer.materialize converts stored 0/1 (and string/bigint/BIT forms) to booleans only for boolean fields', () => {
    const bool = { type: 'boolean' };
    assert.equal(FieldTransformer.materialize(1, bool), true);
    assert.equal(FieldTransformer.materialize(0, bool), false);
    assert.equal(FieldTransformer.materialize('1', bool), true);
    assert.equal(FieldTransformer.materialize('false', bool), false);
    assert.equal(FieldTransformer.materialize(1n, bool), true);
    assert.equal(FieldTransformer.materialize(Buffer.from([0]), bool), false);
    assert.equal(FieldTransformer.materialize(true, bool), true);
    assert.equal(FieldTransformer.materialize(null, bool), null);
    assert.equal(FieldTransformer.materialize(undefined, bool), undefined);
    assert.equal(FieldTransformer.materialize(1, { type: 'integer' }), 1, 'integers are untouched');
    assert.equal(FieldTransformer.materialize('1', { type: 'string' }), '1');
});

test('sqlite: boolean columns read back as true/false through toList/find/single, before and after an update', async () => {
    const ctx = makeCtx();
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE IF NOT EXISTS "Post" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "published" INTEGER, "featured" INTEGER)`);

    const p = new Post();
    p.title = 'Hello';
    p.published = true;
    ctx.Post.add(p);
    await ctx.saveChanges();

    const fresh = makeCtx();                            // a different context: values come from the DB, not memory
    await fresh._ensureReady();
    const list = await fresh.Post.toList();
    assert.equal(list.length, 1);
    assert.strictEqual(list[0].published, true, 'toList() materializes INTEGER 1 as true');
    assert.strictEqual(list[0].featured, null, 'null stays null');

    const one = await fresh.Post.find(list[0].id);
    assert.strictEqual(one.published, true);

    one.published = false;
    await fresh.saveChanges();

    const again = makeCtx();
    await again._ensureReady();
    const after = await again.Post.where('p => p.id == $$', list[0].id).single();
    assert.strictEqual(after.published, false, 'after update: INTEGER 0 -> false');
    assert.strictEqual(JSON.stringify({ published: after.published }), '{"published":false}', 'serializes as a JSON boolean');

    const noTrack = await again.Post.asNoTracking().toList();
    assert.strictEqual(noTrack[0].published, false, 'asNoTracking() path materializes too');
});
