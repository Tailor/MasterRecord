/**
 * Global query filters inside include() — EF Core applies HasQueryFilter to
 * included navigations, and IgnoreQueryFilters() on the root query applies to
 * the whole query (every included level).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';

process.env.master = 'development';

class Author { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } banned(db) { db.boolean().default(false); } posts(db) { db.hasMany('Post'); } }
class Tag    { id(db) { db.integer().primary().auto(); } label(db) { db.string(); } deleted(db) { db.boolean().default(false); } }
class Post   { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } author(db) { db.belongsTo('Author').nullable(); } tags(db) { db.manyToMany('Tag'); } }

async function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-iqf-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-iqf-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        IqfCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class IqfCtx extends masterrecord.context {
        constructor() {
            super(); this.env(envDir);
            this.dbset(Author).queryFilter('notBanned', 'a => a.banned == $$', false);
            this.dbset(Tag).queryFilter('softDelete', 't => t.deleted == $$', false);
            this.dbset(Post);
        }
    }
    const ctx = new IqfCtx();
    const sch = new schemaCls(IqfCtx); await sch._ensureReady();
    for (const n of ['Author', 'Tag', 'Post', 'PostTag']) await sch.createTable(ctx.__entities.find(e => e && e.__name === n));
    ctx._SQLEngine.db.exec(`INSERT INTO Author (name, banned) VALUES ('ann', 0), ('bad', 1);
             INSERT INTO Tag (label, deleted) VALUES ('live', 0), ('gone', 1);
             INSERT INTO Post (title, author_id) VALUES ('p1', 1), ('p2', 2);
             INSERT INTO PostTag (post_id, tag_id) VALUES (1,1),(1,2),(2,1);`);
    return ctx;
}

test('filters apply to included / lazily loaded navigations; ignoreQueryFilters() on the root applies to every level', async () => {
    const ctx = await makeCtx();
    const posts = await ctx.Post.include('p => p.tags').include('p => p.author').orderBy('p => p.id').toList();
    assert.deepEqual(posts[0].tags.map(t => t.label), ['live'], 'soft-deleted tag excluded from the include');
    assert.equal(posts[0].author.name, 'ann');
    assert.equal(posts[1].author, null, 'banned author filtered out of the include (belongsTo target has a filter)');

    const lazy = await ctx.Post.where('p => p.title == $$', 'p1').single();
    assert.deepEqual((await lazy.tags).map(t => t.label), ['live'], 'lazy/explicit loading applies the filter too');

    const all = await ctx.Post.ignoreQueryFilters().include('p => p.tags').include('p => p.author').orderBy('p => p.id').toList();
    assert.deepEqual(all[0].tags.map(t => t.label).sort(), ['gone', 'live'], 'IgnoreQueryFilters reaches the included level');
    assert.equal(all[1].author.name, 'bad');

    const named = await ctx.Post.ignoreQueryFilters(['softDelete']).include('p => p.tags').include('p => p.author').orderBy('p => p.id').toList();
    assert.deepEqual(named[0].tags.map(t => t.label).sort(), ['gone', 'live'], 'only the named filter is ignored');
    assert.equal(named[1].author, null, 'the other filter still applies');
});
