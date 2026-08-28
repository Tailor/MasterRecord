// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Extensions/RelationalDatabaseFacadeExtensions.cs and Infrastructure/DatabaseFacade.cs.
// See THIRD-PARTY-NOTICES.md.

import { createRequire } from 'node:module';
import { createDatabaseCreator } from './RelationalDatabaseCreator.js';
import { createHistoryRepository } from './HistoryRepository.js';
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
