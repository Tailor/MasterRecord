// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Migrations/IMigrationsAssembly.cs and MigrationsAssemblyExtensions.cs.
// See THIRD-PARTY-NOTICES.md.

import path from 'node:path';
import { globSync } from 'glob';
import { INITIAL_DATABASE, timestampOf, compareMigrationIds } from './migrationId.js';

/**
 * The set of migrations available to a context (EF `IMigrationsAssembly`).
 *
 * EF discovers migration classes in a compiled assembly and keys them by
 * MigrationId; masterrecord's migrations are `<timestamp>_<Name>_migration.js`
 * files on disk, and the history table records the FILE NAME, so that is the id.
 */
class MigrationsAssembly {
    /**
     * @param {{migrationsPath?: string, files?: string[]}} [options]
     *   `files` lets a caller supply the list directly (used by tests and by the
     *   CLI, which has already resolved the migrations directory from the snapshot).
     */
    constructor(options = {}) {
        this.options = options;
        this._migrations = null;
    }

    static timestampOf(id) { return timestampOf(id); }
    static compareIds(a, b) { return compareMigrationIds(a, b); }

    /** Every migration id, oldest first (EF: IMigrationsAssembly.Migrations.Keys). */
    get migrations() {
        if (this._migrations) return this._migrations;
        let files = this.options.files;
        if (!files) {
            const cwd = this.options.migrationsPath || process.cwd();
            files = globSync('**/*_migration.js', {
                cwd, dot: true, windowsPathsNoEscape: true, ignore: ['**/node_modules/**'],
            }).map(f => path.resolve(cwd, f));
        }
        const byId = new Map();
        for (const file of files) {
            byId.set(path.basename(file), file);
        }
        this._migrations = new Map(
            [...byId.entries()].sort((a, b) => MigrationsAssembly.compareIds(a[0], b[0])));
        return this._migrations;
    }

    /** Ids only, oldest first. */
    get migrationIds() { return [...this.migrations.keys()]; }

    /**
     * Resolve a full migration id from a full id, a file name, or the bare
     * migration name (EF: MigrationsAssemblyExtensions.GetMigrationId).
     */
    getMigrationId(nameOrId) {
        if (!nameOrId) throw new Error('masterrecord: a migration name is required.');
        const wanted = String(nameOrId);
        if (wanted === INITIAL_DATABASE) return wanted;

        const ids = this.migrationIds;
        const exact = ids.find(id => id.toLowerCase() === wanted.toLowerCase());
        if (exact) return exact;

        // `1700000000000_AddPosts_migration.js` also answers to `AddPosts`.
        const nameOf = (id) => {
            const m = /^\d+_(.+?)_migration\.js$/.exec(id);
            return m ? m[1] : id.replace(/\.js$/, '');
        };
        const byName = ids.filter(id => nameOf(id).toLowerCase() === wanted.toLowerCase());
        if (byName.length === 1) return byName[0];
        if (byName.length > 1) {
            throw new Error(`masterrecord: '${wanted}' matches more than one migration (${byName.join(', ')}). Use the full migration id.`);
        }
        throw new Error(`masterrecord: no migration named '${wanted}' was found. Known migrations: ${ids.length ? ids.join(', ') : '(none)'}`);
    }

    /** The file backing a migration id. */
    getMigrationFile(id) { return this.migrations.get(id) || null; }
}

export default MigrationsAssembly;
export { MigrationsAssembly };
