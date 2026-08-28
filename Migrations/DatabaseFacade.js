// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Extensions/RelationalDatabaseFacadeExtensions.cs and Infrastructure/DatabaseFacade.cs.
// See THIRD-PARTY-NOTICES.md.

import { createRequire } from 'node:module';
import { createDatabaseCreator } from './RelationalDatabaseCreator.js';
import { createHistoryRepository } from './HistoryRepository.js';
import Migrator from './Migrator.js';
import HistoryRow from './HistoryRow.js';

const require = createRequire(import.meta.url);
let PRODUCT_VERSION = null;
try { PRODUCT_VERSION = require('../package.json').version; } catch (_) { PRODUCT_VERSION = null; }

/**
 * Database-level operations for a context — EF's `context.Database`.
 *
 *   await ctx.database.ensureCreated();          // EF EnsureCreated()
 *   await ctx.database.ensureDeleted();          // EF EnsureDeleted()
 *   await ctx.database.canConnect();             // EF CanConnect()
 *   await ctx.database.getAppliedMigrations();   // EF GetAppliedMigrations()
 *   ctx.database.generateCreateScript();         // EF GenerateCreateScript()
 */
class DatabaseFacade {
    constructor(context) {
        this.context = context;
    }

    /** EF: IRelationalDatabaseCreator. */
    get databaseCreator() {
        if (!this._databaseCreator) {
            this._databaseCreator = createDatabaseCreator(this.context);
        }
        return this._databaseCreator;
    }

    /** EF: IHistoryRepository. */
    get historyRepository() {
        if (!this._historyRepository) {
            this._historyRepository = createHistoryRepository(this.context, {
                databaseCreator: this.databaseCreator,
                productVersion: PRODUCT_VERSION,
            });
        }
        return this._historyRepository;
    }

    /**
     * Ensure the database exists and, when it holds no tables, create every table
     * in the model. Returns true when anything was created (EF: EnsureCreated).
     *
     * This does NOT use migrations and never alters an existing table. Use it for
     * tests, prototypes and throwaway databases; use migrations for a database
     * whose schema has to evolve.
     */
    async ensureCreated() {
        await this._ready();
        return this.databaseCreator.ensureCreated();
    }

    /** Drop the database when it exists; true when it was dropped (EF: EnsureDeleted). */
    async ensureDeleted() {
        await this._ready();
        return this.databaseCreator.ensureDeleted();
    }

    /** Does the database contain any tables? (EF: IRelationalDatabaseCreator.HasTables) */
    async hasTables() {
        await this._ready();
        return this.databaseCreator.hasTables();
    }

    /** Is the database reachable? (EF: CanConnect) */
    async canConnect() {
        await this._ready();
        return this.databaseCreator.canConnect();
    }

    /** The DDL that ensureCreated() would run (EF: GenerateCreateScript). */
    async generateCreateScript() {
        await this._ready();
        return this.databaseCreator.generateCreateScript();
    }

    /**
     * EF's Migrator — the planner behind getMigrations/getPendingMigrations.
     * `migrationsPath` defaults to the working directory; pass one when the app
     * runs from somewhere other than the project root.
     */
    migrator(options = {}) {
        return new Migrator({ historyRepository: this.historyRepository, ...options });
    }

    /** Every migration on disk, oldest first (EF: GetMigrations). */
    getMigrations(options = {}) {
        return this.migrator(options).getMigrations();
    }

    /**
     * Migrations on disk that the database has NOT recorded as applied
     * (EF: GetPendingMigrations). A useful startup/health check: a non-empty
     * result means the schema is behind the code.
     */
    async getPendingMigrations(options = {}) {
        await this._ready();
        return this.migrator(options).getPendingMigrations();
    }

    /**
     * Apply pending migrations to the database (EF: `context.Database.Migrate()`).
     *
     *   await ctx.database.migrate();      // apply everything pending
     *   await ctx.database.migrate('0');   // revert everything
     *
     * The snapshot and migration files are discovered from the working directory;
     * pass `{ snapshot, files }` when the app runs from somewhere else. This is the
     * same Migrator the `masterrecord update-database` CLI runs.
     */
    async migrate(targetMigration = null, options = {}) {
        await this._ready();
        const { default: MigrationsAssembly } = await import('./MigrationsAssembly.js');
        const resolved = { ...options };

        if (!resolved.snapshot) {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const { globSync } = await import('glob');
            const cwd = options.migrationsPath || process.cwd();
            const name = String(this.context.constructor?.name || '').toLowerCase();
            const hits = globSync(`**/*${name}_contextSnapShot.json`, {
                cwd, dot: true, windowsPathsNoEscape: true, nocase: true, ignore: ['**/node_modules/**'],
            });
            if (!hits.length) {
                throw new Error(
                    `masterrecord: could not find '${name}_contextSnapShot.json' under '${cwd}'. `
                    + `Run 'masterrecord enable-migrations ${name}' first, or pass { snapshot, files } to migrate().`);
            }
            const snapshotFile = path.resolve(cwd, hits[0]);
            resolved.snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            if (!resolved.files) {
                const dir = path.dirname(snapshotFile);
                resolved.files = globSync('**/*_migration.js', { cwd: dir, dot: true, windowsPathsNoEscape: true })
                    .map(f => path.resolve(dir, f));
            }
        }

        const migrator = new Migrator({
            context: this.context,
            contextCtor: this.context.constructor,
            snapshot: resolved.snapshot,
            migrationsAssembly: resolved.migrationsAssembly || new MigrationsAssembly({ files: resolved.files, migrationsPath: resolved.migrationsPath }),
            historyRepository: this.historyRepository,
            databaseCreator: this.databaseCreator,
            logger: resolved.logger,
        });
        return migrator.migrate(targetMigration);
    }

    /** Migration ids recorded as applied, oldest first (EF: GetAppliedMigrations). */
    async getAppliedMigrations() {
        await this._ready();
        const rows = await this.historyRepository.getAppliedMigrations();
        return rows.map(r => r.migrationId);
    }

    /** The full history rows — id, product version and applied timestamp. */
    async getAppliedMigrationRows() {
        await this._ready();
        return this.historyRepository.getAppliedMigrations();
    }

    /**
     * Record a migration as applied WITHOUT running it — EF's documented way to
     * bring an existing database under migration control (baselining): the
     * schema is already there, so only the history row is missing.
     */
    async baseline(migrationId) {
        await this._ready();
        if (!migrationId) throw new Error('masterrecord: baseline(migrationId) requires a migration id.');
        const applied = new Set(await this.getAppliedMigrations());
        if (applied.has(migrationId)) return false;
        await this.historyRepository.recordApplied(migrationId, PRODUCT_VERSION);
        return true;
    }

    /** The SQL that would record `migrationId` as applied (EF: GetInsertScript). */
    getBaselineScript(migrationId) {
        return this.historyRepository.getInsertScript(new HistoryRow(migrationId, PRODUCT_VERSION, new Date().toISOString()));
    }

    async _ready() {
        if (this.context && this.context._initPromise) {
            try { await this.context._initPromise; } catch (_) { /* provider reports it on first use */ }
        }
        if (this.context && typeof this.context._ensureReady === 'function') {
            await this.context._ensureReady();
        }
    }
}

export default DatabaseFacade;
export { DatabaseFacade, PRODUCT_VERSION };
