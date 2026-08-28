/**
 * EF's Migrator planning, ported: which migrations get applied and which get
 * reverted for a given target (EF `Migrator.PopulateMigrations`), plus
 * GetMigrations / GetPendingMigrations on context.database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import masterrecord from '../MasterRecord.js';
import Migrator from '../Migrations/Migrator.js';
import MigrationsAssembly from '../Migrations/MigrationsAssembly.js';

process.env.master = 'development';

const FILES = [
    '/m/900_Alpha_migration.js',
    '/m/1000_Beta_migration.js',
    '/m/1100_Gamma_migration.js',
    '/m/1200_Delta_migration.js',
];
const ID = (n) => path.basename(FILES[n]);
const migrator = () => new Migrator({ migrationsAssembly: new MigrationsAssembly({ files: FILES }) });

test('migrations are ordered chronologically, not lexicographically', () => {
    assert.deepEqual(migrator().getMigrations(), [ID(0), ID(1), ID(2), ID(3)]);
    // lexicographically "1000_" sorts before "900_"; by timestamp 900 comes first
    assert.ok('1000_Beta_migration.js' < '900_Alpha_migration.js', 'precondition: lexicographic order differs');
    assert.equal(migrator().getMigrations()[0], '900_Alpha_migration.js');
});

test('no target: apply every unapplied migration, revert nothing', () => {
    const plan = migrator().populateMigrations([ID(0), ID(1)], null);
    assert.deepEqual(plan.migrationsToApply, [ID(2), ID(3)]);
    assert.deepEqual(plan.migrationsToRevert, []);
    assert.equal(plan.targetMigration, null);

    const fresh = migrator().populateMigrations([], null);
    assert.deepEqual(fresh.migrationsToApply, [ID(0), ID(1), ID(2), ID(3)], 'a fresh database applies everything');
});

test("target '0' (EF InitialDatabase): revert everything applied, newest first", () => {
    const plan = migrator().populateMigrations([ID(0), ID(1), ID(2)], Migrator.InitialDatabase);
    assert.deepEqual(plan.migrationsToApply, []);
    assert.deepEqual(plan.migrationsToRevert, [ID(2), ID(1), ID(0)], 'reverted newest first');
    assert.equal(Migrator.InitialDatabase, '0');
});

test('target in the middle: apply up to it, revert everything after it (newest first)', () => {
    // applied through Delta, target Beta => revert Delta and Gamma
    const back = migrator().populateMigrations([ID(0), ID(1), ID(2), ID(3)], ID(1));
    assert.deepEqual(back.migrationsToApply, []);
    assert.deepEqual(back.migrationsToRevert, [ID(3), ID(2)]);
    assert.equal(back.targetMigration, ID(1), 'the target itself stays applied');

    // applied through Alpha, target Gamma => apply Beta and Gamma, revert nothing
    const fwd = migrator().populateMigrations([ID(0)], ID(2));
    assert.deepEqual(fwd.migrationsToApply, [ID(1), ID(2)]);
    assert.deepEqual(fwd.migrationsToRevert, []);

    // a target equal to the newest applied is a no-op
    const noop = migrator().populateMigrations([ID(0), ID(1)], ID(1));
    assert.deepEqual(noop.migrationsToApply, []);
    assert.deepEqual(noop.migrationsToRevert, []);
});

test('applied-migration matching is case-insensitive, as in EF', () => {
    const plan = migrator().populateMigrations([ID(0).toUpperCase()], null);
    assert.deepEqual(plan.migrationsToApply, [ID(1), ID(2), ID(3)], 'the upper-cased id counted as applied');
});

test('getMigrationId resolves a full id or a bare migration name, and reports ambiguity', () => {
    const a = new MigrationsAssembly({ files: FILES });
    assert.equal(a.getMigrationId('1100_Gamma_migration.js'), ID(2), 'full id');
    assert.equal(a.getMigrationId('Gamma'), ID(2), 'bare name');
    assert.equal(a.getMigrationId('gamma'), ID(2), 'case-insensitive');
    assert.equal(a.getMigrationId('0'), '0', 'the InitialDatabase sentinel passes through');
    assert.throws(() => a.getMigrationId('Nope'), /no migration named 'Nope'/);

    const dupes = new MigrationsAssembly({ files: ['/m/1_Same_migration.js', '/m/2_Same_migration.js'] });
    assert.throws(() => dupes.getMigrationId('Same'), /matches more than one migration/);
});

test('context.database: getMigrations / getPendingMigrations against a real history table', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-plan-'));
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-plan-env-'));
    fs.writeFileSync(path.join(envDir, 'env.development.json'), JSON.stringify({
        testContext: { env: 'development', connection: path.join(dir, 'db.sqlite3'), type: 'sqlite', password: '', username: '' },
    }));
    class Thing { id(db) { db.integer().primary().auto(); } }
    class testContext extends masterrecord.context {
        constructor() { super(); this.env(envDir); this.dbset(Thing); }
    }
    const ctx = new testContext();
    await ctx._ensureReady();

    const opts = { migrationsAssembly: new MigrationsAssembly({ files: FILES }) };
    assert.deepEqual(ctx.database.getMigrations(opts), [ID(0), ID(1), ID(2), ID(3)]);
    assert.deepEqual(await ctx.database.getPendingMigrations(opts), [ID(0), ID(1), ID(2), ID(3)],
        'nothing applied yet => everything is pending');

    await ctx.database.baseline(ID(0));
    await ctx.database.baseline(ID(1));
    assert.deepEqual(await ctx.database.getPendingMigrations(opts), [ID(2), ID(3)],
        'baselined migrations are no longer pending');
    assert.deepEqual(await ctx.database.getAppliedMigrations(), [ID(0), ID(1)]);

    const plan = await ctx.database.migrator(opts).plan(null);
    assert.deepEqual(plan.migrationsToApply, [ID(2), ID(3)], 'plan() reads the live history table');
    await ctx.close();
});
