/**
 * EF's Migrator.Migrate, ported: applying and reverting migrations from the
 * library rather than only from the CLI.
 *
 *   migrate()      -> apply every pending migration
 *   migrate(id)    -> migrate up or down to that migration
 *   migrate('0')   -> revert everything (EF's Migration.InitialDatabase)
 *
 * Each migration is applied atomically with its history row, and recorded as it
 * goes, so an interrupted run resumes where it stopped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import Migrator from '../Migrations/Migrator.js';
import MigrationsAssembly from '../Migrations/MigrationsAssembly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const spec = (abs) => 'file://' + abs;
process.env.master = 'migapply';

function makeProject() {
    const projectDir = fs.mkdtempSync(path.join(root, 'test', 'fixtures', 'mig-apply-'));
    const envDir = path.join(projectDir, 'config', 'environments');
    const modelsDir = path.join(projectDir, 'app', 'models');
    const migrationsDir = path.join(modelsDir, 'db', 'migrations');
    const dbDir = path.join(projectDir, 'db');
    for (const d of [envDir, modelsDir, migrationsDir, dbDir]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'env.migapply.json'), JSON.stringify({
        applyctx: { type: 'better-sqlite3', connection: dbDir + path.sep },
    }));
    fs.writeFileSync(path.join(modelsDir, 'applyctx.js'), `
import context from ${JSON.stringify(spec(path.join(root, 'context.js')))};
class Author { id(db) { db.integer().primary().auto(); } name(db) { db.string(); } }
class Book   { id(db) { db.integer().primary().auto(); } title(db) { db.string(); } }
class applyctx extends context {
    constructor() { super(); this.env(${JSON.stringify(envDir)}); this.dbset(Author); this.dbset(Book); }
}
export default applyctx;
`);
    const shape = (name, cols) => { const o = { __name: name, __compositeIndexes: [] }; for (const [c, d] of Object.entries(cols)) o[c] = { ...d, name: c }; return o; };
    const pk = { type: 'integer', primary: true, auto: true, nullable: false, unique: true };
    const snapshotPath = path.join(migrationsDir, 'applyctx_contextSnapShot.json');
    fs.writeFileSync(snapshotPath, JSON.stringify({
        contextLocation: path.relative(migrationsDir, path.join(modelsDir, 'applyctx.js')),
        migrationFolder: '.', snapShotLocation: 'applyctx_contextSnapShot.json',
        schema: [shape('Author', { id: pk, name: { type: 'string', nullable: true } }),
                 shape('Book', { id: pk, title: { type: 'string', nullable: true } })],
        seedData: {}, seedConfig: {},
    }, null, 2));
    const mig = (cls, key) => `
import masterrecord from ${JSON.stringify(spec(path.join(root, 'MasterRecord.js')))};
class ${cls} extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){ await this.init(table); await this.createTable(table.${key}); }
    async down(table){ await this.init(table); await this.dropTable(table.${key}); }
}
export default ${cls};
`;
    const files = [
        path.join(migrationsDir, '1700000001000_CreateAuthor_migration.js'),
        path.join(migrationsDir, '1700000002000_CreateBook_migration.js'),
    ];
    fs.writeFileSync(files[0], mig('CreateAuthor', 'Author'));
    fs.writeFileSync(files[1], mig('CreateBook', 'Book'));
    return { projectDir, dbDir, migrationsDir, snapshotPath, files,
             contextFile: path.join(modelsDir, 'applyctx.js') };
}

const dbFile = (dbDir) => path.join(dbDir, 'applyctx.sqlite');
const tables = (f) => { const db = new Database(f); const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(x => x.name); db.close(); return r; };

async function migratorFor(p) {
    const ContextCtor = (await import(pathToFileURL(p.contextFile).href)).default;
    const context = new ContextCtor();
    await context._ensureReady();
    return {
        context,
        migrator: new Migrator({
            context,
            contextCtor: ContextCtor,
            snapshot: JSON.parse(fs.readFileSync(p.snapshotPath, 'utf8')),
            migrationsAssembly: new MigrationsAssembly({ files: p.files }),
            historyRepository: context.database.historyRepository,
            databaseCreator: context.database.databaseCreator,
        }),
    };
}

test('migrate() applies every pending migration, atomically, and is idempotent', async () => {
    const p = makeProject();
    const { context, migrator } = await migratorFor(p);

    const events = [];
    migrator.dependencies.logger = {
        migrationApplying: (id) => events.push(['applying', id]),
        migrationApplied: (id, mode) => events.push(['applied', id, mode]),
        migrationsNotApplied: () => events.push(['none']),
    };

    const first = await migrator.migrate();
    assert.deepEqual(first.applied, ['1700000001000_CreateAuthor_migration.js', '1700000002000_CreateBook_migration.js']);
    assert.deepEqual(first.reverted, []);

    const t = tables(dbFile(p.dbDir));
    assert.ok(t.includes('Author') && t.includes('Book'), `tables created: ${t.join(',')}`);
    assert.ok(t.includes('_masterrecord_migrations'), 'history table created');
    assert.deepEqual(await context.database.getAppliedMigrations(), first.applied, 'both recorded as applied');
    assert.deepEqual(await context.database.getPendingMigrations({ migrationsAssembly: migrator.migrationsAssembly }), []);

    // EF logs each migration as it applies; SQLite applies transactionally
    assert.deepEqual(events.filter(e => e[0] === 'applied').map(e => e[2]), ['transaction', 'transaction']);

    // running again does nothing
    const second = await migrator.migrate();
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.reverted, []);
    assert.ok(events.some(e => e[0] === 'none'), 'logged "no migrations applied"');
    await context.close();
});

test('migrate(target) applies only up to the target, then reverts back down to it', async () => {
    const p = makeProject();
    const { context, migrator } = await migratorFor(p);

    // forward to the first migration only
    const up1 = await migrator.migrate('CreateAuthor');
    assert.deepEqual(up1.applied, ['1700000001000_CreateAuthor_migration.js']);
    let t = tables(dbFile(p.dbDir));
    assert.ok(t.includes('Author'), 'Author created');
    assert.ok(!t.includes('Book'), 'Book NOT created yet');

    // forward the rest
    const up2 = await migrator.migrate();
    assert.deepEqual(up2.applied, ['1700000002000_CreateBook_migration.js']);
    assert.ok(tables(dbFile(p.dbDir)).includes('Book'));

    // back down to the first migration => Book is reverted
    const down = await migrator.migrate('CreateAuthor');
    assert.deepEqual(down.reverted, ['1700000002000_CreateBook_migration.js']);
    assert.deepEqual(down.applied, []);
    t = tables(dbFile(p.dbDir));
    assert.ok(t.includes('Author'), 'Author still there');
    assert.ok(!t.includes('Book'), 'Book dropped');
    assert.deepEqual(await context.database.getAppliedMigrations(), ['1700000001000_CreateAuthor_migration.js']);
    await context.close();
});

test("migrate('0') reverts everything, newest first (EF InitialDatabase)", async () => {
    const p = makeProject();
    const { context, migrator } = await migratorFor(p);
    await migrator.migrate();

    const order = [];
    migrator.dependencies.logger = { migrationReverting: (id) => order.push(id) };

    const res = await migrator.migrate(Migrator.InitialDatabase);
    assert.deepEqual(res.reverted, ['1700000002000_CreateBook_migration.js', '1700000001000_CreateAuthor_migration.js']);
    assert.deepEqual(order, res.reverted, 'reverted newest first');

    const t = tables(dbFile(p.dbDir));
    assert.ok(!t.includes('Author') && !t.includes('Book'), `both dropped: ${t.join(',')}`);
    assert.deepEqual(await context.database.getAppliedMigrations(), [], 'history emptied');
    await context.close();
});

test('context.database.migrate() applies pending migrations the way EF Database.Migrate() does', async () => {
    const p = makeProject();
    const { context } = await migratorFor(p);

    const res = await context.database.migrate(null, {
        snapshot: JSON.parse(fs.readFileSync(p.snapshotPath, 'utf8')),
        files: p.files,
    });
    assert.deepEqual(res.applied, ['1700000001000_CreateAuthor_migration.js', '1700000002000_CreateBook_migration.js']);
    const t = tables(dbFile(p.dbDir));
    assert.ok(t.includes('Author') && t.includes('Book'), `tables: ${t.join(',')}`);
    assert.deepEqual(await context.database.getPendingMigrations({ files: p.files }), [], 'nothing pending afterwards');
    await context.close();
});
