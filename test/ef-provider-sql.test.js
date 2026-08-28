/**
 * Provider-level SQL for the ported EF classes, on ALL THREE engines.
 *
 * masterrecord has no live MySQL/Postgres suite (docker-compose.test.yml advertises
 * MR_TEST_MYSQL_URL / MR_TEST_PG_URL, but nothing reads them), so the MySQL and
 * Postgres paths of HistoryRepository / RelationalDatabaseCreator would otherwise
 * ship completely unexecuted. These tests drive them with a fake context that
 * captures the SQL instead of running it — no database required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SqliteHistoryRepository, MySqlHistoryRepository, PostgresHistoryRepository, createHistoryRepository,
} from '../Migrations/HistoryRepository.js';
import {
    SqliteDatabaseCreator, MySqlDatabaseCreator, PostgresDatabaseCreator, createDatabaseCreator,
} from '../Migrations/RelationalDatabaseCreator.js';
import HistoryRow from '../Migrations/HistoryRow.js';

/** A context that records every statement instead of executing it. */
function fakeContext(engine, { database = 'appdb', rows = [] } = {}) {
    const executed = [];
    return {
        executed,
        isSQLite: engine === 'sqlite',
        isMySQL: engine === 'mysql',
        isPostgres: engine === 'postgres',
        _dbConfig: { database, connection: '/tmp/app.sqlite' },
        _SQLEngine: {
            db: { name: '/tmp/app.sqlite', prepare: (sql) => ({ all: () => { executed.push(sql); return rows; } }) },
            _runWithParams: async (sql) => { executed.push(sql); return engine === 'postgres' ? { rows } : rows; },
        },
        _execute: async (sql) => { executed.push(sql); return { rowCount: 0 }; },
    };
}

const repoFor = (engine) => createHistoryRepository(fakeContext(engine));
const creatorFor = (engine, opts) => createDatabaseCreator(fakeContext(engine, opts));

test('history repository: provider resolution and identifier quoting', () => {
    assert.ok(repoFor('sqlite') instanceof SqliteHistoryRepository);
    assert.ok(repoFor('mysql') instanceof MySqlHistoryRepository);
    assert.ok(repoFor('postgres') instanceof PostgresHistoryRepository);

    assert.equal(repoFor('sqlite').delimitIdentifier('a"b'), '"a""b"');
    assert.equal(repoFor('mysql').delimitIdentifier('a`b'), '`a``b`');
    assert.equal(repoFor('postgres').delimitIdentifier('a"b'), '"a""b"');
});

test('history repository: existsSql targets the right catalog per engine', () => {
    assert.match(repoFor('sqlite').existsSql, /FROM "sqlite_master" WHERE "name" = '_masterrecord_migrations' AND "type" = 'table'/);
    assert.match(repoFor('mysql').existsSql, /information_schema\.tables WHERE table_schema = DATABASE\(\) AND table_name = '_masterrecord_migrations'/);
    assert.match(repoFor('postgres').existsSql, /information_schema\.tables WHERE table_schema = current_schema\(\) AND table_name = '_masterrecord_migrations'/);
});

test('history repository: CREATE TABLE is valid per-engine and the IF NOT EXISTS variant only adds the guard', () => {
    for (const engine of ['sqlite', 'mysql', 'postgres']) {
        const repo = repoFor(engine);
        const create = repo.getCreateScript();
        const ifNotExists = repo.getCreateIfNotExistsScript();
        assert.match(create, /^CREATE TABLE /, `${engine}: plain create`);
        assert.ok(create.includes('migration_name'), `${engine}: id column`);
        assert.ok(create.includes('product_version'), `${engine}: product version column`);
        assert.ok(create.includes('applied_at'), `${engine}: applied_at column`);
        assert.ok(create.includes('PRIMARY KEY'), `${engine}: primary key`);
        assert.equal(ifNotExists, create.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'), `${engine}: guard only`);
        // the quoting must match the engine
        const q = engine === 'mysql' ? '`' : '"';
        assert.ok(create.includes(`${q}_masterrecord_migrations${q}`), `${engine}: table name quoted with ${q}`);
    }
    // engine-appropriate column types
    assert.match(repoFor('sqlite').getCreateScript(), /migration_name" TEXT NOT NULL PRIMARY KEY/);
    assert.match(repoFor('mysql').getCreateScript(), /migration_name` VARCHAR\(150\) NOT NULL PRIMARY KEY/);
    assert.match(repoFor('postgres').getCreateScript(), /migration_name" VARCHAR\(150\) NOT NULL PRIMARY KEY/);
});

test('history repository: insert/delete scripts quote per engine and escape literals', () => {
    for (const engine of ['sqlite', 'mysql', 'postgres']) {
        const repo = repoFor(engine);
        const insert = repo.getInsertScript(new HistoryRow("o'brien", '1.2.3', '2026-01-01'));
        assert.ok(insert.startsWith('INSERT INTO '), `${engine}`);
        assert.ok(insert.includes("'o''brien'"), `${engine}: escapes quotes`);
        assert.ok(insert.includes("'1.2.3'"), `${engine}: product version`);
        assert.match(repo.getDeleteScript("o'brien"), /DELETE FROM .* WHERE .* = 'o''brien'/, `${engine}`);
        // a null product version must be SQL NULL, not the string "null"
        assert.match(repo.getInsertScript(new HistoryRow('x', null, 'now')), /, NULL, /, `${engine}: null version`);
    }
});

test('history repository: idempotency hooks — Postgres emits a DO block, SQLite refuses (as EF does)', () => {
    const pg = repoFor('postgres');
    const begin = pg.getBeginIfNotExistsScript('20260101_Init');
    assert.match(begin, /DO \$MR\$/);
    assert.match(begin, /IF NOT EXISTS\(SELECT 1 FROM "_masterrecord_migrations" WHERE "migration_name" = '20260101_Init'\) THEN/);
    assert.match(pg.getBeginIfExistsScript('20260101_Init'), /IF EXISTS\(SELECT 1 FROM/);
    assert.match(pg.getEndIfScript(), /END IF;\s*END \$MR\$;/);

    assert.throws(() => repoFor('sqlite').getBeginIfNotExistsScript('x'), /does not support idempotent migration scripts/);
    assert.throws(() => repoFor('mysql').getBeginIfNotExistsScript('x'), /not supported/);
});

test('database creator: provider resolution', () => {
    assert.ok(creatorFor('sqlite') instanceof SqliteDatabaseCreator);
    assert.ok(creatorFor('mysql') instanceof MySqlDatabaseCreator);
    assert.ok(creatorFor('postgres') instanceof PostgresDatabaseCreator);
});

/** Stub the admin channel: exists()/create() must NOT need the context's engine,
 *  because the database they are asked about may not exist yet. */
function withAdmin(creator, rows = []) {
    const seen = [];
    creator._adminQuery = async (sql) => { seen.push(sql); return rows; };
    creator.adminSql = seen;
    return creator;
}

test('database creator: exists() asks an ADMIN connection, not the context engine', async () => {
    const my = withAdmin(creatorFor('mysql', { database: 'shop' }), [{ SCHEMA_NAME: 'shop' }]);
    assert.equal(await my.exists(), true);
    assert.match(my.adminSql[0], /INFORMATION_SCHEMA\.SCHEMATA WHERE SCHEMA_NAME = 'shop'/);
    assert.equal(my.context.executed.length, 0, 'the context engine is never used — it may not be connectable');

    const pg = withAdmin(creatorFor('postgres', { database: 'shop' }), [{ '?column?': 1 }]);
    assert.equal(await pg.exists(), true);
    assert.match(pg.adminSql[0], /FROM pg_database WHERE datname = 'shop'/);
    assert.equal(pg.context.executed.length, 0);

    // no row back => the database is absent
    assert.equal(await withAdmin(creatorFor('mysql', { database: 'shop' }), []).exists(), false);
    assert.equal(await withAdmin(creatorFor('postgres', { database: 'shop' }), []).exists(), false);
});

test('database creator: hasTables() counts tables in the current schema', async () => {
    const my = creatorFor('mysql', { rows: [{ c: 3 }] });
    assert.equal(await my.hasTables(), true);
    assert.match(my.context.executed[0], /information_schema\.tables WHERE table_schema = DATABASE\(\)/);

    const pg = creatorFor('postgres', { rows: [{ count: 0 }] });
    assert.equal(await pg.hasTables(), false, 'zero tables => false');
    assert.match(pg.context.executed[0], /information_schema\.tables WHERE table_schema = current_schema\(\)/);

    const lite = creatorFor('sqlite', { rows: [{ c: 2 }] });
    assert.equal(await lite.hasTables(), true);
    assert.match(lite.context.executed[0], /sqlite_master" WHERE "type" = 'table' AND "rootpage" IS NOT NULL/);
});

test('database creator: exists() is what canConnect() reports, and a thrown provider error is false', async () => {
    const c = withAdmin(creatorFor('postgres', { database: 'shop' }), [{ x: 1 }]);
    assert.equal(await c.canConnect(), true);
    c.exists = async () => { throw new Error('connection refused'); };
    assert.equal(await c.canConnect(), false, 'canConnect never throws');
});

test('database creator: MySQL/Postgres delete() drops from an ADMIN connection, never the open one', async () => {
    // Postgres refuses to drop the database the session is attached to, and a MySQL
    // pool left pointing at a dropped schema is broken — so neither may use context._execute.
    for (const engine of ['mysql', 'postgres']) {
        const creator = creatorFor(engine, { database: 'shop' });
        const admin = [];
        let closed = false;
        creator._adminQuery = async (sql) => { admin.push(sql); };
        creator.context.close = async () => { closed = true; };

        await creator.delete();

        assert.equal(closed, true, `${engine}: closes the context pool first`);
        assert.equal(creator.context.executed.length, 0, `${engine}: nothing ran on the open connection`);
        assert.ok(admin.some(s => /DROP DATABASE IF EXISTS/.test(s)), `${engine}: drops`);
        assert.ok(admin.some(s => s.includes('shop')), `${engine}: names the database`);
    }

    // Postgres additionally evicts other sessions before dropping
    const pg = creatorFor('postgres', { database: 'shop' });
    const admin = [];
    pg._adminQuery = async (sql) => { admin.push(sql); };
    pg.context.close = async () => {};
    await pg.delete();
    assert.match(admin[0], /pg_terminate_backend\(pid\).*datname = 'shop'.*pid <> pg_backend_pid\(\)/s, 'terminates other backends first');
    assert.match(admin[1], /DROP DATABASE IF EXISTS "shop"/);
});

test('database creator: a database name that is not a plain identifier is refused (it is interpolated into DDL)', async () => {
    for (const engine of ['mysql', 'postgres']) {
        const creator = creatorFor(engine, { database: 'shop"; DROP DATABASE other; --' });
        creator._adminQuery = async () => { throw new Error('must not run'); };
        creator.context.close = async () => {};
        await assert.rejects(() => creator.delete(), /refusing to operate on an invalid database name/, engine);
    }
});
