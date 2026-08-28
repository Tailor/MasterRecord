// Ported from Entity Framework Core (dotnet/efcore, MIT) —
// Storage/RelationalDatabaseCreator.cs and the provider implementations
// (SqliteDatabaseCreator, SqlServerDatabaseCreator, NpgsqlDatabaseCreator).
// See THIRD-PARTY-NOTICES.md.

import fs from 'node:fs';

// The schema layer imports context.js, so importing it here at module scope would
// close a cycle (context -> DatabaseFacade -> creator -> schema -> context) and
// leave context.js half-initialized. It is loaded on demand instead, which also
// keeps the migrations stack (pg, mysql2) out of the runtime graph until used.
let _schemaCtor = null;
let _queryBuilders = null;

async function loadSchema() {
    if (!_schemaCtor) { _schemaCtor = (await import('./schema.js')).default; }
    return _schemaCtor;
}

async function loadQueryBuilders() {
    if (!_queryBuilders) {
        const [sqlite, mysql, postgres] = await Promise.all([
            import('./migrationSQLiteQuery.js'),
            import('./migrationMySQLQuery.js'),
            import('./migrationPostgresQuery.js'),
        ]);
        _queryBuilders = { sqlite: sqlite.default, mysql: mysql.default, postgres: postgres.default };
    }
    return _queryBuilders;
}

/**
 * Creates and drops databases and their schema (EF `RelationalDatabaseCreator`).
 *
 * `ensureCreated()` is the cold-start primitive: it creates the database and,
 * when the database has NO tables at all, every table in the model. It does not
 * use migrations, and — exactly as in EF — a database created this way is not
 * expected to be updated by migrations afterwards. It never alters an existing
 * table: if the database already has any table, it does nothing.
 */
class RelationalDatabaseCreator {
    /**
     * @param {{context: object}} dependencies
     */
    constructor(dependencies) {
        this.dependencies = dependencies;
    }

    get context() { return this.dependencies.context; }

    /** A schema layer bound to the EXISTING context (no second connection). */
    async getSchema() {
        if (!this._schema) {
            const schema = await loadSchema();
            const s = Object.create(schema.prototype);
            s.context = this.context;
            s._dbEnsured = false;
            s._ready = true;
            this._schema = s;
        }
        return this._schema;
    }

    /** The entity definitions that map to tables (TPH derived types share a table). */
    get model() {
        return (this.context.__entities || []).filter(e => e && e.__name);
    }

    /** Does the database exist? (EF: Exists) */
    async exists() { throw new Error('masterrecord: RelationalDatabaseCreator.exists must be implemented by a provider.'); }

    /** Create the database, without any tables (EF: Create). */
    async create() { throw new Error('masterrecord: RelationalDatabaseCreator.create must be implemented by a provider.'); }

    /** Drop the database (EF: Delete). */
    async delete() { throw new Error('masterrecord: RelationalDatabaseCreator.delete must be implemented by a provider.'); }

    /** Does the database contain ANY tables? (EF: HasTables) */
    async hasTables() { throw new Error('masterrecord: RelationalDatabaseCreator.hasTables must be implemented by a provider.'); }

    /**
     * Create every table in the model (EF: CreateTables — the model diffed
     * against an empty database).
     */
    async createTables() {
        const schema = await this.getSchema();
        const created = [];
        for (const entity of this.model) {
            await schema.createTable(entity);
            created.push(entity.__name);
        }
        if (typeof schema.finalize === 'function') {
            await schema.finalize();
        }
        return created;
    }

    /**
     * Ensure the database exists and, when it has no tables, that the model's
     * tables exist. Returns true when anything was created (EF: EnsureCreated).
     */
    async ensureCreated() {
        let operationsPerformed = false;
        if (!(await this.exists())) {
            await this.create();
            await this.createTables();
            operationsPerformed = true;
        } else if (!(await this.hasTables())) {
            await this.createTables();
            operationsPerformed = true;
        }
        return operationsPerformed;
    }

    /** Drop the database when it exists; true when it was dropped (EF: EnsureDeleted). */
    async ensureDeleted() {
        if (await this.exists()) {
            await this.delete();
            return true;
        }
        return false;
    }

    /** The DDL that ensureCreated would run, as a script (EF: GenerateCreateScript). */
    async generateCreateScript() {
        const builder = await this._queryBuilder();
        const schema = await this.getSchema();
        const statements = [];
        for (const entity of this.model) {
            if (typeof schema._foreignKeysFor === 'function') {
                try {
                    Object.defineProperty(entity, '__foreignKeys', {
                        value: schema._foreignKeysFor(entity),
                        enumerable: false, writable: true, configurable: true,
                    });
                } catch (_) { /* definition already carries them */ }
            }
            statements.push(builder.createTable(entity));
        }
        return statements.join('\n') + (statements.length ? '\n' : '');
    }

    /** True when the database is reachable (EF: CanConnect). */
    async canConnect() {
        try {
            return await this.exists();
        } catch (_) {
            return false;
        }
    }

    async _queryBuilder() {
        const b = await loadQueryBuilders();
        if (this.context.isSQLite) return new b.sqlite();
        if (this.context.isMySQL) return new b.mysql();
        return new b.postgres();
    }

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

/** EF: SqliteDatabaseCreator. */
class SqliteDatabaseCreator extends RelationalDatabaseCreator {
    /**
     * The database file, or null for an in-memory database. Resolved once and
     * remembered: delete() closes the connection, after which the engine can no
     * longer report its path, and exists() must still answer about the same file.
     */
    get dataSource() {
        if (this._dataSource !== undefined) return this._dataSource;
        const engine = this.context._SQLEngine;
        const name = engine && engine.db && engine.db.name ? engine.db.name : null;
        const conn = this.context._dbConfig && this.context._dbConfig.connection;
        this._dataSource = name || (typeof conn === 'string' ? conn : null);
        return this._dataSource;
    }

    /** Only an explicit in-memory database — an unknown path is NOT "in memory". */
    get isMemory() {
        const src = this.dataSource;
        return src === ':memory:' || (typeof src === 'string' && src.includes('mode=memory'));
    }

    async exists() {
        if (this.isMemory) return true;
        const src = this.dataSource;
        return src ? fs.existsSync(src) : false;
    }

    async create() {
        // Opening the connection creates the file; masterrecord opens it when the
        // context is constructed, so there is nothing further to do.
        return undefined;
    }

    async hasTables() {
        const count = await this._executeScalar(
            `SELECT COUNT(*) FROM "sqlite_master" WHERE "type" = 'table' AND "rootpage" IS NOT NULL`);
        return Number(count) !== 0;
    }

    async delete() {
        const path = this.dataSource;
        if (this.isMemory || !path) return;
        try { await this.context.close(); } catch (_) { /* already closed */ }
        if (fs.existsSync(path)) fs.rmSync(path);
        for (const suffix of ['-wal', '-shm']) {
            if (fs.existsSync(path + suffix)) fs.rmSync(path + suffix);
        }
    }
}

/** EF: SqlServerDatabaseCreator, adapted to MySQL. */
class MySqlDatabaseCreator extends RelationalDatabaseCreator {
    get databaseName() {
        return this.context._dbConfig && this.context._dbConfig.database;
    }

    async exists() {
        const rows = await this._executeRows(
            `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${String(this.databaseName).replace(/'/g, "''")}'`);
        return !!(rows && rows.length);
    }

    async create() {
        const schema = await this.getSchema();
        await schema._createDatabaseFromConfig();
    }

    async hasTables() {
        const count = await this._executeScalar(
            `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()`);
        return Number(count) !== 0;
    }

    async delete() {
        await this.context._execute(`DROP DATABASE IF EXISTS \`${this.databaseName}\``);
    }
}

/** EF: NpgsqlDatabaseCreator. */
class PostgresDatabaseCreator extends RelationalDatabaseCreator {
    get databaseName() {
        return this.context._dbConfig && this.context._dbConfig.database;
    }

    async exists() {
        const rows = await this._executeRows(
            `SELECT 1 FROM pg_database WHERE datname = '${String(this.databaseName).replace(/'/g, "''")}'`);
        return !!(rows && rows.length);
    }

    async create() {
        const schema = await this.getSchema();
        if (typeof schema._createPostgresDatabaseFromConfig === 'function') {
            await schema._createPostgresDatabaseFromConfig();
        }
    }

    async hasTables() {
        const count = await this._executeScalar(
            `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema()`);
        return Number(count) !== 0;
    }

    async delete() {
        await this.context._execute(`DROP DATABASE IF EXISTS "${this.databaseName}"`);
    }
}

/** Resolve the database creator for a context's provider. */
function createDatabaseCreator(context, options = {}) {
    const dependencies = { context, ...options };
    if (context.isSQLite) return new SqliteDatabaseCreator(dependencies);
    if (context.isMySQL) return new MySqlDatabaseCreator(dependencies);
    if (context.isPostgres) return new PostgresDatabaseCreator(dependencies);
    throw new Error('masterrecord: no database creator for this provider (expected sqlite, mysql or postgres).');
}

export default RelationalDatabaseCreator;
export {
    RelationalDatabaseCreator,
    SqliteDatabaseCreator,
    MySqlDatabaseCreator,
    PostgresDatabaseCreator,
    createDatabaseCreator,
};
