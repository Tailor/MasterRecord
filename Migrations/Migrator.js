// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Migrations/Internal/Migrator.cs. See THIRD-PARTY-NOTICES.md.

import MigrationsAssembly from './MigrationsAssembly.js';
import { createHistoryRepository } from './HistoryRepository.js';

/**
 * Decides which migrations to apply and which to revert (EF `Migrator`).
 *
 * This is the planning half of EF's Migrator, ported faithfully. Applying a
 * migration is still done by the `masterrecord update-database` CLI, which owns
 * the snapshot handling and the per-migration transaction; this class is what
 * answers "what is pending?" and "what would `--target X` do?".
 */
class Migrator {
    /** EF's sentinel target meaning "revert everything" (Migration.InitialDatabase). */
    static InitialDatabase = '0';

    /**
     * @param {{historyRepository?: object, migrationsAssembly?: MigrationsAssembly, migrationsPath?: string}} dependencies
     */
    constructor(dependencies = {}) {
        this.dependencies = dependencies;
        this._assembly = dependencies.migrationsAssembly
            || new MigrationsAssembly({ migrationsPath: dependencies.migrationsPath, files: dependencies.files });
    }

    get migrationsAssembly() { return this._assembly; }
    get historyRepository() { return this.dependencies.historyRepository; }

    /** Every migration on disk, oldest first (EF: GetMigrations). */
    getMigrations() { return this.migrationsAssembly.migrationIds; }

    /** Migration ids recorded as applied (EF: GetAppliedMigrations). */
    async getAppliedMigrations() {
        if (!this.historyRepository) throw new Error('masterrecord: Migrator needs a historyRepository to read applied migrations.');
        const rows = await this.historyRepository.getAppliedMigrations();
        return rows.map(r => r.migrationId);
    }

    /** On disk but not recorded as applied (EF: GetPendingMigrations = GetMigrations except applied). */
    async getPendingMigrations() {
        const applied = new Set((await this.getAppliedMigrations()).map(id => id.toLowerCase()));
        return this.getMigrations().filter(id => !applied.has(id.toLowerCase()));
    }

    /**
     * EF's PopulateMigrations: split the known migrations into those to apply and
     * those to revert for a given target.
     *
     *  - no target                -> apply every unapplied migration, revert nothing
     *  - target === '0'           -> revert every applied migration, apply nothing
     *  - target === some id       -> apply unapplied migrations up to and including it,
     *                                revert applied migrations after it (newest first)
     *
     * @param {Iterable<string>} appliedMigrationEntries - ids currently in the history table
     * @param {string|null} targetMigration
     * @returns {{migrationsToApply: string[], migrationsToRevert: string[], targetMigration: string|null}}
     */
    populateMigrations(appliedMigrationEntries, targetMigration) {
        const appliedSet = new Set([...(appliedMigrationEntries || [])].map(id => String(id).toLowerCase()));
        const all = this.getMigrations();
        const applied = all.filter(id => appliedSet.has(id.toLowerCase()));
        const unapplied = all.filter(id => !appliedSet.has(id.toLowerCase()));

        const cmp = MigrationsAssembly.compareIds;

        if (targetMigration === null || targetMigration === undefined || targetMigration === '') {
            return { migrationsToApply: [...unapplied], migrationsToRevert: [], targetMigration: null };
        }

        if (String(targetMigration) === Migrator.InitialDatabase) {
            return {
                migrationsToApply: [],
                migrationsToRevert: [...applied].reverse(),
                targetMigration: null,
            };
        }

        const target = this.migrationsAssembly.getMigrationId(targetMigration);
        return {
            migrationsToApply: unapplied.filter(id => cmp(id, target) <= 0),
            migrationsToRevert: applied.filter(id => cmp(id, target) > 0).reverse(),
            targetMigration: applied.find(id => cmp(id, target) === 0) || null,
        };
    }

    /**
     * The plan for a target, read against the live history table
     * (EF: what Migrate(targetMigration) would do).
     */
    async plan(targetMigration = null) {
        return this.populateMigrations(await this.getAppliedMigrations(), targetMigration);
    }

    // ---- applying (EF: Migrator.Migrate) ---------------------------------

    get context() { return this.dependencies.context; }
    get databaseCreator() { return this.dependencies.databaseCreator; }

    _log(event, ...args) {
        const logger = this.dependencies.logger;
        if (logger && typeof logger[event] === 'function') logger[event](...args);
    }

    /**
     * The `table` object every migration's up()/down() receives: the diff between
     * the snapshot's schema and the context's current entities. EF hands the
     * migration its model; masterrecord hands it this.
     */
    async _tableObject() {
        if (this._tableObj) return this._tableObj;
        if (this.dependencies.tableObj) { this._tableObj = this.dependencies.tableObj; return this._tableObj; }
        const snapshot = this.dependencies.snapshot;
        if (!snapshot) throw new Error('masterrecord: Migrator.migrate() needs the context snapshot (or an explicit tableObj).');
        // dynamic: migrations.js -> schema.js -> context.js would close an import cycle
        const { default: Migration } = await import('./migrations.js');
        const helper = new Migration();
        const cleanEntities = helper.cleanEntities(this.context.__entities);
        this._tableObj = helper.buildUpObject(snapshot.schema, cleanEntities);
        return this._tableObj;
    }

    async _loadMigration(file) {
        const loader = this.dependencies.loadMigration;
        if (loader) return loader(file);
        const { pathToFileURL } = await import('node:url');
        const mod = await import(pathToFileURL(file).href);
        return (mod && mod.default !== undefined) ? mod.default : mod;
    }

    /**
     * Run one migration and record it, atomically where the engine allows it
     * (EF applies each migration in its own transaction; MySQL autocommits DDL).
     */
    async _executeMigration(id, direction) {
        const file = this.migrationsAssembly.getMigrationFile(id);
        if (!file) throw new Error(`masterrecord: migration '${id}' was recorded or planned but its file is missing.`);
        const MigrationCtor = await this._loadMigration(file);
        const instance = new MigrationCtor(this.dependencies.contextCtor);
        const ctx = (instance && instance.context) ? instance.context : this.context;
        const tableObj = await this._tableObject();

        this._log(direction === 'down' ? 'migrationReverting' : 'migrationApplying', id);

        // The migration runs on ITS OWN context (schema's constructor builds one), and
        // the history row must be written on that same connection — otherwise the DDL
        // and the row land in different transactions, and on SQLite the second
        // connection blocks on the first one's write lock.
        const history = (ctx === this.context)
            ? this.historyRepository
            : createHistoryRepository(ctx, { productVersion: this.historyRepository.productVersion });

        const run = async () => {
            if (direction === 'down') await instance.down(tableObj);
            else await instance.up(tableObj);
            if (typeof instance.finalize === 'function') await instance.finalize();
            if (direction === 'down') await history.recordReverted(id);
            else await history.recordApplied(id);
        };

        let mode = 'autocommit';
        if (ctx.isMySQL || typeof ctx.transaction !== 'function') {
            await run();
        } else {
            // SQLite: a table rebuild inside the migration drops and recreates
            // tables, which foreign keys would veto mid-flight.
            let fkWasOn = false;
            if (ctx.isSQLite) {
                await ctx._ensureReady();
                try { fkWasOn = ctx._SQLEngine.db.pragma('foreign_keys', { simple: true }) === 1; } catch (_) { /* older driver */ }
                if (fkWasOn) { try { ctx._SQLEngine.db.pragma('foreign_keys = OFF'); } catch (_) { /* ignore */ } }
            }
            try {
                await ctx.transaction(run);
                mode = 'transaction';
            } finally {
                if (ctx.isSQLite && fkWasOn) { try { ctx._SQLEngine.db.pragma('foreign_keys = ON'); } catch (_) { /* ignore */ } }
            }
        }

        // Each migration's schema constructor opens its OWN context; release it so
        // connections do not accumulate across a batch of migrations or contexts.
        if (ctx !== this.context && typeof ctx.close === 'function') {
            try { await ctx.close(); } catch (_) { /* best-effort teardown */ }
        }

        this._log(direction === 'down' ? 'migrationReverted' : 'migrationApplied', id, mode);
        return mode;
    }

    /**
     * Apply one migration and record it. EF has no single-migration entry point
     * (you give Migrate a target), but the CLI needs one for its targeted
     * operations — and routing them here keeps ONE execution path, so every
     * command gets the same transaction and history handling.
     */
    async applyMigration(id) {
        await this.historyRepository.createIfNotExists();
        return this._executeMigration(id, 'up');
    }

    /** Revert one migration and remove its history row. */
    async revertMigration(id) {
        await this.historyRepository.createIfNotExists();
        return this._executeMigration(id, 'down');
    }

    /**
     * Bring the database to `targetMigration` (EF: Migrator.Migrate).
     *
     *   migrate()          -> apply every pending migration
     *   migrate('Name')    -> migrate up or down to that migration
     *   migrate('0')       -> revert everything (EF's InitialDatabase)
     *
     * Creates the database and the history table if they are missing, then reverts
     * newest-first and applies oldest-first, recording each migration as it goes so
     * an interrupted run resumes from where it stopped.
     */
    async migrate(targetMigration = null) {
        if (this.databaseCreator && !(await this.databaseCreator.exists())) {
            await this.databaseCreator.create();
        }
        await this.historyRepository.createIfNotExists();

        const plan = await this.plan(targetMigration);
        const reverted = [];
        const applied = [];

        for (const id of plan.migrationsToRevert) {
            await this._executeMigration(id, 'down');
            reverted.push(id);
        }
        for (const id of plan.migrationsToApply) {
            await this._executeMigration(id, 'up');
            applied.push(id);
        }
        if (!applied.length && !reverted.length) this._log('migrationsNotApplied');

        return { applied, reverted, targetMigration: plan.targetMigration };
    }
}

export default Migrator;
export { Migrator };
