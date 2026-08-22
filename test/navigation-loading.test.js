/**
 * Navigation loading — EF explicit loading (Entry(e).Reference/Collection.Load())
 * and lazy loading adapted to async JS drivers.
 *
 *  - A navigation already loaded (include() or a previous load) is returned
 *    synchronously.
 *  - With lazy loading on (default), an unloaded navigation returns a Promise
 *    that loads it once via context.loadNavigation() — engine-agnostic,
 *    parameterized (the old getter interpolated the key VALUE into a
 *    SQLite-shaped lambda) — and caches the result: `await post.author`.
 *  - lazyLoadingOff(): unloaded navigation reads null; load explicitly with
 *    entry(e).load('nav') / ctx.loadNavigation(e, 'nav').
 *  - Relationship fix-up: `post.author = anAuthor` sets post.author_id (EF).
 *  - belongsTo / hasOne / hasMany / hasManyThrough all covered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

class Author { id(db) { db.string().primary(); } name(db) { db.string(); } posts(db) { db.hasMany('Post'); } profile(db) { db.hasOne('Profile'); } tags(db) { db.hasManyThrough('AuthorTag'); } }
class Post   { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } author(db) { db.belongsTo('Author'); } }
class Profile{ id(db) { db.integer().primary().auto(); } bio(db) { db.string(); } author(db) { db.belongsTo('Author'); } }
class Tag    { id(db) { db.integer().primary().auto(); } label(db) { db.string(); } }
class AuthorTag { id(db) { db.integer().primary().auto(); } author(db) { db.belongsTo('Author'); } tag(db) { db.belongsTo('Tag'); } }
class Lazy   { id(db) { db.integer().primary().auto(); } author(db) { db.belongsTo('Author').lazyLoadingOff(); } }

function makeCtx() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-nav-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-nav-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Author); this.dbset(Post); this.dbset(Profile); this.dbset(Tag); this.dbset(AuthorTag); this.dbset(Lazy); }
    }
    return new testContext();
}
async function seed(ctx) {
    await ctx._ensureReady();
    ctx._execute(`CREATE TABLE "Author" ("id" TEXT PRIMARY KEY, "name" TEXT)`);
    ctx._execute(`CREATE TABLE "Post" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "title" TEXT, "author_id" TEXT)`);
    ctx._execute(`CREATE TABLE "Profile" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "bio" TEXT, "author_id" TEXT)`);
    ctx._execute(`CREATE TABLE "Tag" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT)`);
    ctx._execute(`CREATE TABLE "AuthorTag" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" TEXT, "tag_id" INTEGER)`);
    ctx._execute(`CREATE TABLE "Lazy" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "author_id" TEXT)`);
    // A string PK with a quote character proves the key is parameterized, not interpolated.
    ctx._execute(`INSERT INTO "Author" VALUES ('o''neil', 'O''Neil'), ('bob', 'Bob')`);
    ctx._execute(`INSERT INTO "Post" ("title","author_id") VALUES ('p1','o''neil'),('p2','o''neil'),('p3','bob')`);
    ctx._execute(`INSERT INTO "Profile" ("bio","author_id") VALUES ('writer','o''neil')`);
    ctx._execute(`INSERT INTO "Tag" ("label") VALUES ('a'),('b'),('c')`);
    ctx._execute(`INSERT INTO "AuthorTag" ("author_id","tag_id") VALUES ('o''neil',1),('o''neil',3)`);
    ctx._execute(`INSERT INTO "Lazy" ("author_id") VALUES ('bob')`);
}

test('belongsTo: lazy `await post.author` loads via a parameterized query and caches; fix-up on assignment', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const post = await ctx.Post.where('p => p.title == $$', 'p1').single();
    const pending = post.author;
    assert.ok(pending && typeof pending.then === 'function', 'unloaded navigation yields a Promise (async drivers)');
    const author = await pending;
    assert.equal(author.name, "O'Neil", 'loaded the right parent (string PK with a quote — parameterized)');
    assert.equal(post.author, author, 'subsequent access is synchronous and cached');
    assert.equal(ctx.isNavigationLoaded(post, 'author'), true);

    // Relationship fix-up: assigning an entity sets the FK and persists.
    const bob = await ctx.Author.where('a => a.id == $$', 'bob').single();
    post.author = bob;
    assert.equal(post.author_id, 'bob', 'FK column updated by fix-up');
    await ctx.saveChanges();
    const row = ctx._SQLEngine.db.prepare(`SELECT author_id FROM Post WHERE title = 'p1'`).get();
    assert.equal(row.author_id, 'bob');
});

test('hasMany / hasOne / hasManyThrough load explicitly via entry().load() and lazily via await', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const a = await ctx.Author.where('a => a.id == $$', "o'neil").single();

    const posts = await ctx.entry(a).load('posts');
    assert.deepEqual(posts.map(p => p.title).sort(), ['p1', 'p2'], 'hasMany explicit load');
    assert.equal(ctx.entry(a).isLoaded('posts'), true);
    assert.equal(a.posts, posts, 'loaded collection is returned synchronously afterwards');

    const profile = await a.profile;                               // lazy hasOne
    assert.equal(profile.bio, 'writer');

    const tags = await a.tags;                                     // lazy hasManyThrough (join table -> targets)
    assert.deepEqual(tags.map(t => t.label).sort(), ['a', 'c']);

    const bob = await ctx.Author.where('a => a.id == $$', 'bob').single();
    assert.deepEqual(await ctx.loadNavigation(bob, 'tags'), [], 'no links -> empty array');
});

test('lazyLoadingOff(): unloaded navigation reads null until loaded explicitly; errors are thrown, not returned as strings', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const l = (await ctx.Lazy.toList())[0];
    assert.equal(l.author, null, 'not loaded and lazy loading off -> null (EF)');
    const loaded = await ctx.entry(l).load('author');
    assert.equal(loaded.name, 'Bob');
    assert.equal(l.author, loaded, 'explicitly loaded value is now returned');
    await assert.rejects(() => ctx.loadNavigation(l, 'nope'), /is not a navigation/);
    await assert.rejects(() => ctx.loadNavigation(l, 'id'), /is a column, not a navigation/);
});

test('engines persist the FK VALUE, never the navigation: FK column change invalidates a loaded parent; inserts accept entity / id / FK column', async () => {
    const ctx = makeCtx(); await seed(ctx);
    const post = await ctx.Post.where('p => p.title == $$', 'p1').single();
    const oneil = await post.author;                      // load the parent
    assert.equal(oneil.name, "O'Neil");
    post.author_id = 'bob';                               // change via the FK column
    assert.equal(ctx.isNavigationLoaded(post, 'author'), false, 'stale parent invalidated');
    await ctx.saveChanges();                              // must emit author_id = 'bob', not the Author object
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT author_id FROM Post WHERE title = 'p1'`).get().author_id, 'bob');
    assert.equal((await post.author).name, 'Bob', 'lazy read re-resolves the new parent');

    // Legacy idiom on a tracked entity: assign the id to the navigation.
    post.author = "o'neil";
    await ctx.saveChanges();
    assert.equal(ctx._SQLEngine.db.prepare(`SELECT author_id FROM Post WHERE title = 'p1'`).get().author_id, "o'neil");

    // Inserts: entity object, id on the navigation, and the FK column — on plain and .new() objects.
    const bob = await ctx.Author.where('a => a.id == $$', 'bob').single();
    const a = new Post(); a.title = 'i1'; a.author = bob;  ctx.Post.add(a);
    const b = new Post(); b.title = 'i2'; b.author = 'bob'; ctx.Post.add(b);
    const c = new Post(); c.title = 'i3'; c.author_id = 'bob'; ctx.Post.add(c);
    const d = ctx.Post.new(); d.title = 'i4'; d.author = bob;
    await ctx.saveChanges();
    const rows = ctx._SQLEngine.db.prepare(`SELECT title, author_id FROM Post WHERE title LIKE 'i%' ORDER BY title`).all();
    assert.deepEqual(rows, [
        { title: 'i1', author_id: 'bob' }, { title: 'i2', author_id: 'bob' },
        { title: 'i3', author_id: 'bob' }, { title: 'i4', author_id: 'bob' },
    ]);
});
