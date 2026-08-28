// Version 1.0.0 - Complete MySQL implementation with mysql2/promise
import tools from './Tools.js';
import FieldTransformer from './Entity/fieldTransformer.js';
import { logCommand } from './logging.js';

class MySQLEngine {

    constructor() {
        this.pool = null;
        this.db = null;
        this.dbType = 'mysql';
        this.unsupportedWords = ["order"];
        // Holds a dedicated pooled connection while a transaction is open so
        // every statement in saveChanges() runs on the same connection.
        this._txnConn = null;
    }

    // Quote a MySQL identifier, escaping any embedded backtick by doubling it
    // (the MySQL-standard escape) so an identifier can never break out of the
    // backtick quoting. Field names arriving from the lambda parser are
    // already restricted to word characters, so this is defense-in-depth.
    _qi(ident) {
        return '`' + String(ident).replace(/`/g, '``') + '`';
    }

    /**
     * Initialize MySQL connection pool
     * @param {Object} pool - MySQL connection pool from mysql2/promise
     */
    setDB(pool, type) {
        this.pool = pool;
        this.db = pool;
        this.dbType = type || 'mysql';
    }

    /**
     * UPDATE with parameterized query (MySQL uses ?)
     */
    async update(query) {
        // Security: ONLY use parameterized queries
        if (!query.arg || typeof query.arg !== 'object' || !query.arg.sql || !query.arg.params) {
            throw new Error('UPDATE failed: Invalid parameterized query structure. Check entity definition.');
        }

        // Optimistic concurrency: bump a rowVersion column atomically and add
        // each concurrency token's ORIGINAL value to the WHERE (see SQLite
        // engine). NOTE: mysql2 connects with FOUND_ROWS by default, so
        // `affectedRows` = rows MATCHED (not only rows changed) — required for
        // the rows-affected concurrency check to be meaningful.
        const t = query.tableName;
        let setSql = query.arg.sql;
        if (query.rowVersionColumn) {
            setSql += `, \`${query.rowVersionColumn}\` = \`${query.rowVersionColumn}\` + 1`;
        }
        const params = [...query.arg.params, query.primaryKeyValue];
        let where = `\`${t}\`.\`${query.primaryKey}\` = ?`;
        for (const c of (query.concurrency || [])) {
            if (c.value === null || c.value === undefined) { where += ` AND \`${t}\`.\`${c.column}\` IS NULL`; }
            else { where += ` AND \`${t}\`.\`${c.column}\` = ?`; params.push(c.value); }
        }
        const sqlQuery = `UPDATE \`${t}\` SET ${setSql} WHERE ${where}`;
        return await this._runWithParams(sqlQuery, params);
    }

    /**
     * DELETE with parameterized query
     */
    async delete(queryObject) {
        const sqlObject = this._buildDeleteObject(queryObject);
        const params = [sqlObject.value];
        let where = `\`${sqlObject.tableName}\`.\`${sqlObject.primaryKey}\` = ?`;
        for (const c of (queryObject.__concurrency || [])) {
            if (c.value === null || c.value === undefined) { where += ` AND \`${sqlObject.tableName}\`.\`${c.column}\` IS NULL`; }
            else { where += ` AND \`${sqlObject.tableName}\`.\`${c.column}\` = ?`; params.push(c.value); }
        }
        const sqlQuery = `DELETE FROM \`${sqlObject.tableName}\` WHERE ${where}`;
        return await this._runWithParams(sqlQuery, params);
    }

    /** Rows matched by the last UPDATE/DELETE (mysql2 OkPacket.affectedRows). */
    /** Connection probe (context.healthCheck()): never throws. */
    async healthCheck(){
        try {
            if (!this.pool) return { healthy: false, error: 'Not connected' };
            const rows = await this._runWithParams('SELECT VERSION() AS version', []);
            const first = Array.isArray(rows) ? rows[0] : (rows && rows[0]);
            const inner = this.pool.pool || this.pool;   // mysql2/promise wraps the core pool
            const stat = (k) => (inner && inner[k] && typeof inner[k].length === 'number') ? inner[k].length : undefined;
            return { healthy: true, version: first ? first.version : undefined, poolSize: stat('_allConnections'), idleCount: stat('_freeConnections'), waitingCount: stat('_connectionQueue') };
        } catch (err) {
            return { healthy: false, error: err.message };
        }
    }

    affectedRows(result){
        if (!result) return 0;
        if (typeof result.affectedRows === 'number') return result.affectedRows;
        return 0;
    }

    // ---- Set-based writes from a compiled query (EF ExecuteUpdate / ExecuteDelete) ----

    async executeUpdate(query, entity, setters){
        const alias = this.getEntity(entity.__name, query.entityMap) || entity.__name;
        const whereSql = `${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`.trim();
        const whereParams = query.parameters ? query.parameters.getParams() : [];
        const setParts = [], setParams = [];
        for (const s of setters) {
            if (s.raw !== undefined) { setParts.push(`\`${s.column}\` = ${s.raw}`); }
            else { setParts.push(`\`${s.column}\` = ?`); setParams.push(s.value); }
        }
        const sql = `UPDATE \`${entity.__name}\` AS ${alias} SET ${setParts.join(', ')} ${whereSql}`;
        return this.affectedRows(await this._runWithParams(sql, [...setParams, ...whereParams]));
    }

    async executeDelete(query, entity){
        const alias = this.getEntity(entity.__name, query.entityMap) || entity.__name;
        const whereSql = `${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`.trim();
        const whereParams = query.parameters ? query.parameters.getParams() : [];
        // Multi-table DELETE syntax so the alias works on every MySQL version
        // (single-table `DELETE FROM t AS a` needs 8.0.16+).
        const sql = `DELETE ${alias} FROM \`${entity.__name}\` AS ${alias} ${whereSql}`;
        return this.affectedRows(await this._runWithParams(sql, whereParams));
    }

    /** Scalar aggregate over the query's rows (EF Sum/Average/Min/Max): fn in SUM|AVG|MIN|MAX. */
    /** EF GroupBy + aggregates (see SQLite engine for the contract). */
    async getGrouped(queryObject, entity, groups, aggs, having, orderBy){
        const q = queryObject.script;
        const alias = this.getEntity(entity.__name, q.entityMap) || entity.__name;
        const qi = (n) => this._qi(n);
        const sel = [
            ...groups.map(g => `${alias}.${qi(g.column)} AS ${qi(g.column)}`),
            ...aggs.map(a => `${a.fn}(${a.column ? `${alias}.${qi(a.column)}` : '*'}) AS ${qi(a.alias)}`),
        ].join(', ');
        const params = q.parameters ? [...q.parameters.getParams()] : [];
        let sql = `SELECT ${sel} ${this.buildFrom(q, entity)} ${this.buildWhere(q, entity)} ${this.buildAnd(q, entity)} GROUP BY ${groups.map(g => `${alias}.${qi(g.column)}`).join(', ')}`;
        if (having && having.length) {
            sql += ' HAVING ' + having.map(h => { params.push(h.value); return `${h.agg.fn}(${h.agg.column ? `${alias}.${qi(h.agg.column)}` : '*'}) ${h.op} ?`; }).join(' AND ');
        }
        sql += (orderBy && orderBy.length) ? ` ORDER BY ${orderBy.map(o => `${qi(o.name)}${o.desc ? ' DESC' : ' ASC'}`).join(', ')}` : ` ORDER BY ${groups.map(g => qi(g.column)).join(', ')}`;
        const lim = typeof this.buildLimit === 'function' ? this.buildLimit(q) : (typeof this.buildTake === 'function' ? this.buildTake(q) : '');
        const off = typeof this.buildSkip === 'function' ? this.buildSkip(q) : '';
        sql += ` ${lim} ${off}`;
        const rows = await this._runWithParams(sql, params);
        return Array.isArray(rows) ? rows : [];
    }

    async getAggregate(queryObject, entity, fn, column){
        const q = queryObject.script;
        const alias = this.getEntity(entity.__name, q.entityMap) || entity.__name;
        const sql = `SELECT ${fn}(${alias}.\`${column}\`) AS value ${this.buildFrom(q, entity)} ${this.buildWhere(q, entity)} ${this.buildAnd(q, entity)}`;
        const params = q.parameters ? q.parameters.getParams() : [];
        const rows = await this._runWithParams(sql, params);
        return rows && rows[0] ? rows[0].value : null;
    }

    /**
     * INSERT with parameterized query
     * MySQL uses LAST_INSERT_ID() to get the inserted ID
     */
    async insert(queryObject) {
        const sqlObject = this._buildSQLInsertObjectParameterized(queryObject, queryObject.__entity);
        if (sqlObject === -1) {
            throw new Error('INSERT failed: No columns to insert');
        }

        const query = `INSERT INTO \`${sqlObject.tableName}\` (${sqlObject.columns}) VALUES (${sqlObject.placeholders})`;
        const result = await this._runWithParams(query, sqlObject.params);

        return {
            id: result.insertId
        };
    }

    /**
     * Batch insert using MySQL's multi-value INSERT
     */
    async bulkInsert(entities) {
        if (!entities || entities.length === 0) return [];

        // Build each row's SQL object up front, keeping its ORIGINAL index so
        // the returned array aligns with the input order — the contract
        // context._processBatchInserts relies on when writing ids back.
        const rows = entities.map((entity, index) => ({
            index,
            sql: this._buildSQLInsertObjectParameterized(entity, entity.__entity),
        }));

        // One multi-value INSERT can only serve rows that share the SAME
        // column list. The builder skips unset optional columns and auto PKs,
        // so a batch can be heterogeneous; reusing the first row's columns for
        // every row produced ER_WRONG_VALUE_COUNT_ON_ROW (or, when the counts
        // happened to match, values landing in the wrong columns). Sub-group
        // by table + exact column signature and emit one statement per group.
        // No NULL-padding to a column union — that would override DB-level
        // column defaults.
        const groups = new Map();
        for (const row of rows) {
            const key = `${row.sql.tableName}\u0000${row.sql.columns}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }

        const results = new Array(entities.length);
        for (const group of groups.values()) {
            const first = group[0].sql;
            const valueGroups = [];
            const allParams = [];
            for (const row of group) {
                valueGroups.push(`(${row.sql.placeholders})`);
                allParams.push(...row.sql.params);
            }

            const query = `INSERT INTO \`${first.tableName}\` (${first.columns}) VALUES ${valueGroups.join(', ')}`;
            const result = await this._runWithParams(query, allParams);

            // MySQL returns the FIRST auto-increment id of the statement;
            // ids are contiguous within a single multi-value INSERT.
            const firstId = result.insertId;
            for (let i = 0; i < group.length; i++) {
                results[group[i].index] = { id: firstId + i };
            }
        }

        return results;
    }

    /**
     * Batch update (execute in sequence for MySQL)
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

        const placeholders = ids.map(() => '?').join(', ');
        const query = `DELETE FROM \`${tableName}\` WHERE \`${primaryKey}\` IN (${placeholders})`;
        return await this._runWithParams(query, ids);
    }

    /**
     * SELECT single record
     */
    async get(query, entity, context) {
        try {
            let queryString;
            if (query.raw) {
                queryString = { query: query.raw };
            } else {
                queryString = this.buildQuery(query, entity, context);
            }

            if (queryString.query) {
                const params = query.parameters ? query.parameters.getParams() : [];
                const result = await this._runWithParams(queryString.query, params);
                return result[0] || null;
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
     * SELECT COUNT. Builds the SQL inline (like SQLite/Postgres do) instead
     * of trying to regex-wrap the full SELECT from buildQuery — the old code
     * called `queryObject.count(sqlString)` which is a queryScript builder
     * method (expects a lambda), not a SQL wrapper; the return value was the
     * queryScript object and running it as SQL produced "[object Object]".
     */
    async getCount(queryObject, entity, _context) {
        const query = queryObject.script;
        try {
            let sql;
            if (query.raw) {
                sql = query.raw;
            } else {
                if (query.count === undefined) {
                    query.count = "none";
                }
                sql = `SELECT ${this.buildCount(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`;
            }

            if (sql) {
                const params = query.parameters ? query.parameters.getParams() : [];
                const result = await this._runWithParams(sql, params);
                return result[0] || null;
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
     * Build COUNT(...) fragment for SELECT ... COUNT(...) FROM ...
     * Matches the SQLite/Postgres engine contract.
     */
    buildCount(query, entity) {
        const alias = this.getEntity(query.parentName || entity.__name, query.entityMap);
        if (!query.count) return "";
        if (query.count === "none") return `COUNT(*)`;
        // query.count is a cachedExpr with selectFields when set via `.count(l => l.field)`.
        const field = query.count.selectFields && query.count.selectFields[0];
        if (!field) return `COUNT(*)`;
        return `COUNT(${alias}.\`${field}\`)`;
    }

    /**
     * SELECT multiple records
     */
    async all(query, entity, context) {
        try {
            let queryString;
            if (query.raw) {
                queryString = { query: query.raw };
            } else {
                queryString = this.buildQuery(query, entity, context);
            }

            if (queryString.query) {
                const params = query.parameters ? query.parameters.getParams() : [];
                const result = await this._runWithParams(queryString.query, params);
                return result || [];
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
    // mysql2 returns an array of rows for SELECT and a ResultSetHeader for
    // writes.
    async query(query, params = []) {
        return await this._runWithParams(query, params);
    }

    /**
     * Introspection: Check if table exists
     */
    async tableExists(tableName) {
        // A genuinely-absent table yields zero rows -> false. A real failure
        // (connection/permission/INFORMATION_SCHEMA error) MUST throw — never
        // disguise an error as "table absent", or schema.createTable() silently
        // blind-creates (a no-op on an existing table) and skips column syncs.
        let res;
        try {
            const sql = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
            res = await this._runWithParams(sql, [tableName]);
        } catch (err) {
            throw new Error(`masterrecord: could not determine whether table '${tableName}' exists (MySQL introspection failed): ${err.message}`);
        }
        return Array.isArray(res) ? res.length > 0 : !!res?.length;
    }

    /**
     * Introspection: Get table column information.
     * Genuinely-absent table -> [] (zero rows); real failures throw.
     */
    async getTableInfo(tableName) {
        try {
            const sql = `SELECT COLUMN_NAME as name, COLUMN_DEFAULT as dflt_value, IS_NULLABLE as is_nullable, DATA_TYPE as data_type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
            const res = await this._runWithParams(sql, [tableName]);
            return res || [];
        } catch (err) {
            throw new Error(`masterrecord: could not read columns for table '${tableName}' (MySQL introspection failed): ${err.message}`);
        }
    }

    /**
     * Build complete SELECT query
     */
    buildQuery(query, entity, context) {
        if (!entity) {
            console.log("Error: Entity object is blank");
            return { query: "" };
        }

        const queryObject = {
            entity: this.getEntity(entity.__name, query.entityMap),
            select: this.buildSelect(query, entity),
            from: this.buildFrom(query, entity),
            include: this.buildInclude(query, entity, context, {}),
            where: this.buildWhere(query, entity),
            and: this.buildAnd(query, entity),
            orderBy: this.buildOrderBy(query, entity),
            take: this.buildTake(query),
            skip: this.buildSkip(query)
        };

        // MySQL FULLTEXT search bolted onto the assembled query: append
        // MATCH(...) AGAINST(...) AS __rank to SELECT, the same expression
        // into WHERE (or AND), and default to ORDER BY __rank DESC if the
        // user didn't chain their own ordering.
        const fts = this._buildSearch(query, entity);
        if (fts) {
            queryObject.select = queryObject.select.replace(/\s*$/, `, ${fts.rankSelect} `);
            if (queryObject.where && queryObject.where.trim().length > 0) {
                queryObject.where = `${queryObject.where} AND ${fts.predicate}`;
            } else {
                queryObject.where = `WHERE ${fts.predicate}`;
            }
            if (!queryObject.orderBy || queryObject.orderBy.trim().length === 0) {
                queryObject.orderBy = fts.defaultOrder;
            }
        }

        const queryString = `${queryObject.select} ${queryObject.from} ${queryObject.include} ${queryObject.where} ${queryObject.and} ${queryObject.orderBy} ${queryObject.take} ${queryObject.skip}`;
        return {
            query: queryString,
            entity: this.getEntity(entity.__name, query.entityMap)
        };
    }

    /**
     * Build ORDER BY clause from query.orderBy or query.orderByDesc.
     * Both are objects shaped like `{ selectFields: ['col1', 'col2'], ... }`
     * (see QueryLanguage/queryScript.js buildScript()).
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

        const entityAlias = this.getEntity(query.parentName, query.entityMap);
        const fieldList = [];
        for (const item in orderByEntity.selectFields) {
            fieldList.push(`${entityAlias}.\`${orderByEntity.selectFields[item]}\``);
        }
        let out = fieldList.length ? `ORDER BY ${fieldList.join(', ')} ${orderByType}` : "";
        // thenBy / thenByDescending (EF ThenBy)
        const thenBy = Array.isArray(query.thenBy) ? query.thenBy : [];
        if (thenBy.length) {
            const extra = thenBy.map(t => {
                if (entity && !entity[t.field]) throw new Error(`Invalid ORDER BY field: ${t.field} not found in ${entity.__name || 'entity'}`);
                return `${entityAlias}.\`${t.field}\` ${t.dir === 'DESC' ? 'DESC' : 'ASC'}`;
            });
            out = out ? `${out}, ${extra.join(', ')}` : `ORDER BY ${extra.join(', ')}`;
        }
        return out;
    }

    buildTake(query) {
        if (query.take) {
            // LIMIT cannot be parameterized; coerce to an integer or throw.
            return `LIMIT ${this._safeRowCount(query.take, 'take')}`;
        }
        return "";
    }

    buildSkip(query) {
        if (query.skip) {
            // MySQL requires a LIMIT before OFFSET. When the caller paginated
            // with .skip() but no .take(), use the documented "all rows from
            // this offset" sentinel (max BIGINT UNSIGNED) so the OFFSET is valid
            // SQL instead of a syntax error. Now that .toList() no longer injects
            // a default LIMIT 1000, this is the path a bare .skip() takes.
            const skip = this._safeRowCount(query.skip, 'skip');
            return query.take
                ? `OFFSET ${skip}`
                : `LIMIT 18446744073709551615 OFFSET ${skip}`;
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
     * Build the MySQL FULLTEXT search plumbing for the current query if a
     * `.search()` clause was chained. Returns null otherwise.
     *
     * MySQL emits `MATCH(col1, col2) AGAINST(? IN NATURAL LANGUAGE MODE)`.
     * The MATCH expression appears twice: once in SELECT (aliased as
     * __rank for ordering), once in WHERE. To keep parameter ordering
     * consistent we bind the search term twice as separate parameters.
     */
    _buildSearch(query, entity) {
        if (!query.search) return null;
        const alias = this.getEntity(query.parentName || entity.__name, query.entityMap);
        const cols = query.search.columns.map(c => `${alias}.\`${c}\``).join(', ');
        const phSelect = query.parameters
            ? query.parameters.addParam(query.search.query, 'mysql')
            : '?';
        const phWhere = query.parameters
            ? query.parameters.addParam(query.search.query, 'mysql')
            : '?';
        const matchSelect = `MATCH(${cols}) AGAINST(${phSelect} IN NATURAL LANGUAGE MODE)`;
        const matchWhere = `MATCH(${cols}) AGAINST(${phWhere} IN NATURAL LANGUAGE MODE)`;
        return {
            rankSelect: `${matchSelect} AS __rank`,
            predicate: matchWhere,
            // MySQL relevance: higher = more relevant.
            defaultOrder: `ORDER BY __rank DESC`,
        };
    }

    /**
     * Build chained AND clause from query.and (array of cachedExpr objects).
     * Produces "AND <expr> AND <expr>" that appends to the WHERE clause.
     */
    buildAnd(query, mainQuery) {
        const andEntity = query.and;
        const $that = this;
        if (!andEntity) return "";

        let entity = this.getEntity(query.parentName, query.entityMap);
        const andList = [];

        for (const entityPart in andEntity) {
            const itemEntity = andEntity[entityPart];
            for (const table in itemEntity[query.parentName]) {
                const item = itemEntity[query.parentName][table];
                const expressions = [];
                for (const exp in item.expressions) {
                    // Use the field name verbatim for SQL emission. With
                    // backtick quoting, MySQL on case-sensitive filesystems
                    // (Linux defaults) wouldn't match a column named `stage`
                    // if we emit `\`Stage\``. Only use the capitalized form
                    // for the navigational-relationship lookup since those
                    // are stored as PascalCase keys on the entity.
                    const originalField = item.expressions[exp].field;
                    const capitalized = tools.capitalizeFirstLetter(originalField);
                    let field = originalField;
                    if (mainQuery[capitalized] && mainQuery[capitalized].isNavigational) {
                        entity = $that.getEntity(capitalized, query.entityMap);
                        field = item.fields[1];
                    }

                    let func = item.expressions[exp].func;
                    const arg = item.expressions[exp].arg;

                    if (arg === "null") {
                        if (func === "=") func = "IS";
                        if (func === "!=") func = "IS NOT";
                        tools.assertSafeOperator(func);
                        expressions.push(`${entity}.${$that._qi(field)} ${func} ${arg}`);
                    } else {
                        // arg may be a parameterized placeholder (?, $1, (?, ?, ?))
                        // or a literal value quoted with single quotes.
                        const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg) || /^\(.*\)$/.test(arg));
                        if (isPlaceholder || func === "IN") {
                            expressions.push(`${entity}.${$that._qi(field)} ${func} ${arg}`);
                        } else {
                            tools.assertSafeOperator(func);
                            // Escape the single quote so a literal can't break out.
                            expressions.push(`${entity}.${$that._qi(field)} ${func} '${tools.escapeSqlLiteral(arg)}'`);
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
        return "";
    }

    buildSelect(query, entity) {
        const select = query.distinct ? "SELECT DISTINCT" : "SELECT";
        const arr = [];
        const $that = this;

        if (query.select) {
            for (const item in query.select.selectFields) {
                arr.push(`${$that.getEntity(entity.__name, query.entityMap)}.\`${query.select.selectFields[item]}\``);
            }
        } else {
            const entityList = this.getEntityList(entity);
            for (const item in entityList) {
                arr.push(`${$that.getEntity(entity.__name, query.entityMap)}.\`${entityList[item]}\``);
            }
        }
        return `${select} ${arr.join(', ')} `;
    }

    buildFrom(query, entity) {
        const entityName = this.getEntity(entity.__name, query.entityMap);
        if (entityName) {
            return `FROM \`${entity.__name}\` AS ${entityName}`;
        }
        return "";
    }

    buildInclude(query, entity, context) {
        const includeQueries = [];
        const $that = this;

        for (const part in query.include) {
            const includeEntity = query.include[part];
            if (includeEntity) {
                const parentObj = includeEntity[query.parentName];
                let currentContext = "";
                if (includeEntity.selectFields) {
                    currentContext = context[tools.capitalizeFirstLetter(includeEntity.selectFields[0])];
                }

                if (parentObj) {
                    parentObj.entityMap = query.entityMap;
                    let foreignKey = $that.getForeignKey(entity.__name, currentContext.__entity);
                    let mainPrimaryKey = $that.getPrimarykey(entity);
                    let mainEntity = $that.getEntity(entity.__name, query.entityMap);

                    if (currentContext.__entity[entity.__name].type === "hasManyThrough") {
                        const foreignTable = tools.capitalizeFirstLetter(currentContext.__entity[entity.__name].foreignTable);
                        foreignKey = $that.getPrimarykey(currentContext.__entity);
                        mainPrimaryKey = context[foreignTable].__entity[currentContext.__entity.__name].foreignKey;
                        mainEntity = $that.getEntity(foreignTable, query.entityMap);
                    }

                    if (parentObj.select) {
                        parentObj.select.selectFields.push(foreignKey);
                    } else {
                        parentObj.select = {
                            selectFields: [foreignKey]
                        };
                    }

                    const innerQuery = $that.buildQuery(parentObj, currentContext.__entity, context);
                    includeQueries.push(`LEFT JOIN (${innerQuery.query}) AS ${innerQuery.entity} ON ${mainEntity}.\`${mainPrimaryKey}\` = ${innerQuery.entity}.\`${foreignKey}\``);
                }
            }
        }
        return includeQueries.join(' ');
    }

    buildWhere(query, mainQuery) {
        const whereEntity = query.where;
        const $that = this;

        if (!whereEntity) {
            return "";
        }

        const entityAlias = this.getEntity(query.parentName, query.entityMap);
        const item = whereEntity[query.parentName].query;
        const exprs = item.expressions || [];

        function exprToSql(expr) {
            // Preserve case for column-name emission — `.toLowerCase()` used
            // to turn `updatedAt` into `updatedat`, which doesn't match a
            // case-sensitive backtick-quoted column on Linux MySQL.
            let field = expr.field;
            let ent = entityAlias;
            if (mainQuery[field]) {
                if (mainQuery[field].isNavigational) {
                    ent = $that.getEntity(field, query.entityMap);
                    if (item.fields && item.fields[1]) {
                        field = item.fields[1];
                    }
                }
            }
            let func = expr.func;
            const arg = expr.arg;
            if ((!func && typeof arg === 'undefined')) {
                return null;
            }
            if (func === 'exists' && typeof arg === 'undefined') {
                const isNull = expr.negate === true;
                return `${ent}.\`${field}\` is ${isNull ? '' : 'not '}null`;
            }
            if (arg === "null") {
                if (func === "=") func = "is";
                if (func === "!=") func = "is not";
                tools.assertSafeOperator(func);
                return `${ent}.${$that._qi(field)} ${func} ${arg}`;
            }
            if (func === "IN") {
                return `${ent}.${$that._qi(field)} ${func} ${arg}`;
            }
            tools.assertSafeOperator(func);
            const isPlaceholder = (arg === '?');
            if (isPlaceholder) {
                return `${ent}.${$that._qi(field)} ${func} ${arg}`;
            }
            const safeArg = (typeof arg === 'string' || arg instanceof String)
                ? $that._santizeSingleQuotes(arg, { entityName: ent, fieldName: field })
                : String(arg);
            return `${ent}.${$that._qi(field)} ${func} '${safeArg}'`;
        }

        const pieces = [];
        for (let i = 0; i < exprs.length; i++) {
            const e = exprs[i];
            if (e.group) {
                const gid = e.group;
                const orParts = [];
                while (i < exprs.length && exprs[i].group === gid) {
                    const sql = exprToSql(exprs[i]);
                    if (sql) { orParts.push(sql); }
                    i++;
                }
                i--;
                if (orParts.length > 0) {
                    pieces.push(`(${orParts.join(" or ")})`);
                }
            } else {
                const sql = exprToSql(e);
                if (sql) { pieces.push(sql); }
            }
        }

        if (pieces.length === 0) {
            return "";
        }
        return `WHERE ${pieces.join(" and ")}`;
    }

    getForeignKey(name, entity) {
        if (entity && name) {
            return entity[name].foreignKey;
        }
    }

    getPrimarykey(entity) {
        for (const item in entity) {
            if (entity[item].primary) {
                if (entity[item].primary === true) {
                    return entity[item].name;
                }
            }
        }
    }

    getForeignTable(name, entity) {
        if (entity && name) {
            return entity[name].foreignTable;
        }
    }

    getEntity(name, maps) {
        for (const item in maps) {
            const map = maps[item];
            if (tools.capitalizeFirstLetter(name) === map.name) {
                return map.entity;
            }
        }
        return "";
    }

    getEntityList(entity) {
        const entitiesList = [];
        const $that = this;

        for (const ent in entity) {
            if (!ent.startsWith("_")) {
                // Skip lifecycle hooks - they are not database columns
                if (entity[ent].lifecycle === true) {
                    continue;
                }
                if (!entity[ent].foreignKey) {
                    if (entity[ent].relationshipTable) {
                        if ($that.chechUnsupportedWords(entity[ent].relationshipTable)) {
                            entitiesList.push(`'${entity[ent].relationshipTable}'`);
                        } else {
                            entitiesList.push(entity[ent].relationshipTable);
                        }
                    } else {
                        if ($that.chechUnsupportedWords(ent)) {
                            entitiesList.push(`'${ent}'`);
                        } else {
                            entitiesList.push(ent);
                        }
                    }
                } else {
                    if (entity[ent].relationshipType === "belongsTo") {
                        const name = entity[ent].foreignKey;
                        if ($that.chechUnsupportedWords(name)) {
                            entitiesList.push(`'${name}'`);
                        } else {
                            entitiesList.push(name);
                        }
                    }
                }
            }
        }

        // Ensure primary key is always included
        try {
            const pk = this.getPrimarykey(entity);
            if (pk) {
                const hasPk = entitiesList.indexOf(pk) !== -1 || entitiesList.indexOf(`\`${pk}\``) !== -1;
                if (!hasPk) { entitiesList.unshift(pk); }
            }
        } catch (_) { /* ignore */ }

        return entitiesList;
    }

    chechUnsupportedWords(word) {
        for (const item in this.unsupportedWords) {
            const text = this.unsupportedWords[item];
            if (text === word) {
                return true;
            }
        }
        return false;
    }

    /**
     * Build SQL SET clause with parameterized queries (MySQL uses ?)
     */
    _buildSQLEqualToParameterized(model) {
        const $that = this;
        const sqlParts = [];
        const params = [];
        const dirtyFields = (model.__dirtyFields || []).filter(f => !(model.__entity[f] && model.__entity[f].computedSql));   // computed columns are never written

        for (const column in dirtyFields) {
            const fieldName = dirtyFields[column];
            const entityDef = model.__entity[fieldName];

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
                    sqlParts.push(`\`${foreignKey}\` = ?`);
                    params.push(fkValue);
                    break;
                }

                case "integer": {
                    let intValue = model["_" + dirtyFields[column]];
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
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(intValue);
                    break;
                }

                case "string": {
                    let strValue = model["_" + dirtyFields[column]];
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
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(strValue);
                    break;
                }

                case "boolean": {
                    let boolValue = model["_" + dirtyFields[column]];
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
                    const bool = model.__entity[dirtyFields[column]].valueConversion ? tools.convertBooleanToNumber(boolValue) : boolValue;
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(bool);
                    break;
                }

                case "time": {
                    let timeValue = model["_" + dirtyFields[column]];
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
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(timeValue);
                    break;
                }

                case "hasMany":
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(model["_" + dirtyFields[column]]);
                    break;

                default: {
                    // Covers `text` and any other column type without a dedicated
                    // case above. Run the toDatabase transformer here too so that
                    // fields with a serializer (e.g. JSON text columns) get their
                    // object values turned into scalars before they reach the driver.
                    let rawValue = model["_" + dirtyFields[column]];
                    if (rawValue === undefined) {
                        rawValue = model[dirtyFields[column]];
                    }
                    try {
                        rawValue = FieldTransformer.toDatabase(rawValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    sqlParts.push(`\`${dirtyFields[column]}\` = ?`);
                    params.push(rawValue);
                }
            }
        }

        return sqlParts.length > 0 ? { sql: sqlParts.join(', '), params: params } : -1;
    }

    /**
     * Build parameterized INSERT object for MySQL (uses ?)
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
                // function is never a valid column value. This keeps the batched
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
                    try {
                        fieldColumn = $that._validateAndCoerceFieldType(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch (typeError) {
                        throw new Error(`INSERT failed: ${typeError.message}`);
                    }

                    fieldColumn = $that._convertValueForDatabase(fieldColumn, modelEntity[column].type);

                    const relationship = modelEntity[column].relationshipType;
                    const actualColumn = relationship === "belongsTo" ? modelEntity[column].foreignKey : column;
                    columnNames.push(`\`${actualColumn}\``);
                    params.push(fieldColumn);
                } else {
                    switch (modelEntity[column].type) {
                        case "belongsTo": {
                            const fieldObject = tools.findTrackedObject(fields.__context.__trackedEntities, column);
                            if (Object.keys(fieldObject).length > 0) {
                                const primaryKey = tools.getPrimaryKeyObject(fieldObject.__entity);
                                fieldColumn = fieldObject[primaryKey];
                                const actualColumn = modelEntity[column].foreignKey;
                                columnNames.push(`\`${actualColumn}\``);
                                params.push(fieldColumn);
                            }
                            break;
                        }
                    }
                }
            }
        }

        if (columnNames.length > 0) {
            const placeholders = params.map(() => '?').join(', ');
            return {
                tableName: modelEntity.__name,
                columns: columnNames.join(', '),
                placeholders: placeholders,
                params: params
            };
        } else {
            return -1;
        }
    }

    _buildDeleteObject(currentModel) {
        const primaryKey = currentModel.__Key === undefined ? tools.getPrimaryKeyObject(currentModel.__entity) : currentModel.__Key;
        const value = currentModel.__value === undefined ? currentModel[primaryKey] : currentModel.__value;
        const tableName = currentModel.__tableName === undefined ? currentModel.__entity.__name : currentModel.__tableName;
        return { tableName: tableName, primaryKey: primaryKey, value: value };
    }

    /**
     * Convert validated value to database-specific format
     */
    _convertValueForDatabase(value, fieldType) {
        if (value === undefined || value === null) {
            return value;
        }

        // MySQL boolean conversion: JavaScript boolean → TINYINT (1/0)
        if (fieldType === 'boolean' && typeof value === 'boolean') {
            return value ? 1 : 0;
        }

        return value;
    }

    /**
     * Validate and coerce field type
     */
    _validateAndCoerceFieldType(value, entityDef, entityName, fieldName) {
        if (value === undefined || value === null) {
            return value;
        }

        const expectedType = entityDef.type;
        const actualType = typeof value;

        switch (expectedType) {
            case "integer":
                if (actualType === 'number') {
                    if (!Number.isInteger(value)) {
                        console.warn(`⚠️  Field ${entityName}.${fieldName}: Expected integer but got float ${value}, rounding to ${Math.round(value)}`);
                        return Math.round(value);
                    }
                    return value;
                }
                if (actualType === 'string') {
                    const parsed = parseInt(value, 10);
                    if (isNaN(parsed)) {
                        throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected integer, got string "${value}" which cannot be converted to a number`);
                    }
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting string "${value}" to integer ${parsed}`);
                    return parsed;
                }
                if (actualType === 'boolean') {
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting boolean ${value} to integer ${value ? 1 : 0}`);
                    return value ? 1 : 0;
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected integer, got ${actualType} with value ${JSON.stringify(value)}`);

            case "string":
                if (actualType === 'string') {
                    return value;
                }
                if (['number', 'boolean'].includes(actualType)) {
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting ${actualType} ${value} to string "${String(value)}"`);
                    return String(value);
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected string, got ${actualType} with value ${JSON.stringify(value)}`);

            case "boolean":
            case "bool":
                if (typeof value === 'boolean') return value;
                if (value === 1 || value === '1' || value === 'true' || value === true) return true;
                if (value === 0 || value === '0' || value === 'false' || value === false) return false;
                throw new Error(`Invalid boolean value: ${value}`);

            case "time":
                if (actualType === 'string' || actualType === 'number') {
                    return value;
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected time (string/number), got ${actualType} with value ${JSON.stringify(value)}`);

            default:
                if (actualType === 'object') {
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Setting object value for type "${expectedType}". This may cause issues.`);
                }
                return value;
        }
    }

    /**
     * Execute raw SQL (DDL statements like CREATE TABLE, ALTER TABLE, etc.)
     * Used by migration schema for non-parameterized DDL queries.
     */
    _execute(query, params) {
        // Migration/DDL path — flag it so the statement is always logged
        // (migrations must be observable in production).
        return this._runWithParams(query, params || [], { migration: true });
    }

    /**
     * Execute parameterized query with mysql2/promise
     */
    async _runWithParams(query, params = [], opts = {}) {
        try {
            // Migration DDL (opts.migration) is always logged so production
            // migrations are observable; runtime queries stay behind the
            // dev/LOG_SQL gate to avoid noise.
            const isMigration = opts.migration === true;
            // Logging (redacted params, slow-query warnings, migration DDL) is
            // handled centrally by logging.js via _notifyCommand below.

            // When a transaction is open, run on its dedicated connection so
            // every statement is part of the same atomic unit; otherwise use
            // the pool (which grabs any free connection).
            const runner = this._txnConn || this.pool;
            const start = process.hrtime.bigint();
            try {
                const [results] = await runner.execute(query, params);
                this._notifyCommand({ sql: query, params, durationMs: Number(process.hrtime.bigint() - start) / 1e6, engine: 'mysql', migration: isMigration });
                return results;
            } catch (error) {
                this._notifyCommand({ sql: query, params, durationMs: Number(process.hrtime.bigint() - start) / 1e6, engine: 'mysql', error, migration: isMigration });
                throw error;
            }
        } catch (error) {
            console.error('MySQL query error:', error);
            throw error;
        }
    }

    // ---- Command observation (EF IDbCommandInterceptor / CommandExecuted) ----
    addCommandObserver(fn){ (this.__commandObservers ||= new Set()).add(fn); }
    removeCommandObserver(fn){ if (this.__commandObservers) this.__commandObservers.delete(fn); }
    _notifyCommand(info){
        logCommand(info);
        if (!this.__commandObservers || this.__commandObservers.size === 0) return;
        for (const fn of Array.from(this.__commandObservers)) {
            try { fn(info); } catch (e) { console.error('[MySQL] command observer threw:', e); }
        }
    }

    // --- Transactions -----------------------------------------------------
    // saveChanges() brackets all inserts/updates/deletes so a partial failure
    // rolls the whole batch back. Without this, MySQL writes were autocommitted
    // one statement at a time and a mid-batch error left partial data.

    async startTransaction(){
        if(this._txnConn){ return; } // already inside a transaction
        this._txnConn = await this.pool.getConnection();
        await this._txnConn.beginTransaction();
    }

    async endTransaction(){
        if(!this._txnConn){ return; }
        const conn = this._txnConn;
        this._txnConn = null;
        try {
            await conn.commit();
        } finally {
            conn.release();
        }
    }

    async errorTransaction(){
        if(!this._txnConn){ return; }
        const conn = this._txnConn;
        this._txnConn = null;
        try {
            await conn.rollback();
        } finally {
            conn.release();
        }
    }

    inTransaction(){
        return !!this._txnConn;
    }

    // Nested rollback points so a failed bulk write can be undone without
    // aborting the enclosing transaction. `name` is an internal identifier.
    async savepoint(name){
        return (this._txnConn || this.pool).query(`SAVEPOINT ${name}`);
    }

    async releaseSavepoint(name){
        return (this._txnConn || this.pool).query(`RELEASE SAVEPOINT ${name}`);
    }

    async rollbackToSavepoint(name){
        return (this._txnConn || this.pool).query(`ROLLBACK TO SAVEPOINT ${name}`);
    }

    /**
     * Sanitize single quotes (legacy, prefer parameterized queries)
     */
    _santizeSingleQuotes(value, context) {
        if (typeof value === 'string' || value instanceof String) {
            return value.replace(/'/g, "''");
        } else {
            const details = context || {};
            const entityName = details.entityName || 'UnknownEntity';
            const fieldName = details.fieldName || 'UnknownField';
            const valueType = (value === null) ? 'null' : (value === undefined ? 'undefined' : typeof value);
            let preview;
            try {
                preview = (value === null || value === undefined) ? String(value) : JSON.stringify(value);
            } catch (_) {
                preview = '[unserializable]';
            }
            if (preview && preview.length > 120) { preview = preview.substring(0, 120) + '…'; }
            const message = `Field is not a string: entity=${entityName}, field=${fieldName}, type=${valueType}, value=${preview}`;
            console.error(message);
            throw new Error(message);
        }
    }

    /**
     * Close database connection pool
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('MySQL pool closed');
        }
    }
}

export default MySQLEngine;
