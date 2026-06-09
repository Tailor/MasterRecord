/**
 * Inline configuration object support for context.env().
 *
 * Bug: env() was documented (JSDoc @example + README) to accept an inline config
 * object — `this.env({ type: 'sqlite', connection: './db/' })` — but it always
 * treated its argument as a folder path and threw
 * `The "path" argument must be of type string` for objects.
 *
 * Fix: env() now branches — an object is used directly as the config; a string is
 * still resolved to env.<NODE_ENV>.json (keyed by context name).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import context from '../context.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

class Widget {
  id(db) { db.integer().primary().auto(); }
  name(db) { db.string(); }
}

test('env() accepts an inline SQLite config object and initializes the engine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-inline-'));
  class InlineCtx extends context {
    constructor() {
      super();
      this.env({ type: 'better-sqlite3', connection: dir + path.sep });
      this.dbset(Widget);
    }
  }
  const db = new InlineCtx();
  assert.equal(db.isSQLite, true);
  assert.equal(db.isMySQL, false);
  assert.equal(db.isPostgres, false);
});

test('env() flags the engine type from an inline config without a live connection', () => {
  // Schema-only mode mirrors how the migration CLI loads a context.
  process.env.MASTERRECORD_SCHEMA_ONLY = '1';
  try {
    class PgCtx extends context {
      constructor() {
        super();
        this.env({ type: 'postgres', host: 'localhost', database: 'x', user: 'u', password: 'p' });
        this.dbset(Widget);
      }
    }
    const db = new PgCtx();
    assert.equal(db.isPostgres, true);
  } finally {
    delete process.env.MASTERRECORD_SCHEMA_ONLY;
  }
});
