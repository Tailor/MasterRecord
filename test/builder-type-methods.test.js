/**
 * Convenience builder type methods (date/datetime/timestamp/float/decimal/
 * bigint/json/uuid/binary).
 *
 * These columns were already supported by every engine's DDL mapper, but the
 * entity builder only exposed string/text/integer/time/boolean. This test pins
 * the new convenience methods: each must register the expected `type`, and each
 * must resolve to a valid SQL column type on all three engines (no `undefined`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EntityModelBuilder from '../Entity/entityModelBuilder.js';
import SQLiteQuery from '../Migrations/migrationSQLiteQuery.js';
import MySQLQuery from '../Migrations/migrationMySQLQuery.js';
import PostgresQuery from '../Migrations/migrationPostgresQuery.js';

class Sample {
  id(db) { db.integer().primary().auto(); }
  when(db) { db.datetime(); }
  day(db) { db.date(); }
  at(db) { db.timestamp(); }
  price(db) { db.float(); }
  qty(db) { db.decimal(); }
  big(db) { db.bigint(); }
  meta(db) { db.json(); }
  ref(db) { db.uuid(); }
  blob(db) { db.binary(); }
}

test('builder registers the new convenience types', () => {
  const obj = EntityModelBuilder.create(Sample);
  assert.equal(obj.when.type, 'datetime');
  assert.equal(obj.day.type, 'date');
  assert.equal(obj.at.type, 'timestamp');
  assert.equal(obj.price.type, 'float');
  assert.equal(obj.qty.type, 'decimal');
  assert.equal(obj.big.type, 'bigint');
  assert.equal(obj.meta.type, 'json');
  assert.equal(obj.ref.type, 'uuid');
  assert.equal(obj.blob.type, 'binary');
  // Chaining with modifiers still works.
  assert.equal(obj.id.primary, true);
  assert.equal(obj.id.auto, true);
});

test('every new type resolves to a real SQL column type on all engines', () => {
  const types = ['date', 'datetime', 'timestamp', 'float', 'decimal', 'bigint', 'json', 'uuid', 'binary'];
  // SQLite exposes resolveColumnType(); MySQL/Postgres expose typeManager().
  const engines = [
    ['sqlite', new SQLiteQuery(), (q, t) => q.resolveColumnType(t)],
    ['mysql', new MySQLQuery(), (q, t) => q.typeManager(t)],
    ['postgres', new PostgresQuery(), (q, t) => q.typeManager(t)],
  ];
  for (const t of types) {
    for (const [name, q, resolve] of engines) {
      const resolved = resolve(q, t);
      assert.ok(
        typeof resolved === 'string' && resolved.length > 0 && !/undefined/i.test(resolved),
        `${name} type('${t}') should be a real SQL type, got: ${resolved}`,
      );
    }
  }
});
