// Version 0.1.0 - Complete PostgreSQL implementation with pg 8.16.3
import tools from './Tools.js';
import FieldTransformer from './Entity/fieldTransformer.js';
import { logCommand } from './logging.js';
import pg from 'pg';

const { Pool } = pg;

class postgresEngine {

    constructor() {
        this.pool = null;
        this.db = null;
        this.dbType = 'postgres';
        this.unsupportedWords = ["order"];
        // Holds a dedicated pooled client while a transaction is open so every
        // statement in saveChanges() runs on the same client (BEGIN..COMMIT).
        this._txnClient = null;
    }

    /**
     * Quote a Postgres identifier (table or column name).
     *
     * Postgres folds unquoted identifiers to lowercase, so `SELECT id FROM Foo`
     * becomes `SELECT id FROM foo` at parse time. For CamelCase entities like
     * `Agent`, `SchedulerLeader`, `MemoryDoc` the DDL creates the table with
     * preserved case (because masterrecord's DDL quotes), but unquoted SELECTs
     * fail with `relation "schedulerleader" does not exist`.
     *
     * This helper wraps every identifier in double-quotes and escapes any
     * embedded double-quotes per the Postgres standard (`"` → `""`).
     *
     * Safe for `*` (returns `*` unwrapped) so `COUNT(alias.*)` still works.
     */
    _q(ident) {
        if (ident === '*') return '*';
        if (ident === null || ident === undefined) return ident;
        const s = String(ident);
        // Already-quoted identifiers pass through unchanged.
        if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s;
        return `"${s.replace(/"/g, '""')}"`;
    }

    /**
     * Initialize PostgreSQL connection pool
     * @param {Object} config - PostgreSQL connection config
     */
    async initialize(config) {
        this.pool = new Pool({
            host: config.host || 'localhost',
            port: config.port || 5432,
            database: config.database,
            user: config.user,
            password: config.password,
            max: config.max || 20,
            idleTimeoutMillis: config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
        });

        // Test connection
        try {
            const client = await this.pool.connect();
            console.log('PostgreSQL connected successfully');
            client.release();
        } catch (err) {
            console.error('PostgreSQL connection error:', err);
            throw err;
        }
    }

    /**
     * UPDATE with parameterized query
     */
    async update(query) {
        // Security: ONLY use parameterized queries - no fallback to string concatenation
        // query.arg must contain {query, params} from _buildSQLEqualToParameterized
        if (!query.arg || typeof query.arg !== 'object' || !query.arg.query || !query.arg.params) {
            throw new Error('UPDATE failed: Invalid parameterized query structure. Check entity definition.');
        }

        const t = this._q(query.tableName);
        const pk = this._q(query.primaryKey);
        // Optimistic concurrency: bump a rowVersion column atomically and add
        // each concurrency token's ORIGINAL value to the WHERE (see SQLite
        // engine). Positional parameters continue from the SET params.
        let setSql = query.arg.query;
        if (query.rowVersionColumn) {
            const rv = this._q(query.rowVersionColumn);
            setSql += `, ${rv} = ${rv} + 1`;
        }
        const params = [...query.arg.params, query.primaryKeyValue];
        let where = `${t}.${pk} = $${params.length}`;
        for (const c of (query.concurrency || [])) {
            if (c.value === null || c.value === undefined) { where += ` AND ${t}.${this._q(c.column)} IS NULL`; }
            else { params.push(c.value); where += ` AND ${t}.${this._q(c.column)} = $${params.length}`; }
        }
        const sqlQuery = `UPDATE ${t} SET ${setSql} WHERE ${where}`;
        return await this._runWithParams(sqlQuery, params);
    }

    // ---- Command observation (EF IDbCommandInterceptor / CommandExecuted) ----
    addCommandObserver(fn){ (this.__commandObservers ||= new Set()).add(fn); }
    removeCommandObserver(fn){ if (this.__commandObservers) this.__commandObservers.delete(fn); }
    _notifyCommand(info){
        logCommand(info);
        if (!this.__commandObservers || this.__commandObservers.size === 0) return;
        for (const fn of Array.from(this.__commandObservers)) {
            try { fn(info); } catch (e) { console.error('[PostgreSQL] command observer threw:', e); }
        }
    }

    /** Rows matched by the last UPDATE/DELETE (pg Result.rowCount). */
    /** Connection probe (context.healthCheck()): never throws. */
    async healthCheck(){
        try {
            if (!this.pool) return { healthy: false, error: 'Not connected' };
            const res = await this._runWithParams('SELECT NOW() AS time, version() AS version', []);
            const row = res && res.rows ? res.rows[0] : undefined;
            return { healthy: true, serverTime: row ? row.time : undefined, version: row ? row.version : undefined, poolSize: this.pool.totalCount, idleCount: this.pool.idleCount, waitingCount: this.pool.waitingCount };
        } catch (err) {
            return { healthy: false, error: err.message };
        }
    }

    affectedRows(result){
        if (!result) return 0;
        if (typeof result.rowCount === 'number') return result.rowCount;
        return 0;
    }

    // ---- Set-based writes from a compiled query (EF ExecuteUpdate / ExecuteDelete) ----
    // The compiled WHERE already holds $1..$n; SET parameters continue from n+1
    // (Postgres placeholders are numbered, not positional, so text order is free).

    async executeUpdate(query, entity, setters){
        const alias = this.getEntity(entity.__name, query.entityMap) || entity.__name;
        const whereSql = `${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`.trim();
        const whereParams = query.parameters ? query.parameters.getParams() : [];
        const params = [...whereParams];
        const setParts = [];
        for (const s of setters) {
            if (s.raw !== undefined) { setParts.push(`${this._q(s.column)} = ${s.raw}`); }
            else { params.push(s.value); setParts.push(`${this._q(s.column)} = $${params.length}`); }
        }
        const sql = `UPDATE ${this._q(entity.__name)} AS ${alias} SET ${setParts.join(', ')} ${whereSql}`;
        return this.affectedRows(await this._runWithParams(sql, params));
    }

    async executeDelete(query, entity){
        const alias = this.getEntity(entity.__name, query.entityMap) || entity.__name;
        const whereSql = `${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`.trim();
        const whereParams = query.parameters ? query.parameters.getParams() : [];
        const sql = `DELETE FROM ${this._q(entity.__name)} AS ${alias} ${whereSql}`;
        return this.affectedRows(await this._runWithParams(sql, whereParams));
    }

    /** Scalar aggregate over the query's rows (EF Sum/Average/Min/Max): fn in SUM|AVG|MIN|MAX. */
    /** EF GroupBy + aggregates (see SQLite engine for the contract). Positional params continue after the WHERE's. */
    async getGrouped(queryObject, entity, groups, aggs, having, orderBy){
        const q = queryObject.script;
        const alias = this.getEntity(entity.__name, q.entityMap) || entity.__name;
        const qi = (n) => this._q(n);
        const sel = [
            ...groups.map(g => `${alias}.${qi(g.column)} AS ${qi(g.column)}`),
            // COUNT is bigint on Postgres; cast it to int so the driver returns a number
            // (EF/Npgsql does the same). SUM/AVG must NOT be cast — they can be fractional.
            ...aggs.map(a => `${a.fn}(${a.column ? `${alias}.${qi(a.column)}` : '*'})${a.fn === 'COUNT' ? '::int' : ''} AS ${qi(a.alias)}`),
        ].join(', ');
        const params = q.parameters ? [...q.parameters.getParams()] : [];
        let sql = `SELECT ${sel} ${this.buildFrom(q, entity)} ${this.buildWhere(q, entity)} ${this.buildAnd(q, entity)} GROUP BY ${groups.map(g => `${alias}.${qi(g.column)}`).join(', ')}`;
        if (having && having.length) {
            sql += ' HAVING ' + having.map(h => { params.push(h.value); return `${h.agg.fn}(${h.agg.column ? `${alias}.${qi(h.agg.column)}` : '*'}) ${h.op} $${params.length}`; }).join(' AND ');
        }
        sql += (orderBy && orderBy.length) ? ` ORDER BY ${orderBy.map(o => `${qi(o.name)}${o.desc ? ' DESC' : ' ASC'}`).join(', ')}` : ` ORDER BY ${groups.map(g => qi(g.column)).join(', ')}`;
        sql += ` ${this.buildLimit(q)} ${this.buildSkip(q)}`;
        const result = await this._runWithParams(sql, params);
        return result && result.rows ? result.rows : [];
    }

    async getAggregate(queryObject, entity, fn, column){
        const q = queryObject.script;
        const alias = this.getEntity(entity.__name, q.entityMap) || entity.__name;
        const sql = `SELECT ${fn}(${alias}.${this._q(column)}) AS value ${this.buildFrom(q, entity)} ${this.buildWhere(q, entity)} ${this.buildAnd(q, entity)}`;
        const params = q.parameters ? q.parameters.getParams() : [];
        const result = await this._runWithParams(sql, params);
        const row = result && result.rows ? result.rows[0] : null;
        return row ? row.value : null;
    }

    /**
     * DELETE with parameterized query
     */
    async delete(queryObject) {
        const sqlObject = this._buildDeleteObject(queryObject);
        const t = this._q(sqlObject.tableName);
        const pk = this._q(sqlObject.primaryKey);
        const params = [sqlObject.value];
        let where = `${t}.${pk} = $1`;
        for (const c of (queryObject.__concurrency || [])) {
            if (c.value === null || c.value === undefined) { where += ` AND ${t}.${this._q(c.column)} IS NULL`; }
            else { params.push(c.value); where += ` AND ${t}.${this._q(c.column)} = $${params.length}`; }
        }
        const sqlQuery = `DELETE FROM ${t} WHERE ${where}`;
        return await this._runWithParams(sqlQuery, params);
    }

    /**
     * INSERT with parameterized query
     * Postgres uses RETURNING to get the inserted ID
     */
    async insert(queryObject) {
        const sqlObject = this._buildSQLInsertObjectParameterized(queryObject, queryObject.__entity);
        if (sqlObject === -1) {
            throw new Error('INSERT failed: No columns to insert');
        }

        // Get primary key name for RETURNING clause
        const primaryKey = tools.getPrimaryKeyObject(queryObject.__entity);
        const query = `INSERT INTO ${this._q(sqlObject.tableName)} (${sqlObject.columns}) VALUES (${sqlObject.placeholders}) RETURNING ${this._q(primaryKey)}`;

        const result = await this._runWithParams(query, sqlObject.params);

        return {
            id: result.rows[0] ? result.rows[0][primaryKey] : undefined
        };
    }

    /**
     * Batch insert using PostgreSQL's multi-value INSERT with RETURNING
     */
    async bulkInsert(entities) {
        if (!entities || entities.length === 0) return [];

        // Build each row's SQL object up front, keeping its ORIGINAL index so
        // the returned array aligns with the input order — the contract
        // context._processBatchInserts relies on when writing ids back.
        const rows = entities.map((entity, index) => ({
            index,
            entity,
            sql: this._buildSQLInsertObjectParameterized(entity, entity.__entity),
        }));

        // One multi-value INSERT can only serve rows that share the SAME
        // column list. The builder skips unset optional columns and auto PKs,
        // so a batch can be heterogeneous; reusing the first row's columns for
        // every row produced malformed statements (or, when the counts
        // happened to match, values landing in the wrong columns). Sub-group
        // by table + exact column signature and emit one statement per group.
        // No NULL-padding to a column union — that would override DB-level
        // column defaults.
        const groups = new Map();
        for (const row of rows) {
            const key = `${row.sql.tableName} ${row.sql.columns}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }

        const results = new Array(entities.length);
        for (const group of groups.values()) {
            const first = group[0].sql;
            const primaryKey = tools.getPrimaryKeyObject(group[0].entity.__entity);

            // Renumber $n placeholders per statement (each group restarts at $1).
            const valueGroups = [];
            const allParams = [];
            let paramIndex = 1;
            for (const row of group) {
                const placeholders = row.sql.params.map(() => `$${paramIndex++}`).join(', ');
                valueGroups.push(`(${placeholders})`);
                allParams.push(...row.sql.params);
            }

            const query = `INSERT INTO ${this._q(first.tableName)} (${first.columns}) VALUES ${valueGroups.join(', ')} RETURNING ${this._q(primaryKey)}`;
            const result = await this._runWithParams(query, allParams);

            // RETURNING preserves the VALUES order within a single statement,
            // so row k of the result belongs to group[k].
            for (let i = 0; i < group.length; i++) {
                const row = result.rows[i];
                results[group[i].index] = { id: row ? row[primaryKey] : undefined };
            }
        }

        return results;
    }

    /**
     * Batch update (execute in sequence for PostgreSQL)
     */
    async bulkUpdate(updateQueries) {
        if (!updateQueries || updateQueries.length === 0) return;

        for (const query of updateQueries) {
            await this.update(query);
        }
    }

    /**
     * Batch delete using WHERE IN.
     * @param {string} tableName
     * @param {Array} ids
     * @param {string} [primaryKey='id'] - Primary-key column name. Defaults to
     *   'id' for back-compat, but callers should pass the entity's actual PK
     *   to support custom primary-key names.
     */
    async bulkDelete(tableName, ids, primaryKey = 'id') {
        if (!ids || ids.length === 0) return;

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        const query = `DELETE FROM ${this._q(tableName)} WHERE ${this._q(primaryKey)} IN (${placeholders})`;
        return await this._runWithParams(query, ids);
    }

    /**
     * SELECT single record
     */
    async get(query, entity, context) {
        try {
            let queryString;
            if (query.raw) {
                queryString = { query: query.raw, params: [] };
            } else if (typeof query === 'string') {
                queryString = { query: query, params: [] };
            } else {
                queryString = this.buildQuery(query, entity, context);
            }

            if (queryString.query) {
                const result = await this._runWithParams(queryString.query, queryString.params || []);
                return result.rows[0] || null;
            }
            return null;
        } catch (err) {
            // Loud failure: never swallow a query error into a silent null.
            const missing = tools.missingTableError(err);
            if (missing) { throw missing; }
            throw err;
        }
    }

    /**
     * SELECT COUNT
     */
    async getCount(queryObject, entity, _context) {
        const query = queryObject.script;
        try {
            let queryString;
            if (query.raw) {
                queryString = { query: query.raw, params: [] };
            } else {
                if (query.count === undefined) {
                    query.count = "none";
                }
                const _entityAlias = this.getEntity(entity.__name, query.entityMap);
                // Include buildAnd so chained .and() calls survive into the
                // COUNT SQL. Without this they were silently dropped.
                queryString = {
                    query: `SELECT ${this.buildCount(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`,
                    params: query.parameters ? query.parameters.getParams() : []
                };
            }

            if (queryString.query) {
                const result = await this._runWithParams(queryString.query, queryString.params);
                return result.rows[0] || null;
            }
            return null;
        } catch (err) {
            // Loud failure: never swallow a query error into a silent null.
            const missing = tools.missingTableError(err);
            if (missing) { throw missing; }
            throw err;
        }
    }

    /**
     * SELECT multiple records
     */
    async all(query, entity, context) {
        try {
            let selectQuery;
            if (query.raw) {
                selectQuery = { query: query.raw, params: [] };
            } else {
                selectQuery = this.buildQuery(query, entity, context);
            }

            if (selectQuery.query) {
                const result = await this._runWithParams(selectQuery.query, selectQuery.params || []);
                return result.rows || [];
            }
            return [];
        } catch (err) {
            // Loud failure: never swallow a query error into a silent empty set.
            const missing = tools.missingTableError(err);
            if (missing) { throw missing; }
            throw err;
        }
    }

    /**
     * Execute raw SQL with parameters
     */
    async exec(query, params = []) {
        return await this._runWithParams(query, params);
    }

    // Engine-agnostic raw query backing the public ctx.query()/ctx.execute().
    // Normalizes pg's result object to an array of rows for row-returning
    // statements; for writes returns the driver result.
    async query(query, params = []) {
        const result = await this._runWithParams(query, params);
        return (result && Array.isArray(result.rows)) ? result.rows : result;
    }

    /**
     * Introspection: Check if a table exists in the current Postgres schema.
     * Mirrors the SQLite/MySQL engines so migration code and the CLI's
     * migration tracker can call it uniformly across all three drivers.
     */
    async tableExists(tableName) {
        // A genuinely-absent table yields zero rows -> false. A real failure
        // (connection/permission/information_schema error) MUST throw — never
        // disguise an error as "table absent", or schema.createTable() silently
        // blind-creates (a no-op on an existing table) and skips column syncs.
        // NOTE: scoped to the connection's search_path via current_schemas();
        // a table living in a schema outside the search_path reads as absent.
        let result;
        try {
            const sql = `SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name = $1 LIMIT 1`;
            result = await this._runWithParams(sql, [tableName]);
        } catch (err) {
            throw new Error(`masterrecord: could not determine whether table '${tableName}' exists (PostgreSQL introspection failed): ${err.message}`);
        }
        return !!(result && result.rows && result.rows.length > 0);
    }

    /**
     * Introspection: Get column information for a table.
     *
     * Used by `schema.syncTable()` to diff the existing database schema
     * against the entity definition so migrations can add only the
     * missing columns. Without this method on Postgres, syncTable
     * couldn't detect existing columns and re-ran migrations failed
     * with `column "X" already exists`.
     *
     * Returns rows shaped like the SQLite/MySQL counterparts:
     *   { name, dflt_value, is_nullable, data_type }
     */
    async getTableInfo(tableName) {
        try {
            const sql = `
                SELECT
                    column_name AS name,
                    column_default AS dflt_value,
                    is_nullable AS is_nullable,
                    data_type AS data_type
                FROM information_schema.columns
                WHERE table_schema = ANY(current_schemas(false))
                  AND table_name = $1
                ORDER BY ordinal_position
            `;
            const result = await this._runWithParams(sql, [tableName]);
            return (result && result.rows) ? result.rows : [];
        } catch (err) {
            throw new Error(`masterrecord: could not read columns for table '${tableName}' (PostgreSQL introspection failed): ${err.message}`);
        }
    }

    /**
     * Build complete SELECT query with parameters
     */
    buildQuery(query, entity, _context) {
        const _entityStr = this.getEntity(entity.__name, query.entityMap);
        const params = query.parameters ? query.parameters.getParams() : [];

        // Standard SQL clause order: SELECT ... FROM ... WHERE ... AND ... ORDER BY ... LIMIT ... OFFSET ...
        // The previous order placed LIMIT/OFFSET before ORDER BY, which Postgres rejects as a syntax error.
        let selectClause = this.buildSelectString(query, entity);
        let whereClause = this.buildWhere(query, entity);
        let orderByClause = this.buildOrderBy(query, entity);

        // Postgres tsvector search bolted onto the assembled clauses.
        // Adds ts_rank as __rank, the @@ predicate, and orders by rank DESC
        // by default. Param binding happens via `_buildSearch` (it pushes
        // the term into params and returns $N placeholders).
        const fts = this._buildSearch(query, entity, params);
        if (fts) {
            selectClause = `${selectClause}, ${fts.rankSelect}`;
            if (whereClause && whereClause.trim().length > 0) {
                whereClause = `${whereClause} AND ${fts.predicate}`;
            } else {
                whereClause = `WHERE ${fts.predicate}`;
            }
            if (!orderByClause || orderByClause.trim().length === 0) {
                orderByClause = fts.defaultOrder;
            }
        }

        const sql = `SELECT ${query.distinct ? 'DISTINCT ' : ''}${selectClause} ${this.buildFrom(query, entity)} ${whereClause} ${this.buildAnd(query, entity)} ${orderByClause} ${this.buildLimit(query)} ${this.buildSkip(query)}`;

        return {
            query: sql,
            params: params
        };
    }

    /**
     * Build the Postgres tsvector search plumbing for the current query if
     * a `.search()` clause was chained. Returns null otherwise.
     *
     * Pushes the search term onto the live params array (twice — once for
     * SELECT, once for WHERE) and returns the corresponding $N placeholders
     * inline. Caller is responsible for splicing the returned fragments
     * into the right SELECT/WHERE/ORDER BY positions.
     */
    _buildSearch(query, entity, params) {
        if (!query.search) return null;
        const alias = this.getEntity(query.parentName || entity.__name, query.entityMap);
        const tsvCol = '__tsv'; // matches migrationPostgresQuery._ftsColumnName()

        // Push the search term twice with sequential $N indices.
        const baseIndex = params.length;
        params.push(query.search.query);
        params.push(query.search.query);
        const phSelect = `$${baseIndex + 1}`;
        const phWhere = `$${baseIndex + 2}`;

        return {
            rankSelect: `ts_rank(${alias}.${this._q(tsvCol)}, plainto_tsquery(${phSelect})) AS __rank`,
            predicate: `${alias}.${this._q(tsvCol)} @@ plainto_tsquery(${phWhere})`,
            defaultOrder: `ORDER BY __rank DESC`,
        };
    }

    /**
     * Build the column list after SELECT. If the user called `.select()`,
     * `query.select` is a cachedExpr object with `selectFields` (not a string)
     * — the previous implementation returned the object directly, which
     * stringified to "[object Object]" and broke the query.
     */
    buildSelectString(query, entity) {
        if (query.select && query.select.selectFields && query.select.selectFields.length > 0) {
            const alias = this.getEntity(query.parentName || entity.__name, query.entityMap);
            // Alias is a generated short string (e.g. "a", "p") so does not need quoting,
            // but the user-defined column names CAN be camelCase and MUST be quoted.
            return query.select.selectFields.map(f => `${alias}.${this._q(f)}`).join(', ');
        }
        // Fall back to a fully-qualified column list quoted per-identifier.
        // tools.convertEntityToSelectParameterString returns "alias.col, alias.col"
        // built off entity field names; rebuild it here with quoting since the
        // helper itself is engine-agnostic and can't know our quoting rules.
        const alias = this.getEntity(entity.__name, query.entityMap);
        const cols = [];
        for (const key in entity) {
            if (key.startsWith('_')) continue;
            const def = entity[key];
            if (!def || typeof def !== 'object') continue;
            if (def.type === 'hasMany' || def.type === 'hasOne' || def.type === 'hasManyThrough') continue;
            if (def.lifecycle === true) continue;
            // Use foreignKey for belongsTo, otherwise the column's declared name.
            const colName = (def.relationshipType === 'belongsTo' && def.foreignKey)
                ? def.foreignKey
                : def.name;
            if (!colName) continue;
            cols.push(`${alias}.${this._q(colName)}`);
        }
        return cols.join(', ');
    }

    /**
     * Postgres `count(*)` is bigint (int8), and node-postgres returns int8 as a STRING
     * so a value beyond 2^53 cannot silently lose precision. Un-cast, that made count()
     * engine-dependent — `n === 0` was never true here but was on SQLite.
     *
     * Cast in SQL rather than coercing in JS, which is how EF Core's Npgsql provider
     * translates `Queryable.Count()`: it emits `count(*)::int` so the driver returns a
     * native 32-bit integer. (EF's `Count()` is likewise an int32; it offers
     * `LongCount()` for tables past ~2.1 billion rows, where this cast would overflow.)
     */
    buildCount(query, entity) {
        const entityStr = this.getEntity(entity.__name, query.entityMap);
        if (query.count === "none") {
            // `alias.*` is not standard Postgres syntax — use COUNT(*) instead.
            return `COUNT(*)::int`;
        }
        // query.count is a cachedExpr with selectFields when set via `.count(p => p.field)`.
        let field;
        if (query.count && query.count.selectFields && query.count.selectFields[0]) {
            field = query.count.selectFields[0];
        } else if (typeof query.count === 'string') {
            field = query.count;
        }
        if (!field) return `COUNT(*)::int`;
        return `COUNT(${entityStr}.${this._q(field)})::int`;
    }

    buildFrom(query, entity) {
        // Quote the table name AND alias the table so downstream
        // `alias.column` references in SELECT/WHERE/ORDER BY resolve against
        // the alias rather than the bare CamelCase name.
        const alias = this.getEntity(entity.__name, query.entityMap);
        if (alias && alias !== entity.__name) {
            return `FROM ${this._q(entity.__name)} AS ${alias}`;
        }
        return `FROM ${this._q(entity.__name)}`;
    }

    /**
     * Build AND clause with placeholder detection
     */
    buildAnd(query, mainQuery) {
        const andEntity = query.and;
        const $that = this;

        if (andEntity) {
            const entity = this.getEntity(query.parentName, query.entityMap);
            const andList = [];

            for (const entityPart in andEntity) {
                const itemEntity = andEntity[entityPart];
                for (const table in itemEntity[query.parentName]) {
                    const item = itemEntity[query.parentName][table];
                    const expressions = [];
                    for (const exp in item.expressions) {
                        // Use the field name verbatim for SQL emission so it
                        // matches the actual column case. The capitalized form
                        // is only useful for the navigational-relationship
                        // lookup (relationships are stored with PascalCase keys
                        // like `User`, `Profile` on the entity).
                        const originalField = item.expressions[exp].field;
                        const capitalized = tools.capitalizeFirstLetter(originalField);
                        let field = originalField;
                        let entityRef = entity;

                        if (mainQuery[capitalized] && mainQuery[capitalized].isNavigational) {
                            entityRef = $that.getEntity(capitalized, query.entityMap);
                            field = item.fields[1];
                        }

                        let func = item.expressions[exp].func;
                        const arg = item.expressions[exp].arg;

                        // Handle NULL
                        if (arg === "null") {
                            if (func === "=") func = "IS";
                            if (func === "!=") func = "IS NOT";
                        }

                        if (arg === "null") {
                            tools.assertSafeOperator(func);
                            expressions.push(`${entityRef}.${$that._q(field)} ${func} ${arg}`);
                        } else {
                            // Check if arg is a parameterized placeholder
                            const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                            if (isPlaceholder || func === "IN") {
                                expressions.push(`${entityRef}.${$that._q(field)} ${func} ${arg}`);
                            } else {
                                tools.assertSafeOperator(func);
                                // Escape the single quote so a literal can't break out.
                                expressions.push(`${entityRef}.${$that._q(field)} ${func} '${tools.escapeSqlLiteral(arg)}'`);
                            }
                        }
                    }
                    if (expressions.length > 0) {
                        andList.push(expressions.join(" AND "));
                    }
                }
            }

            if (andList.length > 0) {
                return `AND ${andList.join(" AND ")}`;
            }
        }

        return "";
    }

    /**
     * Build WHERE clause with placeholder detection
     */
    buildWhere(query, mainQuery) {
        const whereEntity = query.where;
        const $that = this;

        if (whereEntity) {
            const entity = this.getEntity(query.parentName, query.entityMap);
            const item = whereEntity[query.parentName].query;
            const conditions = [];

            for (const exp in item.expressions) {
                // Use the field name verbatim for SQL emission. See buildAnd for full rationale.
                const originalField = item.expressions[exp].field;
                const capitalized = tools.capitalizeFirstLetter(originalField);
                let field = originalField;
                let entityRef = entity;

                if (mainQuery[capitalized] && mainQuery[capitalized].isNavigational) {
                    entityRef = $that.getEntity(capitalized, query.entityMap);
                    field = item.fields[1];
                }

                let func = item.expressions[exp].func;
                const arg = item.expressions[exp].arg;

                // Handle NULL
                if (arg === "null") {
                    if (func === "=") func = "IS";
                    if (func === "!=") func = "IS NOT";
                }

                if (arg === "null") {
                    tools.assertSafeOperator(func);
                    conditions.push(`${entityRef}.${$that._q(field)} ${func} ${arg}`);
                } else if (func === "IN") {
                    conditions.push(`${entityRef}.${$that._q(field)} ${func} ${arg}`);
                } else {
                    tools.assertSafeOperator(func);
                    // Check if arg is a parameterized placeholder ($1, $2, etc.)
                    const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                    if (isPlaceholder) {
                        conditions.push(`${entityRef}.${$that._q(field)} ${func} ${arg}`);
                    } else {
                        // Escape the single quote so a literal can't break out.
                        conditions.push(`${entityRef}.${$that._q(field)} ${func} '${tools.escapeSqlLiteral(arg)}'`);
                    }
                }
            }

            if (conditions.length > 0) {
                return `WHERE ${conditions.join(" AND ")}`;
            }
        }

        return "";
    }

    buildLimit(query) {
        if (query.take) {
            // Defense-in-depth: LIMIT cannot be parameterized, so coerce to an
            // integer at the SQL boundary (matches MySQL; SQLite does the same).
            return `LIMIT ${this._safeRowCount(query.take, 'take')}`;
        }
        return "";
    }

    buildSkip(query) {
        if (query.skip) {
            // Unlike SQLite/MySQL, Postgres accepts a bare OFFSET with no LIMIT,
            // so a .skip() without .take() is valid as-is — no sentinel needed.
            return `OFFSET ${this._safeRowCount(query.skip, 'skip')}`;
        }
        return "";
    }

    // Coerce a LIMIT/OFFSET value to a non-negative integer or throw. These
    // clauses are not parameterizable, so this is the last defense against a
    // non-numeric (injection) pagination value reaching the SQL string.
    _safeRowCount(value, label){
        const n = typeof value === 'number' ? value : Number(value);
        if(!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)){
            throw new Error(`Invalid ${label} value for LIMIT/OFFSET: ${JSON.stringify(value)} (expected a non-negative integer)`);
        }
        return n;
    }

    /**
     * Build ORDER BY clause from query.orderBy or query.orderByDesc.
     * Both are objects shaped like `{ selectFields: ['col1', 'col2'], ... }`
     * (see QueryLanguage/queryScript.js buildScript()). The previous
     * implementation treated `query.orderBy` as a plain string and silently
     * dropped the clause because the fluent API never produces that shape.
     */
    buildOrderBy(query, entity) {
        let orderByType = "ASC";
        let orderByEntity = query.orderBy;
        if (orderByEntity === false || orderByEntity === undefined) {
            orderByType = "DESC";
            orderByEntity = query.orderByDesc;
        }
        if (!orderByEntity) return "";

        // Security: Validate field exists in entity before interpolating into SQL.
        if (entity && orderByEntity.selectFields) {
            for (const item in orderByEntity.selectFields) {
                const field = orderByEntity.selectFields[item];
                if (!entity[field]) {
                    throw new Error(`Invalid ORDER BY field: ${field} not found in ${entity.__name || 'entity'}`);
                }
            }
        }

        const entityStr = this.getEntity(query.parentName, query.entityMap);
        const fieldList = [];
        for (const item in orderByEntity.selectFields) {
            fieldList.push(`${entityStr}.${this._q(orderByEntity.selectFields[item])}`);
        }
        let out = fieldList.length ? `ORDER BY ${fieldList.join(', ')} ${orderByType}` : "";
        // thenBy / thenByDescending (EF ThenBy)
        const thenBy = Array.isArray(query.thenBy) ? query.thenBy : [];
        if (thenBy.length) {
            const extra = thenBy.map(t => {
                if (entity && !entity[t.field]) throw new Error(`Invalid ORDER BY field: ${t.field} not found in ${entity.__name || 'entity'}`);
                return `${entityStr}.${this._q(t.field)} ${t.dir === 'DESC' ? 'DESC' : 'ASC'}`;
            });
            out = out ? `${out}, ${extra.join(', ')}` : `ORDER BY ${extra.join(', ')}`;
        }
        return out;
    }

    getEntity(name, list) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].name === name) {
                return list[i].entity;
            }
        }
        return name;
    }

    /**
     * Build SQL SET clause with parameterized queries for UPDATE (PostgreSQL)
     * Returns {query: "column1 = $1, column2 = $2", params: [value1, value2]}
     */
    _buildSQLEqualToParameterized(model) {
        const $that = this;
        const sqlParts = [];
        const params = [];
        const dirtyFields = (model.__dirtyFields || []).filter(f => !(model.__entity[f] && model.__entity[f].computedSql));   // computed columns are never written
        let paramIndex = 1;

        for (const column in dirtyFields) {
            const fieldName = dirtyFields[column];
            const entityDef = model.__entity[fieldName];

            // Check for required fields
            if (entityDef && entityDef.nullable === false && entityDef.primary !== true) {
                // Read the raw backing field to get the set()-transformed value,
                // bypassing get() which may change the type (e.g. parseFloat)
                let persistedValue = model["_" + fieldName];
                if (persistedValue === undefined) {
                    persistedValue = (model.__entity[fieldName] && model.__entity[fieldName].relationshipType === "belongsTo") ? tools.foreignKeyValue(model, fieldName) : model[fieldName];
                }
                const isEmptyString = (typeof persistedValue === 'string') && (persistedValue.trim() === '');
                if (persistedValue === undefined || persistedValue === null || isEmptyString) {
                    throw new Error(`Entity ${model.__entity.__name} column ${fieldName} is a required Field`);
                }
            }

            let type = model.__entity[dirtyFields[column]].type;
            if (model.__entity[dirtyFields[column]].relationshipType === "belongsTo") {
                type = "belongsTo";
            }

            switch (type) {
                case "belongsTo": {
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    let fkValue = tools.foreignKeyValue(model, dirtyFields[column]);
                    // Apply toDatabase transformer
                    try {
                        fkValue = FieldTransformer.toDatabase(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    try {
                        fkValue = $that._validateAndCoerceFieldType(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    fkValue = $that._convertValueForDatabase(fkValue, model.__entity[dirtyFields[column]].type);
                    sqlParts.push(`${$that._q(foreignKey)} = $${paramIndex++}`);
                    params.push(fkValue);
                    break;
                }

                case "integer": {
                    let intValue = model["_" + dirtyFields[column]];
                    // Apply toDatabase transformer
                    try {
                        intValue = FieldTransformer.toDatabase(intValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    try {
                        intValue = $that._validateAndCoerceFieldType(intValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    intValue = $that._convertValueForDatabase(intValue, model.__entity[dirtyFields[column]].type);
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(intValue);
                    break;
                }

                case "string": {
                    let strValue = model["_" + dirtyFields[column]];
                    // Apply toDatabase transformer
                    try {
                        strValue = FieldTransformer.toDatabase(strValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    try {
                        strValue = $that._validateAndCoerceFieldType(strValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    strValue = $that._convertValueForDatabase(strValue, model.__entity[dirtyFields[column]].type);
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(strValue);
                    break;
                }

                case "boolean": {
                    let boolValue = model["_" + dirtyFields[column]];
                    // Apply toDatabase transformer
                    try {
                        boolValue = FieldTransformer.toDatabase(boolValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    try {
                        boolValue = $that._validateAndCoerceFieldType(boolValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    boolValue = $that._convertValueForDatabase(boolValue, model.__entity[dirtyFields[column]].type);
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(boolValue);
                    break;
                }

                case "time": {
                    let timeValue = model["_" + dirtyFields[column]];
                    // Apply toDatabase transformer
                    try {
                        timeValue = FieldTransformer.toDatabase(timeValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    try {
                        timeValue = $that._validateAndCoerceFieldType(timeValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    timeValue = $that._convertValueForDatabase(timeValue, model.__entity[dirtyFields[column]].type);
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(timeValue);
                    break;
                }

                case "hasMany":
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(model["_" + dirtyFields[column]]);
                    break;

                default: {
                    // Covers `text` and any other column type without a dedicated
                    // case above. Run the toDatabase transformer here too so that
                    // fields with a serializer (e.g. JSONB/text columns) get their
                    // object values turned into scalars before they reach pg.
                    let rawValue = model["_" + dirtyFields[column]];
                    if (rawValue === undefined) {
                        rawValue = model[dirtyFields[column]];
                    }
                    try {
                        rawValue = FieldTransformer.toDatabase(rawValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    sqlParts.push(`${$that._q(dirtyFields[column])} = $${paramIndex++}`);
                    params.push(rawValue);
                }
            }
        }

        return sqlParts.length > 0 ? { query: sqlParts.join(', '), params: params } : -1;
    }

    /**
     * Build parameterized INSERT object for PostgreSQL
     * Uses $1, $2, $3... instead of ?
     */
    _buildSQLInsertObjectParameterized(fields, modelEntity) {
        const $that = this;
        const columnNames = [];
        const params = [];

        for (const column in modelEntity) {
            if (column.indexOf("__") === -1) {
                if (modelEntity[column] && modelEntity[column].computedSql) continue;   // computed column: DB-generated, never written
                // belongsTo: persist the FK VALUE (assigned entity -> its PK, or
                // the primitive / FK column), never the navigation getter.
                let fieldColumn = (modelEntity[column] && modelEntity[column].relationshipType === "belongsTo")
                    ? tools.foreignKeyValue(fields, column)
                    : fields[column];

                // Auto-increment PKs are DB-assigned — never emit an unset one.
                // "Unset" surfaces as undefined/null (a .new() getter) or as the
                // schema-definition function `id(db){…}` (a class instance); a
                // function is never a valid column value. Keeps the batched
                // multi-row INSERT consistent with the single-insert path
                // (otherwise it threw "Expected integer, got function").
                const _columnDef = modelEntity[column];
                const _isAutoPrimaryKey = _columnDef && _columnDef.primary === true && _columnDef.auto === true;
                if (typeof fieldColumn === 'function' ||
                    (_isAutoPrimaryKey && (fieldColumn === undefined || fieldColumn === null))) {
                    continue;
                }

                if (fieldColumn !== undefined && fieldColumn !== null) {
                    // 🔥 Apply toDatabase transformer FIRST — transformers may turn
                    // objects into scalars (e.g. JSON.stringify) so running them
                    // before the type check is essential for fields that use a
                    // custom serializer on top of a text/json column.
                    try {
                        fieldColumn = FieldTransformer.toDatabase(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch (transformError) {
                        throw new Error(`INSERT failed: ${transformError.message}`);
                    }
                }

                if ((fieldColumn !== undefined && fieldColumn !== null) && typeof(fieldColumn) !== "object") {
                    // Validate and coerce type
                    try {
                        fieldColumn = $that._validateAndCoerceFieldType(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch (typeError) {
                        throw new Error(`INSERT failed: ${typeError.message}`);
                    }

                    // Convert to database-specific format
                    fieldColumn = $that._convertValueForDatabase(fieldColumn, modelEntity[column].type);

                    // Skip auto-increment primary keys
                    if (modelEntity[column].auto !== true) {
                        // For belongsTo relationships, the actual SQL column is
                        // the foreignKey (e.g. `user_id`), not the relationship
                        // property name (`User`). MySQL handles this; Postgres
                        // used to push the relationship name and emit invalid
                        // INSERT column lists.
                        const relationship = modelEntity[column].relationshipType;
                        const actualColumn = relationship === "belongsTo" && modelEntity[column].foreignKey
                            ? modelEntity[column].foreignKey
                            : column;
                        columnNames.push($that._q(actualColumn));
                        params.push(fieldColumn);
                    }
                }
            }
        }

        if (columnNames.length === 0) {
            return -1;
        }

        // Generate PostgreSQL placeholders: $1, $2, $3...
        const placeholders = params.map((_, index) => `$${index + 1}`).join(', ');

        return {
            tableName: modelEntity.__name,
            columns: columnNames.join(', '),
            placeholders: placeholders,
            params: params
        };
    }

    _buildDeleteObject(queryObject) {
        const primaryKey = tools.getPrimaryKeyObject(queryObject.__entity);
        return {
            tableName: queryObject.__entity.__name,
            primaryKey: primaryKey,
            value: queryObject[primaryKey]
        };
    }

    /**
     * Validate and coerce field type
     */
    _validateAndCoerceFieldType(value, fieldDef, entityName, fieldName) {
        if (value === null || value === undefined) {
            if (fieldDef.nullable === false || fieldDef.notNullable === true) {
                throw new Error(`Field '${entityName}.${fieldName}' cannot be null`);
            }
            return null;
        }

        const fieldType = fieldDef.type;

        switch (fieldType) {
            case 'string':
            case 'text':
                return String(value);

            case 'integer':
            case 'int': {
                const intVal = parseInt(value, 10);
                if (isNaN(intVal)) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be an integer, got: ${value}`);
                }
                return intVal;
            }

            case 'float':
            case 'double':
            case 'decimal': {
                const floatVal = parseFloat(value);
                if (isNaN(floatVal)) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be a number, got: ${value}`);
                }
                return floatVal;
            }

            case 'boolean':
            case 'bool':
                if (typeof value === 'boolean') return value;
                if (value === 1 || value === '1' || value === 'true' || value === true) return true;
                if (value === 0 || value === '0' || value === 'false' || value === false) return false;
                throw new Error(`Invalid boolean value: ${value}`);

            case 'date':
            case 'datetime':
            case 'timestamp': {
                if (value instanceof Date) {
                    return value;
                }
                const dateVal = new Date(value);
                if (isNaN(dateVal.getTime())) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be a valid date, got: ${value}`);
                }
                return dateVal;
            }

            case 'json':
            case 'jsonb':
                if (typeof value === 'object') {
                    return JSON.stringify(value);
                }
                return value;

            default:
                return value;
        }
    }

    /**
     * Convert validated value to database-specific format
     * Modern ORM pattern: transparent database-specific conversions
     *
     * @param {*} value - Already validated value
     * @param {string} fieldType - Field type from entity definition
     * @returns {*} Database-ready value
     */
    _convertValueForDatabase(value, fieldType){
        if(value === undefined || value === null){
            return value;
        }

        // PostgreSQL accepts native booleans, but we convert to 1/0 for consistency
        // The pg driver will convert to PostgreSQL TRUE/FALSE
        if(fieldType === 'boolean' && typeof value === 'boolean'){
            return value ? 1 : 0;
        }

        return value;
    }

    /**
     * Execute parameterized query with pg library
     */
    /**
     * Execute raw SQL (DDL statements like CREATE TABLE, ALTER TABLE, etc.)
     * Used by migration schema for non-parameterized DDL queries.
     */
    _execute(query, params) {
        // Migration/DDL path — flag it so the statement is always logged
        // (migrations must be observable in production).
        return this._runWithParams(query, params || [], { migration: true });
    }

    async _runWithParams(query, params = [], opts = {}) {
        try {
            // Migration DDL (opts.migration) is always logged so production
            // migrations are observable; runtime queries stay behind the
            // dev/LOG_SQL gate.
            const isMigration = opts.migration === true;
            // Logging (redacted params, slow-query warnings, migration DDL) is
            // handled centrally by logging.js via _notifyCommand below.

            // Inside a transaction, reuse the transaction's client so every
            // statement is part of the same BEGIN..COMMIT unit (and don't
            // release it — endTransaction/errorTransaction owns its lifecycle).
            const start = process.hrtime.bigint();
            const done = (error) => this._notifyCommand({ sql: query, params, durationMs: Number(process.hrtime.bigint() - start) / 1e6, engine: 'postgres', migration: isMigration, ...(error ? { error } : {}) });
            if (this._txnClient) {
                try { const r = await this._txnClient.query(query, params); done(); return r; }
                catch (error) { done(error); throw error; }
            }

            const client = await this.pool.connect();
            try {
                const result = await client.query(query, params);
                done();
                return result;
            } catch (error) {
                done(error);
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL query error:', error);
            throw error;
        }
    }

    // --- Transactions -----------------------------------------------------
    // saveChanges() brackets all inserts/updates/deletes so a partial failure
    // rolls the whole batch back. Without this, Postgres writes were
    // autocommitted per statement and a mid-batch error left partial data.

    async startTransaction(){
        if(this._txnClient){ return; }
        this._txnClient = await this.pool.connect();
        await this._txnClient.query('BEGIN');
    }

    async endTransaction(){
        if(!this._txnClient){ return; }
        const client = this._txnClient;
        this._txnClient = null;
        try {
            await client.query('COMMIT');
        } finally {
            client.release();
        }
    }

    async errorTransaction(){
        if(!this._txnClient){ return; }
        const client = this._txnClient;
        this._txnClient = null;
        try {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    }

    inTransaction(){
        return !!this._txnClient;
    }

    // Nested rollback points so a failed bulk write can be undone without
    // aborting (Postgres marks a transaction "aborted" after any statement
    // error) the enclosing transaction. `name` is an internal identifier.
    async savepoint(name){
        return this._txnClient.query(`SAVEPOINT ${name}`);
    }

    async releaseSavepoint(name){
        return this._txnClient.query(`RELEASE SAVEPOINT ${name}`);
    }

    async rollbackToSavepoint(name){
        return this._txnClient.query(`ROLLBACK TO SAVEPOINT ${name}`);
    }

    /**
     * Sanitize single quotes (legacy, prefer parameterized queries)
     */
    _santizeSingleQuotes(string, context = {}) {
        if (typeof string === 'string' || string instanceof String) {
            return string.replace(/'/g, "''");
        }
        console.warn(`Warning - Field ${context.entityName}.${context.fieldName} is not a string`);
        throw new Error(`Field ${context.entityName}.${context.fieldName} must be a string`);
    }

    /**
     * Set database connection
     */
    setDB(db, type) {
        this.db = db;
        this.pool = db;
        this.dbType = type || 'postgres';
    }

    /**
     * Close database connection pool
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('PostgreSQL pool closed');
        }
    }
}

export default postgresEngine;
