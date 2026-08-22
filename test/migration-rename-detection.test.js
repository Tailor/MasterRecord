/**
 * Possible-rename advisories in generated migrations (EF Core parity).
 *
 * EF Core's differ does NOT auto-detect column renames: it scaffolds
 * DropColumn + AddColumn and tells you to review and change it to RenameColumn,
 * because it cannot know whether `title` became `headline` or an unrelated
 * column was added — guessing wrong would move data under the wrong name.
 * MasterRecord matches EF: drop + add is still emitted, but when exactly one
 * deleted and one new column share an identical definition the generated
 * migration carries an ADVISORY comment with the exact renameColumn(...) call
 * to use instead (and add-migration prints a warning). Ambiguous cases get no
 * advisory. schema.renameColumn / renameTable exist for the hand edit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Migrations from '../Migrations/migrations.js';

process.env.master = 'rename-detect';
process.env.MR_SILENT_MIGRATIONS = 'true';   // keep the advisory console.warn quiet in tests

const col = (name, extra = {}) => ({ name, type: 'string', nullable: true, ...extra });
const pk = { type: 'integer', primary: true, auto: true, nullable: false, unique: true };
const table = (name, cols) => { const t = { __name: name, __compositeIndexes: [] }; for (const [k, v] of Object.entries(cols)) t[k] = { ...v, name: k }; return t; };

test('a single unambiguous candidate gets an advisory — drop+add is still emitted (EF behavior), never auto-renamed', () => {
    const oldSchema = [table('Post', { id: pk, title: col('title') })];
    const newSchema = [table('Post', { id: pk, headline: col('headline') })];

    const m = new Migrations();
    assert.equal(m.hasChanges(oldSchema, newSchema), true);
    const src = m.template('RenameTitle', oldSchema, newSchema);

    // Advisory with the exact call to use:
    assert.match(src, /POSSIBLE RENAME: 'title' -> 'headline' on Post/);
    assert.match(src, /\/\/\s+await this\.renameColumn\(\{"tableName":"Post","name":"title","newName":"headline"\}\)/, 'advisory shows the renameColumn call (as a comment)');
    // EF parity: the real statements are still drop + add (reviewable), not an applied rename.
    assert.match(src, /dropColumn\(\{[^}]*"name":"title"/, 'dropColumn still emitted');
    assert.match(src, /addColumn\(\{[^}]*"name":"headline"/, 'addColumn still emitted');
    assert.doesNotMatch(src, /^\s*await this\.renameColumn\(/m, 'no live (uncommented) renameColumn is applied automatically');
});

test('ambiguous candidates (two columns with the same signature) get no advisory', () => {
    const oldSchema = [table('T', { id: pk, a: col('a'), b: col('b') })];
    const newSchema = [table('T', { id: pk, c: col('c'), d: col('d') })];
    const src = new Migrations().template('Ambiguous', oldSchema, newSchema);
    assert.doesNotMatch(src, /POSSIBLE RENAME/, 'no guess when the pairing is ambiguous');
    assert.match(src, /dropColumn\(\{[^}]*"name":"a"/);
    assert.match(src, /addColumn\(\{[^}]*"name":"c"/);
});

test('no advisory when the definition signature differs (a real drop + add)', () => {
    const oldSchema = [table('T', { id: pk, n: col('n') })];
    const newSchema = [table('T', { id: pk, m: { name: 'm', type: 'integer', nullable: true } })];
    const src = new Migrations().template('TypeChange', oldSchema, newSchema);
    assert.doesNotMatch(src, /POSSIBLE RENAME/);
    assert.match(src, /dropColumn\(\{[^}]*"name":"n"/);
    assert.match(src, /addColumn\(\{[^}]*"name":"m"/);
});
