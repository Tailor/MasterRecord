// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Migrations/Internal/Migrator.cs. See THIRD-PARTY-NOTICES.md.

import MigrationsAssembly from './MigrationsAssembly.js';

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
}

export default Migrator;
export { Migrator };
