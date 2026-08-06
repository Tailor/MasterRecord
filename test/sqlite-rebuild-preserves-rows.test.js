/**
 * A SQLite rebuild must never cost the table its contents.
 *
 * masterrecord turns a NOT NULL change into rename -> create -> copy -> drop.
 * Rows written before the column was required hold NULL, the copy used to fail
 * the constraint, and the table was left empty with the original renamed to
 * _temp_alter_column_update. That emptied User, Space and six feed tables in a
 * real database.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-rebuild-')), 'test.sqlite');

// The COALESCE the rebuild builds for a NOT NULL column, mirrored here so the
// behaviour is pinned without standing up a whole context.
const selectFor = (col) => {
    if (col.nullable !== false) return col.name;
    let fallback = col.default;
    if (fallback == null) {
        const t = String(col.type || '').toLowerCase();
        fallback = (t === 'integer' || t === 'float' || t === 'decimal' || t === 'boolean') ? 0 : "''";
    } else if (typeof fallback === 'string') {
        fallback = `'${fallback.replace(/'/g, "''")}'`;
    }
    return `COALESCE(${col.name}, ${fallback})`;
};

test('rows whose value predates a NOT NULL column survive the rebuild', () => {
    const db = new Database(tmp());
    db.exec('CREATE TABLE Space (id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT)');
    db.exec("INSERT INTO Space (id, organization_id, name) VALUES (1, 10, 'TikTok'), (2, NULL, 'gugh'), (3, NULL, 'fgfd')");

    const cols = [
        { name: 'id', type: 'integer', nullable: true },
        { name: 'organization_id', type: 'integer', nullable: false },
        { name: 'name', type: 'string', nullable: false },
    ];
    db.exec('ALTER TABLE Space RENAME TO _temp_alter_column_update');
    db.exec('CREATE TABLE Space (id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, name TEXT NOT NULL)');
    const names = cols.map(c => c.name).join(',');
    const selects = cols.map(selectFor).join(',');
    db.exec(`INSERT INTO Space (${names}) SELECT ${selects} FROM _temp_alter_column_update`);
    db.exec('DROP TABLE _temp_alter_column_update');

    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM Space').get().c, 3, 'no row may be dropped');
    assert.strictEqual(db.prepare('SELECT organization_id FROM Space WHERE id = 2').get().organization_id, 0,
        'a row that never had the value takes the sentinel, not deletion');
    assert.strictEqual(db.prepare('SELECT organization_id FROM Space WHERE id = 1').get().organization_id, 10,
        'a row that had a value keeps it');
});

test('a text column without a default takes an empty string, not null', () => {
    const db = new Database(tmp());
    db.exec('CREATE TABLE T (id INTEGER PRIMARY KEY, label TEXT)');
    db.exec('INSERT INTO T (id, label) VALUES (1, NULL)');
    const col = { name: 'label', type: 'string', nullable: false };
    db.exec('ALTER TABLE T RENAME TO _temp_alter_column_update');
    db.exec('CREATE TABLE T (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    db.exec(`INSERT INTO T (id,label) SELECT id,${selectFor(col)} FROM _temp_alter_column_update`);
    assert.strictEqual(db.prepare('SELECT label FROM T WHERE id = 1').get().label, '');
});

test("a column's declared default wins over the typed zero", () => {
    const col = { name: 'status', type: 'string', nullable: false, default: 'active' };
    assert.strictEqual(selectFor(col), "COALESCE(status, 'active')");
});

test('rebuilding a parent does not cascade its children away', () => {
    const db = new Database(tmp());
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE Post (id INTEGER PRIMARY KEY, header TEXT)');
    db.exec('CREATE TABLE Kudos (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, FOREIGN KEY (post_id) REFERENCES Post(id) ON DELETE CASCADE)');
    db.exec("INSERT INTO Post (id, header) VALUES (1, 'hi')");
    db.exec('INSERT INTO Kudos (id, post_id) VALUES (1, 1)');

    // The rebuild recipe: foreign keys off, rename, create, copy, drop.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('ALTER TABLE Post RENAME TO _temp_alter_column_update');
    db.exec('CREATE TABLE Post (id INTEGER PRIMARY KEY, header TEXT NOT NULL)');
    db.exec("INSERT INTO Post (id,header) SELECT id, COALESCE(header,'') FROM _temp_alter_column_update");
    db.exec('DROP TABLE _temp_alter_column_update');
    db.exec('PRAGMA foreign_keys = ON');

    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM Post').get().c, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM Kudos').get().c, 1,
        'the child keeps its rows — dropping the renamed parent must not cascade');
});

test('leaving foreign keys on during the rebuild is what destroyed the children', () => {
    const db = new Database(tmp());
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE Post (id INTEGER PRIMARY KEY, header TEXT)');
    db.exec('CREATE TABLE Kudos (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, FOREIGN KEY (post_id) REFERENCES Post(id) ON DELETE CASCADE)');
    db.exec("INSERT INTO Post (id, header) VALUES (1, 'hi')");
    db.exec('INSERT INTO Kudos (id, post_id) VALUES (1, 1)');

    db.exec('ALTER TABLE Post RENAME TO _temp_alter_column_update');
    db.exec('CREATE TABLE Post (id INTEGER PRIMARY KEY, header TEXT NOT NULL)');
    db.exec("INSERT INTO Post (id,header) SELECT id, COALESCE(header,'') FROM _temp_alter_column_update");
    db.exec('DROP TABLE _temp_alter_column_update');

    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM Kudos').get().c, 0,
        'documents the old behaviour this fix exists to prevent');
});
