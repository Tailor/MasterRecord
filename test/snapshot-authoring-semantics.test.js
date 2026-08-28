/**
 * The snapshot belongs to AUTHORING, exactly as in EF Core.
 *
 * `dotnet ef migrations add` regenerates ModelSnapshot; `dotnet ef database update` never
 * touches it. That is what makes each migration a delta between *authored* states, so a
 * fresh database can replay them in order.
 *
 * masterrecord used to do the opposite — the snapshot was written by update-database and
 * friends, so it recorded *applied database state*. Anything that created schema outside
 * migrations got baked into the snapshot, and the next add-migration silently generated a
 * migration assuming schema no migration creates. Those migrations then failed on a fresh
 * database while working in the environment they were authored in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'Migrations', 'cli.js');

function project(entitySrc) {
    const dir = fs.mkdtempSync(path.join(root, 'test', 'fixtures', 'snap-sem-'));
    for (const d of ['app/models', 'config/environments', 'db', 'node_modules']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.symlinkSync(root, path.join(dir, 'node_modules', 'masterrecord'), 'dir');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'snap-sem', type: 'module' }));
    fs.writeFileSync(path.join(dir, 'app/models/W.js'), entitySrc);
    fs.writeFileSync(path.join(dir, 'app/models/wc.js'), `
import masterrecord from 'masterrecord';
import W from './W.js';
class wc extends masterrecord.context { constructor(){ super(); this.env('./config/environments'); this.dbset(W); } }
export default wc;
`);
    fs.writeFileSync(path.join(dir, 'config/environments/env.development.json'),
        JSON.stringify({ wc: { type: 'better-sqlite3', connection: 'db/' } }));
    return dir;
}
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8' });
const snapPath = (dir) => path.join(dir, 'app/models/db/migrations/wc_contextSnapShot.json');
const columns = (dir) => { const db = new Database(path.join(dir, 'db/wc.sqlite')); const r = db.prepare('PRAGMA table_info(W)').all().map(c => c.name); db.close(); return r; };

const ONE = `export default class W { id(db){db.integer().primary().auto();} name(db){db.string();} }\n`;
const TWO = `export default class W { id(db){db.integer().primary().auto();} name(db){db.string();} sku(db){db.string();} }\n`;

test('add-migration advances the snapshot; applying never rewrites it', () => {
    const dir = project(ONE);
    run(['enable-migrations', 'wc'], dir);

    const empty = JSON.parse(fs.readFileSync(snapPath(dir), 'utf8'));
    assert.equal(empty.schema.length, 0, 'enable-migrations starts from an empty model, as EF does');

    assert.equal(run(['add-migration', 'Init', 'wc'], dir).status, 0);
    const authored = JSON.parse(fs.readFileSync(snapPath(dir), 'utf8'));
    assert.equal(authored.schema.length, 1, 'the snapshot advanced at AUTHORING time');
    assert.match(authored.latestMigration, /_Init_migration\.js$/);

    // a second add-migration with no model change must produce nothing — proof the
    // snapshot moved. Before, it re-emitted the same migration.
    const again = run(['add-migration', 'Again', 'wc'], dir);
    assert.match(again.stdout, /No changes detected/i, 'no duplicate migration');

    const before = fs.readFileSync(snapPath(dir), 'utf8');
    assert.equal(run(['update-database', 'wc'], dir).status, 0);
    assert.equal(fs.readFileSync(snapPath(dir), 'utf8'), before, 'update-database must NOT rewrite the snapshot');
    assert.deepEqual(columns(dir).sort(), ['id', 'name']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('migrations replay from scratch on an empty database (the property EF guarantees)', () => {
    const dir = project(ONE);
    run(['enable-migrations', 'wc'], dir);
    run(['add-migration', 'Init', 'wc'], dir);
    run(['update-database', 'wc'], dir);

    fs.writeFileSync(path.join(dir, 'app/models/W.js'), TWO);
    assert.equal(run(['add-migration', 'AddSku', 'wc'], dir).status, 0);
    run(['update-database', 'wc'], dir);
    assert.deepEqual(columns(dir).sort(), ['id', 'name', 'sku']);

    // throw the database away and replay every migration from nothing
    fs.rmSync(path.join(dir, 'db/wc.sqlite'), { force: true });
    const replay = run(['update-database', 'wc'], dir);
    assert.equal(replay.status, 0, `fresh replay failed: ${replay.stderr}\n${replay.stdout}`);
    assert.deepEqual(columns(dir).sort(), ['id', 'name', 'sku'], 'a fresh database reaches the same schema');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('alterColumn is self-contained: definitions inline, down reverts to the old type', () => {
    const dir = project(ONE);
    run(['enable-migrations', 'wc'], dir);
    run(['add-migration', 'Init', 'wc'], dir);
    run(['update-database', 'wc'], dir);

    fs.writeFileSync(path.join(dir, 'app/models/W.js'),
        `export default class W { id(db){db.integer().primary().auto();} name(db){db.text();} }\n`);
    run(['add-migration', 'Widen', 'wc'], dir);

    const migDir = path.join(dir, 'app/models/db/migrations');
    const body = fs.readFileSync(path.join(migDir, fs.readdirSync(migDir).find(f => /_Widen_/.test(f))), 'utf8');
    assert.ok(!/alterColumn\(table\./.test(body), 'no runtime table.X lookup — the definition is inline');
    assert.match(body, /alterColumn\(\{[^)]*"type":"text"/, 'up applies the new type');
    assert.match(body, /alterColumn\(\{[^)]*"type":"string"/, 'down restores the old type');
    fs.rmSync(dir, { recursive: true, force: true });
});
