/**
 * Building a context stays linear in its tables, and registration order does not change the model.
 *
 * dbset() used to walk every registered entity on every call. An application builds a context per
 * request and per background job, so that quadratic walk was its largest idle cost (see CHANGES v1.32.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import masterrecord from '../MasterRecord.js';

process.env.master = 'development';

const entity = (name) => ({ [name]: class { id(db) { db.integer().primary().auto(); } } })[name];
const withField = (cls, field, fn) => { Object.defineProperty(cls.prototype, field, { value: fn, writable: true, configurable: true }); return cls; };

function contextWith(register) {
    class Ctx extends masterrecord.context { constructor() { super(); register(this); } }
    return new Ctx();
}
const defOf = (ctx, name) => ctx.__entities.find((e) => e.__name === name);

class Account { id(db) { db.string().primary(); } name(db) { db.string(); } }
class Invoice { id(db) { db.integer().primary().auto(); } Account(db) { db.belongsTo('Account', 'account_id'); } }
class Comment { id(db) { db.string().primary(); } Parent(db) { db.belongsTo('Comment', 'parent_id'); } }

test('a foreign key takes its parent\'s key type, parent registered first', () => {
    const ctx = contextWith((c) => { c.dbset(Account); c.dbset(Invoice); });
    assert.equal(defOf(ctx, 'Invoice').Account.type, 'string');
});

test('a foreign key takes its parent\'s key type, parent registered later', () => {
    const ctx = contextWith((c) => { c.dbset(Invoice); assert.equal(defOf(c, 'Invoice').Account.type, 'integer'); c.dbset(Account); });
    assert.equal(defOf(ctx, 'Invoice').Account.type, 'string');
});

test('a foreign key finds its parent whatever the case of the name', () => {
    class Lower { id(db) { db.integer().primary().auto(); } Account(db) { db.belongsTo('account', 'account_id'); } }
    const ctx = contextWith((c) => { c.dbset(Lower); c.dbset(Account); });
    assert.equal(defOf(ctx, 'Lower').Account.type, 'string');
});

test('a self-reference takes the entity\'s own key type', () => {
    const ctx = contextWith((c) => { c.dbset(Comment); });
    assert.equal(defOf(ctx, 'Comment').Parent.type, 'string');
});

test('a foreign key with no registered parent keeps the default', () => {
    const ctx = contextWith((c) => { c.dbset(Invoice); });
    assert.equal(defOf(ctx, 'Invoice').Account.type, 'integer');
});

test('registering an entity again resolves against the new definition', () => {
    class Account2 { id(db) { db.integer().primary().auto(); } }
    const ctx = contextWith((c) => { c.dbset(Invoice); c.dbset(Account); c.dbset(Account2, 'Account'); });
    assert.equal(defOf(ctx, 'Invoice').Account.type, 'integer');
});

test('a many-to-many gets one join entity, declared on one side or both, in either order', () => {
    class Post { id(db) { db.integer().primary().auto(); } tags(db) { db.manyToMany('Tag'); } }
    class Tag { id(db) { db.integer().primary().auto(); } posts(db) { db.manyToMany('Post'); } }
    for (const order of [[Post, Tag], [Tag, Post]]) {
        const ctx = contextWith((c) => { for (const m of order) c.dbset(m); });
        assert.deepEqual(ctx.__entities.map((e) => e.__name).filter((n) => n === 'PostTag'), ['PostTag']);
        assert.equal(defOf(ctx, 'PostTag').__implicitJoin, true);
    }
});

test('a derived type\'s many-to-many gets its join entity without another dbset', () => {
    class Item { id(db) { db.integer().primary().auto(); } }
    class Book extends Item { labels(db) { db.manyToMany('Label'); } }
    class Label { id(db) { db.integer().primary().auto(); } }
    const ctx = contextWith((c) => { c.dbset(Label); c.dbset(Item); c.dbset(Book, { extends: 'Item' }); });
    assert.ok(ctx.__entities.some((e) => /Label/.test(e.__name) && e.__implicitJoin), 'join entity exists');
});

test('the work of building a context grows linearly with its tables', () => {
    const models = (n) => Array.from({ length: n }, (_, i) => withField(entity(`T${i}`), 'parent', (db) => db.belongsTo(`T${(i + 1) % n}`, 'parent_id')));
    const calls = (list) => {
        const keys = Object.keys; let count = 0;
        Object.keys = function (o) { count++; return keys(o); };
        try { contextWith((c) => { for (const m of list) c.dbset(m); }); } finally { Object.keys = keys; }
        return count;
    };
    const small = calls(models(100)), large = calls(models(400));
    assert.ok(large < small * 6, `4 times the tables took ${(large / small).toFixed(1)} times the walks (${small} → ${large})`);
});
