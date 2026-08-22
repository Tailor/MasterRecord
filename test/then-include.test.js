/**
 * thenInclude() / asSplitQuery() — Entity Framework Core ThenInclude + AsSplitQuery.
 *
 * Implemented as EF's split query: after the main query, ONE batched query
 * (IN on the parent keys) per navigation level — no cartesian explosion, no
 * N+1 — for belongsTo, hasOne, hasMany, hasManyThrough and manyToMany, at any
 * depth. include() of an implicit many-to-many navigation goes through the
 * same loader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';

process.env.master = 'development';

class Category { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } tags(db) { db.hasMany('Tag'); } }
class Tag      { id(db) { db.integer().primary().auto(); } label(db) { db.string(); } category(db) { db.belongsTo('Category').nullable(); } posts(db) { db.manyToMany('Post'); } }
class Author   { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } posts(db) { db.hasMany('Post'); } }
class Post     { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } author(db) { db.belongsTo('Author').nullable(); } tags(db) { db.manyToMany('Tag'); } }

async function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ti-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ti-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        TiCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class TiCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Category); this.dbset(Tag); this.dbset(Author); this.dbset(Post); }
    }
    const ctx = new TiCtx();
    const sch = new schemaCls(TiCtx); await sch._ensureReady();
    for (const n of ['Category', 'Tag', 'Author', 'Post', 'PostTag']) await sch.createTable(ctx.__entities.find(e => e && e.__name === n));
    const db = ctx._SQLEngine.db;
    db.exec(`INSERT INTO Category (name) VALUES ('tech'), ('life');
             INSERT INTO Tag (label, category_id) VALUES ('js', 1), ('db', 1), ('zen', 2), ('loose', NULL);
             INSERT INTO Author (name) VALUES ('ann'), ('bob');
             INSERT INTO Post (title, author_id) VALUES ('p1', 1), ('p2', 1), ('p3', 2), ('p4', NULL);
             INSERT INTO PostTag (post_id, tag_id) VALUES (1,1),(1,2),(2,2),(2,3),(3,4);`);
    const selects = [];
    ctx.on('command', c => { if (/^\s*SELECT/i.test(c.sql)) selects.push(c.sql.replace(/\s+/g, ' ')); });
    return { ctx, selects };
}

test('include(manyToMany).thenInclude(belongsTo): every level loaded, batched — 4 SELECTs for N posts', async () => {
    const { ctx, selects } = await makeCtx();
    const posts = await ctx.Post.include('p => p.tags').thenInclude('t => t.category').orderBy('p => p.id').toList();
    assert.equal(posts.length, 4);
    const byTitle = Object.fromEntries(posts.map(p => [p.title, p]));
    assert.deepEqual(byTitle.p1.tags.map(t => t.label).sort(), ['db', 'js'], 'loaded synchronously (no Promise)');
    assert.deepEqual(byTitle.p2.tags.map(t => t.label).sort(), ['db', 'zen']);
    assert.deepEqual(byTitle.p4.tags, []);
    assert.equal(byTitle.p1.tags.find(t => t.label === 'js').category.name, 'tech', 'second level loaded');
    assert.equal(byTitle.p3.tags[0].category, null, 'null FK -> null, no lazy Promise');
    assert.equal(selects.length, 4, `main + join + tags + categories, regardless of row count: ${selects.join(' | ')}`);
    assert.ok(selects[1].includes('PostTag') && /IN \(/.test(selects[1]), 'batched IN query on the join table');
});

test('asSplitQuery(): hasMany include + thenInclude(manyToMany) + deeper; belongsTo include batched', async () => {
    const { ctx, selects } = await makeCtx();
    const authors = await ctx.Author.asSplitQuery().include('a => a.posts').thenInclude('p => p.tags').thenInclude('t => t.category').orderBy('a => a.id').toList();
    assert.equal(authors.length, 2);
    assert.deepEqual(authors[0].posts.map(p => p.title).sort(), ['p1', 'p2']);
    assert.deepEqual(authors[1].posts.map(p => p.title), ['p3']);
    assert.deepEqual(authors[0].posts.find(p => p.title === 'p2').tags.map(t => t.label).sort(), ['db', 'zen']);
    assert.equal(authors[0].posts.find(p => p.title === 'p1').tags.find(t => t.label === 'js').category.name, 'tech');
    assert.equal(selects.length, 5, `authors + posts + join + tags + categories: ${selects.length}`);
    assert.equal(typeof authors[0].posts.add, 'function', 'loaded collections keep EF add()/remove()');

    selects.length = 0;
    const posts = await ctx.Post.asSplitQuery().include('author').toList();   // bare navigation name accepted
    assert.equal(posts.find(p => p.title === 'p1').author.name, 'ann');
    assert.equal(posts.find(p => p.title === 'p4').author, null);
    assert.equal(selects.length, 2, 'posts + one batched authors query');
});

test('single()/first() run the split includes too; thenInclude() without include() and asSplitQuery() after include() are rejected', async () => {
    const { ctx } = await makeCtx();
    const p2 = await ctx.Post.include('tags').thenInclude('category').where('p => p.title == $$', 'p2').single();
    assert.deepEqual(p2.tags.map(t => t.label).sort(), ['db', 'zen']);
    assert.equal(p2.tags.find(t => t.label === 'zen').category.name, 'life');
    const first = await ctx.Post.asSplitQuery().include('author').first();
    assert.equal(first.author.name, 'ann');
    assert.throws(() => ctx.Post.thenInclude('category'), /must follow include\(\)/);
    assert.throws(() => ctx.Author.include('a => a.posts').asSplitQuery(), /before include\(\)/);
});
