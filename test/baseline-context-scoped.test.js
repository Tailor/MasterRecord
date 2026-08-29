/**
 * `baseline` is scoped to ONE context's migrations, as everything in EF is.
 *
 * EF resolves migrations by ownership — `IMigrationsAssembly.Migrations` holds only the
 * migrations whose `[DbContext(typeof(T))]` matches the context being operated on. There is
 * no filesystem search, so a migration belonging to another DbContext simply is not visible.
 *
 * masterrecord's `baseline --all` used to glob `**\/*_migration.js` from the working
 * directory instead, so in a repo with several contexts it recorded EVERY context's
 * migrations into the one target context's history table. A real app saw 141 history rows
 * for 8 real migrations, mixing in migrations owned by unrelated contexts.
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
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8' });

/** Two independent contexts in one repo, each with its own models + migrations folder. */
function twoContextProject() {
    const dir = fs.mkdtempSync(path.join(root, 'test', 'fixtures', 'baseline-scope-'));
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.symlinkSync(root, path.join(dir, 'node_modules', 'masterrecord'), 'dir');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'baseline-scope', type: 'module' }));
    fs.mkdirSync(path.join(dir, 'config/environments'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config/environments/env.development.json'), JSON.stringify({
        billing: { type: 'better-sqlite3', connection: 'db/' },
        townhall: { type: 'better-sqlite3', connection: 'db/' },
    }));
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });

    for (const [ctx, entity] of [['billing', 'Invoice'], ['townhall', 'Post']]) {
        const models = path.join(dir, 'app', ctx);
        fs.mkdirSync(models, { recursive: true });
        fs.writeFileSync(path.join(models, `${entity}.js`),
            `export default class ${entity} { id(db){db.integer().primary().auto();} name(db){db.string();} }\n`);
        fs.writeFileSync(path.join(models, `${ctx}.js`), `
import masterrecord from 'masterrecord';
import ${entity} from './${entity}.js';
class ${ctx} extends masterrecord.context { constructor(){ super(); this.env('./config/environments'); this.dbset(${entity}); } }
export default ${ctx};
`);
    }
    return dir;
}

const appliedIds = (dir, ctx) => {
    const file = path.join(dir, `db/${ctx}.sqlite`);
    if (!fs.existsSync(file)) return [];
    const db = new Database(file);
    // No history table means nothing was ever recorded — the same answer as an empty one.
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_masterrecord_migrations'`).get();
    const rows = exists ? db.prepare('SELECT * FROM _masterrecord_migrations').all() : [];
    db.close();
    return rows.map(r => r.migrationId ?? r.migration_id ?? Object.values(r)[0]);
};

test('baseline --all records only the named context\'s own migrations', () => {
    const dir = twoContextProject();
    for (const ctx of ['billing', 'townhall']) {
        assert.equal(run(['enable-migrations', ctx], dir).status, 0, `enable ${ctx}`);
        assert.equal(run(['add-migration', `Create${ctx}`, ctx], dir).status, 0, `add ${ctx}`);
    }

    const res = run(['baseline', 'billing', '--all'], dir);
    assert.equal(res.status, 0, `baseline failed: ${res.stderr}${res.stdout}`);

    const ids = appliedIds(dir, 'billing');
    assert.equal(ids.length, 1, `billing must record exactly its own 1 migration, got ${ids.length}: ${ids.join(', ')}`);
    assert.match(ids[0], /Createbilling/, 'the recorded migration is billing\'s own');
    assert.ok(!ids.some(id => /Createtownhall/.test(id)), 'townhall\'s migration must NOT appear in billing\'s history');

    // and the output never mentions the foreign migration
    assert.ok(!/Createtownhall/.test(res.stdout), 'foreign migration must not be baselined');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('baseline <name> refuses a migration the context does not own', () => {
    const dir = twoContextProject();
    for (const ctx of ['billing', 'townhall']) {
        run(['enable-migrations', ctx], dir);
        run(['add-migration', `Create${ctx}`, ctx], dir);
    }

    const res = run(['baseline', 'billing', 'Createtownhall'], dir);
    assert.notEqual(res.status, 0, 'baselining another context\'s migration must fail');
    assert.match(res.stderr + res.stdout, /no migration named/i);
    assert.equal(appliedIds(dir, 'billing').length, 0, 'nothing recorded on failure');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('baselined migrations are not re-run, and update-database then applies only the rest', () => {
    const dir = twoContextProject();
    run(['enable-migrations', 'billing'], dir);
    run(['add-migration', 'CreateBilling', 'billing'], dir);
    run(['update-database', 'billing'], dir);

    // a second migration, baselined by hand as though the schema were already there
    fs.writeFileSync(path.join(dir, 'app/billing/Invoice.js'),
        `export default class Invoice { id(db){db.integer().primary().auto();} name(db){db.string();} total(db){db.integer();} }\n`);
    run(['add-migration', 'AddTotal', 'billing'], dir);
    const db = new Database(path.join(dir, 'db/billing.sqlite'));
    db.prepare('ALTER TABLE Invoice ADD COLUMN total integer').run();  // applied out of band
    db.close();

    assert.equal(run(['baseline', 'billing', 'AddTotal'], dir).status, 0);
    assert.equal(appliedIds(dir, 'billing').length, 2, 'both migrations recorded');

    // re-running must be a clean no-op — the baselined migration is not replayed
    const up = run(['update-database', 'billing'], dir);
    assert.equal(up.status, 0, `update-database failed after baseline: ${up.stderr}${up.stdout}`);
    fs.rmSync(dir, { recursive: true, force: true });
});
