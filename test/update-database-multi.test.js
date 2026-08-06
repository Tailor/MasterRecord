/**
 * Regression for the "update-database only runs the latest migration file"
 * bug. Spawns the real CLI against SQLite and asserts that:
 *   1. With THREE pending migrations, all three are applied.
 *   2. A second `update-database` run is a no-op (the tracking table filters
 *      out already-applied migrations).
 *   3. `update-database-down` rolls back only the MOST RECENTLY APPLIED
 *      migration, not just the latest file on disk.
 *   4. `update-database-all` (the batch/deploy command) has the SAME parity:
 *      it applies every pending migration and records each, and a second run
 *      is a clean no-op. (It previously applied ONLY the latest migration file
 *      and never wrote the tracking table — "schema changes silently stop
 *      applying".)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const masterRecordRoot = path.resolve(__dirname, '..');
const cliEntry = path.join(masterRecordRoot, 'Migrations', 'cli.js');

// Each test sets up an isolated project directory with:
//   - package.json (ESM)
//   - config/environments/env.multimigctx.json
//   - app/models/multimigctx.js    (context)
//   - app/models/db/migrations/<ts>_<name>_migration.js  (3 files)
//   - app/models/db/migrations/multimigctx_contextSnapShot.json
//   - db/ (destination for SQLite file)

function makeProject() {
    const projectDir = fs.mkdtempSync(path.join(masterRecordRoot, 'test', 'fixtures', 'multi-migration-'));
    const envDir = path.join(projectDir, 'config', 'environments');
    const modelsDir = path.join(projectDir, 'app', 'models');
    const migrationsDir = path.join(modelsDir, 'db', 'migrations');
    const dbDir = path.join(projectDir, 'db');

    fs.mkdirSync(envDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(dbDir, { recursive: true });

    fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ name: 'multi-migration-fixture', type: 'module' })
    );

    fs.writeFileSync(
        path.join(envDir, 'env.multimig.json'),
        JSON.stringify({
            multimigctx: {
                type: 'better-sqlite3',
                connection: dbDir + path.sep,
            },
        })
    );

    // Context file — 3 entities: Author, Book, Review
    const mrPath = pathToImportSpecifier(path.join(masterRecordRoot, 'MasterRecord.js'));
    const ctxPath = pathToImportSpecifier(path.join(masterRecordRoot, 'context.js'));
    fs.writeFileSync(
        path.join(modelsDir, 'multimigctx.js'),
        `
import context from ${JSON.stringify(ctxPath)};

class Author {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
}
class Book {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
}
class Review {
    id(db) { db.integer().primary().auto(); }
    body(db) { db.string(); }
}

class multimigctx extends context {
    constructor() {
        super();
        this.env(${JSON.stringify(envDir)});
        this.dbset(Author);
        this.dbset(Book);
        this.dbset(Review);
    }
}
export default multimigctx;
`
    );

    // Snapshot — lists all three entities as the current schema.
    // The `schema` field must match what buildUpObject expects. Since this
    // is an integration smoke test we construct it manually to reflect the
    // current entity shape the context produces.
    const entityShape = (name, cols) => {
        const obj = { __name: name, __compositeIndexes: [] };
        for (const [cname, def] of Object.entries(cols)) {
            obj[cname] = { ...def, name: cname };
        }
        return obj;
    };
    const schema = [
        entityShape('Author', {
            id: { type: 'integer', primary: true, auto: true, nullable: false, unique: true },
            name: { type: 'string', nullable: true },
        }),
        entityShape('Book', {
            id: { type: 'integer', primary: true, auto: true, nullable: false, unique: true },
            title: { type: 'string', nullable: true },
        }),
        entityShape('Review', {
            id: { type: 'integer', primary: true, auto: true, nullable: false, unique: true },
            body: { type: 'string', nullable: true },
        }),
    ];

    fs.writeFileSync(
        path.join(migrationsDir, 'multimigctx_contextSnapShot.json'),
        JSON.stringify({
            contextLocation: path.relative(migrationsDir, path.join(modelsDir, 'multimigctx.js')),
            migrationFolder: '.',
            snapShotLocation: 'multimigctx_contextSnapShot.json',
            schema,
            seedData: {},
            seedConfig: {},
        }, null, 2)
    );

    // Three migration files with ascending timestamps. Each creates one table.
    // createTable is idempotent so running them all in sequence on a fresh DB
    // produces all three tables.
    const migFor = (ts, className, entityKey) => `
import masterrecord from ${JSON.stringify(mrPath)};
class ${className} extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){
        await this.init(table);
        await this.createTable(table.${entityKey});
    }
    async down(table){
        await this.init(table);
        await this.dropTable(table.${entityKey});
    }
}
export default ${className};
`;
    const ts = [1700000001000, 1700000002000, 1700000003000];
    fs.writeFileSync(path.join(migrationsDir, `${ts[0]}_CreateAuthor_migration.js`), migFor(ts[0], 'CreateAuthor', 'Author'));
    fs.writeFileSync(path.join(migrationsDir, `${ts[1]}_CreateBook_migration.js`), migFor(ts[1], 'CreateBook', 'Book'));
    fs.writeFileSync(path.join(migrationsDir, `${ts[2]}_CreateReview_migration.js`), migFor(ts[2], 'CreateReview', 'Review'));

    return { projectDir, dbDir, migrationsDir, envDir };
}

function pathToImportSpecifier(absPath) {
    // Import via absolute file URL so the fixture does not need node_modules.
    return 'file://' + absPath;
}

function runCli(args, cwd) {
    return spawnSync(process.execPath, [cliEntry, ...args], {
        cwd,
        env: { ...process.env, master: 'multimig' },
        encoding: 'utf8',
    });
}

function dbPath(dbDir) {
    return path.join(dbDir, 'multimigctx.sqlite');
}

function tableNames(dbFile) {
    const db = new Database(dbFile);
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
    db.close();
    return rows.map(r => r.name);
}

function appliedMigrationRows(dbFile) {
    const db = new Database(dbFile);
    const rows = db.prepare(`SELECT migration_name FROM _masterrecord_migrations ORDER BY migration_name`).all();
    db.close();
    return rows.map(r => r.migration_name);
}

test('update-database applies ALL pending migrations, not just the latest', () => {
    const { projectDir, dbDir } = makeProject();
    const result = runCli(['update-database', 'multimigctx'], projectDir);

    assert.equal(result.status, 0, `CLI exited non-zero. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`);

    const file = dbPath(dbDir);
    assert.ok(fs.existsSync(file), 'SQLite DB file should be created');

    const tables = tableNames(file);
    assert.ok(tables.includes('Author'), 'Author table should exist (from migration 1)');
    assert.ok(tables.includes('Book'), 'Book table should exist (from migration 2)');
    assert.ok(tables.includes('Review'), 'Review table should exist (from migration 3)');
    assert.ok(tables.includes('_masterrecord_migrations'), 'migration tracking table should exist');

    const applied = appliedMigrationRows(file);
    assert.equal(applied.length, 3, `all three migrations should be recorded; got ${applied.length}: ${applied.join(', ')}`);
});

test('update-database is a no-op on the second run (tracking table filters)', () => {
    const { projectDir, dbDir } = makeProject();
    const first = runCli(['update-database', 'multimigctx'], projectDir);
    assert.equal(first.status, 0, `first run failed. stderr:\n${first.stderr}`);

    const second = runCli(['update-database', 'multimigctx'], projectDir);
    assert.equal(second.status, 0, `second run failed. stderr:\n${second.stderr}`);
    assert.match(second.stdout, /already applied|up to date/i, `expected no-op message on second run; got:\n${second.stdout}`);

    const applied = appliedMigrationRows(dbPath(dbDir));
    assert.equal(applied.length, 3, 'still exactly 3 applied rows after second run');
});

test('update-database-all applies ALL pending migrations and records them (parity with update-database)', () => {
    const { projectDir, dbDir } = makeProject();
    const result = runCli(['update-database-all'], projectDir);

    assert.equal(result.status, 0, `CLI exited non-zero. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`);

    const file = dbPath(dbDir);
    assert.ok(fs.existsSync(file), 'SQLite DB file should be created');

    const tables = tableNames(file);
    assert.ok(tables.includes('Author'), 'Author table should exist (migration 1)');
    assert.ok(tables.includes('Book'), 'Book table should exist (migration 2)');
    assert.ok(tables.includes('Review'), 'Review table should exist (migration 3) — NOT just the latest');
    assert.ok(tables.includes('_masterrecord_migrations'), 'migration tracking table should exist');

    const applied = appliedMigrationRows(file);
    assert.equal(applied.length, 3, `all three migrations should be recorded; got ${applied.length}: ${applied.join(', ')}`);

    assert.match(result.stdout, /summary/i, 'should print a per-context summary');
});

test('update-database-all is a no-op on the second run (exit 0, tracking table filters)', () => {
    const { projectDir, dbDir } = makeProject();
    const first = runCli(['update-database-all'], projectDir);
    assert.equal(first.status, 0, `first run failed. stderr:\n${first.stderr}`);

    const second = runCli(['update-database-all'], projectDir);
    assert.equal(second.status, 0, `second run failed. stderr:\n${second.stderr}`);
    assert.match(second.stdout, /up to date/i, `expected up-to-date message on second run; got:\n${second.stdout}`);

    const applied = appliedMigrationRows(dbPath(dbDir));
    assert.equal(applied.length, 3, 'still exactly 3 applied rows after second run');
});

test('update-database-down rolls back the MOST RECENTLY APPLIED migration', () => {
    const { projectDir, dbDir } = makeProject();
    const up = runCli(['update-database', 'multimigctx'], projectDir);
    assert.equal(up.status, 0, `up failed. stderr:\n${up.stderr}`);

    assert.deepEqual(tableNames(dbPath(dbDir)).filter(n => !n.startsWith('_') && !n.startsWith('sqlite_')).sort(),
        ['Author', 'Book', 'Review']);

    const down = runCli(['update-database-down', 'multimigctx'], projectDir);
    assert.equal(down.status, 0, `down failed. stderr:\n${down.stderr}`);

    // Review was the latest migration; after down, Review should be gone,
    // Author and Book should remain.
    const tables = tableNames(dbPath(dbDir)).filter(n => !n.startsWith('_') && !n.startsWith('sqlite_'));
    assert.ok(tables.includes('Author'), 'Author should still exist');
    assert.ok(tables.includes('Book'), 'Book should still exist');
    assert.ok(!tables.includes('Review'), 'Review should have been dropped by down()');

    const applied = appliedMigrationRows(dbPath(dbDir));
    assert.equal(applied.length, 2, `after down, 2 migrations should remain applied; got ${applied.join(', ')}`);
});
