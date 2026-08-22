/**
 * Many-to-many with an IMPLICIT join entity — Entity Framework Core 5+ skip
 * navigations (HasMany().WithMany()).
 *
 *  - `db.manyToMany('Tag')` makes the context synthesize the join entity
 *    `PostTag` (auto PK, belongsTo both sides, unique (post_id, tag_id)) so it
 *    is part of the model (migrations / snapshot) like a user-written one.
 *  - Insert: `post.tags = [tagEntity, tagId, { label: 'new' }]` inserts new
 *    targets first, then one join row per element (EF cascade insert).
 *  - Load: `await post.tags` / `entry(post).collection('tags').load()` goes
 *    join -> targets; the collection has EF's add()/remove() that track join
 *    rows for saveChanges(); the reverse navigation works too.
 *  - Duplicate links violate the unique index (EF throws as well).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import schemaCls from '../Migrations/schema.js';
import Migration from '../Migrations/migrations.js';

process.env.master = 'development';

class Post { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } tags(db) { db.manyToMany('Tag'); } }
class Tag  { id(db) { db.integer().primary().auto(); } label(db) { db.string(); } posts(db) { db.manyToMany('Post'); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-m2m-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-m2m-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        M2mCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class M2mCtx extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Post); this.dbset(Tag); }
    }
    return { M2mCtx, ctx: new M2mCtx() };
}
const entityDef = (ctx, name) => ctx.__entities.find(e => e && e.__name === name);

async function createAll(M2mCtx, ctx) {
    const sch = new schemaCls(M2mCtx); await sch._ensureReady();
    for (const n of ['Post', 'Tag', 'PostTag']) await sch.createTable(entityDef(ctx, n));
    if (typeof sch.finalize === 'function') await sch.finalize();
    return sch;
}

test('the implicit join entity is synthesized once (declared on both sides) and is part of the model', () => {
    const { ctx } = makeCtx();
    const join = entityDef(ctx, 'PostTag');
    assert.ok(join, 'PostTag synthesized');
    assert.equal(ctx.__entities.filter(e => e && e.__name === 'PostTag').length, 1, 'declared on both sides -> one join entity');
    assert.equal(join.post.relationshipType, 'belongsTo'); assert.equal(join.post.foreignKey, 'post_id'); assert.equal(join.post.foreignTable, 'Post');
    assert.equal(join.tag.relationshipType, 'belongsTo');  assert.equal(join.tag.foreignKey, 'tag_id');   assert.equal(join.tag.foreignTable, 'Tag');
    assert.equal(join.id.primary, true);
    assert.deepEqual(join.__compositeIndexes.map(i => [i.columns.join(','), i.unique]), [['post_id,tag_id', true]]);
    assert.ok(ctx.PostTag && typeof ctx.PostTag.toList === 'function', 'ctx.PostTag dbset exists');
    // migrations see it like any user entity
    const clean = new Migration().cleanEntities(ctx.__entities);
    assert.ok(clean.some(e => e.__name === 'PostTag'));
    // the navigation carries the EF skip-navigation metadata
    const nav = entityDef(ctx, 'Post').tags;
    assert.equal(nav.type, 'hasManyThrough'); assert.equal(nav.implicitJoin, true); assert.equal(nav.foreignTable, 'PostTag'); assert.equal(nav.targetTable, 'Tag');
});

test('insert with targets (entity / id / new object), load both ways, collection add()/remove(), duplicate link rejected', async () => {
    const { M2mCtx, ctx } = makeCtx();
    await createAll(M2mCtx, ctx);
    const db = ctx._SQLEngine.db;

    const t1 = new Tag(); t1.label = 'a'; const t2 = new Tag(); t2.label = 'b';
    ctx.Tag.add(t1); ctx.Tag.add(t2); await ctx.saveChanges();
    assert.ok(t1.id && t2.id);

    // Insert a post linked to: a persisted entity, an id, and a brand-new tag.
    const p = new Post(); p.title = 'hello'; p.tags = [t1, t2.id, { label: 'c' }];
    ctx.Post.add(p); await ctx.saveChanges();
    const links = db.prepare(`SELECT post_id, tag_id FROM PostTag ORDER BY tag_id`).all();
    assert.equal(links.length, 3, 'three join rows');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Tag`).get().n, 3, 'the new tag was inserted first');
    assert.ok(links.every(l => l.post_id === p.id));

    // Load: lazy / explicit, and the reverse side.
    const post = await ctx.Post.where('x => x.title == $$', 'hello').single();
    const tags = await post.tags;
    assert.deepEqual(tags.map(t => t.label).sort(), ['a', 'b', 'c']);
    assert.equal(typeof tags.add, 'function'); assert.equal(typeof tags.remove, 'function');
    assert.equal(JSON.stringify(tags).includes('"add"'), false, 'add/remove are non-enumerable');
    const tagA = await ctx.Tag.where('x => x.label == $$', 'a').single();
    const postsOfA = await ctx.entry(tagA).collection('posts').load();
    assert.deepEqual(postsOfA.map(x => x.title), ['hello'], 'reverse navigation through the same join');

    // add(): persisted tag and a new one; remove(): join row deleted, tag kept.
    const t4 = new Tag(); t4.label = 'd'; ctx.Tag.add(t4); await ctx.saveChanges();
    tags.add(t4);
    tags.add({ label: 'e' });                       // new target: inserted first (EF cascade insert)
    await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM PostTag WHERE post_id = ?`).get(post.id).n, 5);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Tag`).get().n, 5);
    await tags.remove(tagA);
    await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM PostTag WHERE post_id = ?`).get(post.id).n, 4);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Tag WHERE label = 'a'`).get().n, 1, 'removing a link never deletes the target');
    assert.deepEqual((await ctx.loadNavigation(post, 'tags')).map(t => t.label).sort(), ['b', 'c', 'd', 'e']);

    // Duplicate link -> unique index violation at save (EF throws too).
    ctx.entry(post).collection('tags').add(t4);
    await assert.rejects(() => ctx.saveChanges(), /UNIQUE constraint failed/);
    ctx.clearChangeTracker();

    // Deleting a post cascades its join rows (FK ON DELETE CASCADE), not the tags.
    const p2 = await ctx.Post.where('x => x.title == $$', 'hello').single();
    ctx.Post.remove(p2); await ctx.saveChanges();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM PostTag`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM Tag`).get().n, 5);
});

test('hasMany collections get add()/remove() too (EF Collection.Add sets the FK; Remove nulls it when nullable)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-m2m-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-m2m-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        OmCtx: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class Author { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } books(db) { db.hasMany('Book'); } }
    class Book   { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } author(db) { db.belongsTo('Author').nullable(); } }
    class OmCtx extends masterrecord.context { constructor() { super(); this.env(envDir); this.dbset(Author); this.dbset(Book); } }
    const ctx = new OmCtx();
    const sch = new schemaCls(OmCtx); await sch._ensureReady();
    for (const n of ['Author', 'Book']) await sch.createTable(entityDef(ctx, n));
    const a = new Author(); a.name = 'A'; ctx.Author.add(a); await ctx.saveChanges();
    const author = await ctx.Author.where('x => x.name == $$', 'A').single();
    const books = await author.books;
    assert.deepEqual(books, []);
    books.add({ title: 'new book' });                // new child: FK set + inserted
    const existing = new Book(); existing.title = 'old'; ctx.Book.add(existing); await ctx.saveChanges();
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT author_id FROM Book WHERE title = 'new book'`).get().author_id, author.id);
    const old = await ctx.Book.where('x => x.title == $$', 'old').single();
    books.add(old); await ctx.saveChanges();
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT author_id FROM Book WHERE title = 'old'`).get().author_id, author.id);
    await books.remove(old); await ctx.saveChanges();
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT author_id FROM Book WHERE title = 'old'`).get().author_id, null, 'nullable FK -> NULL (child kept)');
});
