// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Migrations/HistoryRepository.cs and the provider implementations
// (SqliteHistoryRepository, SqlServerHistoryRepository, NpgsqlHistoryRepository).
// See THIRD-PARTY-NOTICES.md.

import HistoryRow from './HistoryRow.js';
import { compareMigrationIds } from './migrationId.js';

/** Quote a string as a SQL literal (EF: ITypeMappingSource.GenerateSqlLiteral for string). */
function generateSqlLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The Migrations history table — the record of which migrations have been
 * applied to a database (EF `HistoryRepository`, whose table is
 * `__EFMigrationsHistory`).
 *
 * masterrecord's table is `_masterrecord_migrations` and has carried
 * (migration_name, applied_at) since migrations tracking was introduced, so
 * those are the defaults here; `product_version` (EF's ProductVersion) is added
 * to the table when missing. Every name is an overridable property, exactly as
 * in EF, so a provider or an app can rename them.
 */
class HistoryRepository {
    static DefaultTableName = '_masterrecord_migrations';

    /**
     * @param {{context: object, databaseCreator?: object, tableName?: string, productVersion?: string}} dependencies
     */
    constructor(dependencies) {
        this.dependencies = dependencies;
        this.tableName = dependencies.tableName || HistoryRepository.DefaultTableName;
        this._productVersionColumnChecked = false;
    }

    get context() { return this.dependencies.context; }
    get databaseCreator() { return this.dependencies.databaseCreator; }
    get productVersion() { return this.dependencies.productVersion || null; }

    get migrationIdColumnName() { return 'migration_name'; }
    get productVersionColumnName() { return 'product_version'; }
    get appliedAtColumnName() { return 'applied_at'; }

    /** Quote an identifier for this provider (EF: ISqlGenerationHelper.DelimitIdentifier). */
    delimitIdentifier(_name) { throw new Error('masterrecord: HistoryRepository.delimitIdentifier must be implemented by a provider.'); }

    /** SQL that reports whether the history table exists (EF: ExistsSql). */
    get existsSql() { throw new Error('masterrecord: HistoryRepository.existsSql must be implemented by a provider.'); }

    /** Interpret the scalar returned by existsSql (EF: InterpretExistsResult). */
    interpretExistsResult(value) {
        if (value === null || value === undefined) return false;
        const n = typeof value === 'object' ? Object.values(value)[0] : value;
        return Number(n) !== 0;
    }

    /** DDL that creates the history table (EF: GetCreateScript). */
    getCreateScript() { throw new Error('masterrecord: HistoryRepository.getCreateScript must be implemented by a provider.'); }

    /** DDL that creates the history table only when it is absent (EF: GetCreateIfNotExistsScript). */
    getCreateIfNotExistsScript() {
        const script = this.getCreateScript();
        return script.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS');
    }

    /** Does the history table exist? (EF: Exists) */
    async exists() {
        if (this.databaseCreator && !(await this.databaseCreator.exists())) return false;
        try {
            return this.interpretExistsResult(await this._executeScalar(this.existsSql));
        } catch (_) {
            return false;
        }
    }

    /** Create the history table (EF: Create). */
    async create() {
        await this.context._execute(this.getCreateScript());
        await this._ensureProductVersionColumn();
    }

    /** Create the history table when it is absent; true when it was created (EF: CreateIfNotExists). */
    async createIfNotExists() {
        const existed = await this.exists();
        await this.context._execute(this.getCreateIfNotExistsScript());
        await this._ensureProductVersionColumn();
        return !existed;
    }

    /**
     * The migrations recorded as applied, ordered by id (EF: GetAppliedMigrations).
     * Reads every column so a table written by an earlier masterrecord (which had
     * no product_version) still materializes.
     */
    async getAppliedMigrations() {
        const rows = [];
        if (!(await this.exists())) return rows;
        const result = await this._executeRows(this.getAppliedMigrationsSql);
        for (const r of (result || [])) {
            if (!r) continue;
            const id = r[this.migrationIdColumnName];
            if (id === undefined || id === null) continue;
            rows.push(new HistoryRow(id, r[this.productVersionColumnName] ?? null, r[this.appliedAtColumnName] ?? null));
        }
        // The SQL ORDER BY is lexicographic; migration ids are epoch milliseconds,
        // so '900_A' must still come before '1000_B'. Order them the same way
        // MigrationsAssembly orders the files on disk.
        rows.sort((x, y) => compareMigrationIds(x.migrationId, y.migrationId));
        return rows;
    }

    /** SQL that reads the applied migrations (EF: GetAppliedMigrationsSql). */
    get getAppliedMigrationsSql() {
        return `SELECT * FROM ${this.delimitIdentifier(this.tableName)} ORDER BY ${this.delimitIdentifier(this.migrationIdColumnName)}`;
    }

    /** SQL that records a migration as applied (EF: GetInsertScript). */
    getInsertScript(row) {
        const appliedAt = row.appliedAt || new Date().toISOString();
        return `INSERT INTO ${this.delimitIdentifier(this.tableName)} `
            + `(${this.delimitIdentifier(this.migrationIdColumnName)}, `
            + `${this.delimitIdentifier(this.productVersionColumnName)}, `
            + `${this.delimitIdentifier(this.appliedAtColumnName)}) VALUES (`
            + `${generateSqlLiteral(row.migrationId)}, `
            + `${row.productVersion === null || row.productVersion === undefined ? 'NULL' : generateSqlLiteral(row.productVersion)}, `
            + `${generateSqlLiteral(appliedAt)})`;
    }

    /** SQL that removes a migration's history row (EF: GetDeleteScript). */
    getDeleteScript(migrationId) {
        return `DELETE FROM ${this.delimitIdentifier(this.tableName)} `
            + `WHERE ${this.delimitIdentifier(this.migrationIdColumnName)} = ${generateSqlLiteral(migrationId)}`;
    }

    /** Record a migration as applied. */
    async recordApplied(migrationId, productVersion = this.productVersion) {
        await this.createIfNotExists();
        await this.context._execute(this.getInsertScript(new HistoryRow(migrationId, productVersion, new Date().toISOString())));
    }

    /** Remove a migration's history row. */
    async recordReverted(migrationId) {
        await this.context._execute(this.getDeleteScript(migrationId));
    }

    // EF's conditional-DDL hooks for idempotent scripts. Providers that cannot
    // express "run this only if the migration is absent" throw, exactly as EF's
    // SQLite provider does.
    getBeginIfNotExistsScript(_migrationId) { throw new Error('masterrecord: idempotent migration scripts are not supported by this provider.'); }
    getBeginIfExistsScript(_migrationId) { throw new Error('masterrecord: idempotent migration scripts are not supported by this provider.'); }
    getEndIfScript() { throw new Error('masterrecord: idempotent migration scripts are not supported by this provider.'); }

    /**
     * Add `product_version` to a history table created by an older masterrecord.
     * A nullable ADD COLUMN is safe on every supported engine and runs once.
     */
    async _ensureProductVersionColumn() {
        if (this._productVersionColumnChecked) return;
        this._productVersionColumnChecked = true;
        const col = this.delimitIdentifier(this.productVersionColumnName);
        const table = this.delimitIdentifier(this.tableName);
        try {
            await this._executeRows(`SELECT ${col} FROM ${table} LIMIT 1`);
        } catch (_) {
            try {
                await this.context._execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${this.productVersionColumnType}`);
            } catch (_e) { /* raced with another process, or unsupported — history still works without it */ }
        }
    }

    get productVersionColumnType() { return 'VARCHAR(32)'; }

    // ---- execution helpers (masterrecord engines) --------------------------

    async _executeRows(sql) {
        const ctx = this.context;
        const engine = ctx._SQLEngine;
        if (ctx.isSQLite) return engine.db.prepare(sql).all();
        if (ctx.isMySQL) return await engine._runWithParams(sql, []);
        const r = await engine._runWithParams(sql, []);
        return r && r.rows ? r.rows : [];
    }

    async _executeScalar(sql) {
        const rows = await this._executeRows(sql);
        if (!rows || !rows.length) return null;
        const first = rows[0];
        return (first && typeof first === 'object') ? Object.values(first)[0] : first;
    }
}

/** EF: SqliteHistoryRepository. */
class SqliteHistoryRepository extends HistoryRepository {
    delimitIdentifier(name) { return `"${String(name).replace(/"/g, '""')}"`; }

    get existsSql() {
        return `SELECT COUNT(*) FROM "sqlite_master" WHERE "name" = ${generateSqlLiteral(this.tableName)} AND "type" = 'table'`;
    }

    get productVersionColumnType() { return 'TEXT'; }

    getCreateScript() {
        return `CREATE TABLE ${this.delimitIdentifier(this.tableName)} (`
            + `${this.delimitIdentifier(this.migrationIdColumnName)} TEXT NOT NULL PRIMARY KEY, `
            + `${this.delimitIdentifier(this.productVersionColumnName)} TEXT NULL, `
            + `${this.delimitIdentifier(this.appliedAtColumnName)} TEXT NOT NULL)`;
    }

    // EF's SQLite provider throws for these: SQLite has no conditional DDL.
    getBeginIfNotExistsScript(_migrationId) {
        throw new Error('masterrecord: SQLite does not support idempotent migration scripts (no conditional DDL). Generate a plain script instead.');
    }
    getBeginIfExistsScript(_migrationId) { return this.getBeginIfNotExistsScript(_migrationId); }
    getEndIfScript() { return this.getBeginIfNotExistsScript(''); }
}

/** EF: SqlServerHistoryRepository, adapted to MySQL. */
class MySqlHistoryRepository extends HistoryRepository {
    delimitIdentifier(name) { return `\`${String(name).replace(/`/g, '``')}\``; }

    get existsSql() {
        return `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${generateSqlLiteral(this.tableName)}`;
    }

    getCreateScript() {
        return `CREATE TABLE ${this.delimitIdentifier(this.tableName)} (`
            + `${this.delimitIdentifier(this.migrationIdColumnName)} VARCHAR(150) NOT NULL PRIMARY KEY, `
            + `${this.delimitIdentifier(this.productVersionColumnName)} VARCHAR(32) NULL, `
            + `${this.delimitIdentifier(this.appliedAtColumnName)} VARCHAR(64) NOT NULL)`;
    }
}

/** EF: NpgsqlHistoryRepository. */
class PostgresHistoryRepository extends HistoryRepository {
    delimitIdentifier(name) { return `"${String(name).replace(/"/g, '""')}"`; }

    get existsSql() {
        return `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${generateSqlLiteral(this.tableName)}`;
    }

    getCreateScript() {
        return `CREATE TABLE ${this.delimitIdentifier(this.tableName)} (`
            + `${this.delimitIdentifier(this.migrationIdColumnName)} VARCHAR(150) NOT NULL PRIMARY KEY, `
            + `${this.delimitIdentifier(this.productVersionColumnName)} VARCHAR(32) NULL, `
            + `${this.delimitIdentifier(this.appliedAtColumnName)} VARCHAR(64) NOT NULL)`;
    }

    // Postgres can express conditional DDL with an anonymous DO block.
    getBeginIfNotExistsScript(migrationId) {
        return `DO $MR$\nBEGIN\n    IF NOT EXISTS(SELECT 1 FROM ${this.delimitIdentifier(this.tableName)} `
            + `WHERE ${this.delimitIdentifier(this.migrationIdColumnName)} = ${generateSqlLiteral(migrationId)}) THEN`;
    }
    getBeginIfExistsScript(migrationId) {
        return `DO $MR$\nBEGIN\n    IF EXISTS(SELECT 1 FROM ${this.delimitIdentifier(this.tableName)} `
            + `WHERE ${this.delimitIdentifier(this.migrationIdColumnName)} = ${generateSqlLiteral(migrationId)}) THEN`;
    }
    getEndIfScript() { return `    END IF;\nEND $MR$;\n`; }
}

/** Resolve the history repository for a context's provider. */
function createHistoryRepository(context, options = {}) {
    const dependencies = { context, ...options };
    if (context.isSQLite) return new SqliteHistoryRepository(dependencies);
    if (context.isMySQL) return new MySqlHistoryRepository(dependencies);
    if (context.isPostgres) return new PostgresHistoryRepository(dependencies);
    throw new Error('masterrecord: no history repository for this provider (expected sqlite, mysql or postgres).');
}

export default HistoryRepository;
export {
    HistoryRepository,
    SqliteHistoryRepository,
    MySqlHistoryRepository,
    PostgresHistoryRepository,
    createHistoryRepository,
    generateSqlLiteral,
};
