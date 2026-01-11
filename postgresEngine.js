// Version 0.1.0 - Complete PostgreSQL implementation with pg 8.16.3
const tools = require('./Tools');
const FieldTransformer = require('./Entity/fieldTransformer');
const { Pool } = require('pg');

class postgresEngine {

    constructor() {
        this.pool = null;
        this.db = null;
        this.dbType = 'postgres';
        this.unsupportedWords = ["order"];
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
        if (query.arg && query.arg.query && query.arg.params) {
            // Parameterized UPDATE
            const params = [...query.arg.params, query.primaryKeyValue];
            return await this._runWithParams(query.arg.query, params);
        } else {
            // Fallback for legacy support
            const sqlQuery = `UPDATE ${query.tableName} SET ${query.arg} WHERE ${query.tableName}.${query.primaryKey} = $1`;
            return await this._runWithParams(sqlQuery, [query.primaryKeyValue]);
        }
    }

    /**
     * DELETE with parameterized query
     */
    async delete(queryObject) {
        const sqlObject = this._buildDeleteObject(queryObject);
        const sqlQuery = `DELETE FROM ${sqlObject.tableName} WHERE ${sqlObject.tableName}.${sqlObject.primaryKey} = $1`;
        return await this._runWithParams(sqlQuery, [sqlObject.value]);
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
        const query = `INSERT INTO ${sqlObject.tableName} (${sqlObject.columns}) VALUES (${sqlObject.placeholders}) RETURNING ${primaryKey}`;

        const result = await this._runWithParams(query, sqlObject.params);

        return {
            id: result.rows[0][primaryKey]
        };
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
                console.log("SQL:", queryString.query);
                console.log("Params:", queryString.params || []);
                const result = await this._runWithParams(queryString.query, queryString.params || []);
                return result.rows[0] || null;
            }
            return null;
        } catch (err) {
            console.error('PostgreSQL get error:', err);
            return null;
        }
    }

    /**
     * SELECT COUNT
     */
    async getCount(queryObject, entity, context) {
        const query = queryObject.script;
        try {
            let queryString;
            if (query.raw) {
                queryString = { query: query.raw, params: [] };
            } else {
                if (query.count === undefined) {
                    query.count = "none";
                }
                const entityAlias = this.getEntity(entity.__name, query.entityMap);
                queryString = {
                    query: `SELECT ${this.buildCount(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)}`,
                    params: query.parameters ? query.parameters.getParams() : []
                };
            }

            if (queryString.query) {
                console.log("SQL:", queryString.query);
                console.log("Params:", queryString.params);
                const result = await this._runWithParams(queryString.query, queryString.params);
                return result.rows[0] || null;
            }
            return null;
        } catch (err) {
            console.error('PostgreSQL getCount error:', err);
            return null;
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
                console.log("SQL:", selectQuery.query);
                console.log("Params:", selectQuery.params || []);
                const result = await this._runWithParams(selectQuery.query, selectQuery.params || []);
                return result.rows || [];
            }
            return [];
        } catch (err) {
            console.error('PostgreSQL all error:', err);
            return [];
        }
    }

    /**
     * Execute raw SQL with parameters
     */
    async exec(query, params = []) {
        return await this._runWithParams(query, params);
    }

    /**
     * Build complete SELECT query with parameters
     */
    buildQuery(query, entity, context) {
        const entityStr = this.getEntity(entity.__name, query.entityMap);
        const params = query.parameters ? query.parameters.getParams() : [];

        const sql = `SELECT ${this.buildSelectString(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)} ${this.buildLimit(query)} ${this.buildSkip(query)} ${this.buildOrderBy(query)}`;

        return {
            query: sql,
            params: params
        };
    }

    buildSelectString(query, entity) {
        if (query.select) {
            return query.select;
        }
        return `${tools.convertEntityToSelectParameterString(entity)}`;
    }

    buildCount(query, entity) {
        const entityStr = this.getEntity(entity.__name, query.entityMap);
        if (query.count === "none") {
            return `COUNT(${entityStr}.*)`;
        }
        return `COUNT(${entityStr}.${query.count})`;
    }

    buildFrom(query, entity) {
        return `FROM ${entity.__name}`;
    }

    /**
     * Build AND clause with placeholder detection
     */
    buildAnd(query, mainQuery) {
        const andEntity = query.and;
        let strQuery = "";
        const $that = this;

        if (andEntity) {
            const entity = this.getEntity(query.parentName, query.entityMap);
            const andList = [];

            for (let entityPart in andEntity) {
                const itemEntity = andEntity[entityPart];
                for (let table in itemEntity[query.parentName]) {
                    const item = itemEntity[query.parentName][table];
                    for (let exp in item.expressions) {
                        let field = tools.capitalizeFirstLetter(item.expressions[exp].field);
                        let entityRef = entity;

                        if (mainQuery[field] && mainQuery[field].isNavigational) {
                            entityRef = $that.getEntity(field, query.entityMap);
                            field = item.fields[1];
                        }

                        let func = item.expressions[exp].func;
                        const arg = item.expressions[exp].arg;

                        // Handle NULL
                        if (arg === "null") {
                            if (func === "=") func = "IS";
                            if (func === "!=") func = "IS NOT";
                        }

                        if (strQuery === "") {
                            if (arg === "null") {
                                strQuery = `${entityRef}.${field} ${func} ${arg}`;
                            } else {
                                // Check if arg is a parameterized placeholder
                                const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                                if (isPlaceholder || func === "IN") {
                                    strQuery = `${entityRef}.${field} ${func} ${arg}`;
                                } else {
                                    strQuery = `${entityRef}.${field} ${func} '${arg}'`;
                                }
                            }
                        } else {
                            if (arg === "null") {
                                strQuery = `${strQuery} AND ${entityRef}.${field} ${func} ${arg}`;
                            } else {
                                // Check if arg is a parameterized placeholder
                                const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                                if (isPlaceholder || func === "IN") {
                                    strQuery = `${strQuery} AND ${entityRef}.${field} ${func} ${arg}`;
                                } else {
                                    strQuery = `${strQuery} AND ${entityRef}.${field} ${func} '${arg}'`;
                                }
                            }
                        }
                    }
                    andList.push(strQuery);
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
        let strQuery = "";
        const $that = this;

        if (whereEntity) {
            const entity = this.getEntity(query.parentName, query.entityMap);
            const item = whereEntity[query.parentName].query;

            for (let exp in item.expressions) {
                let field = tools.capitalizeFirstLetter(item.expressions[exp].field);
                let entityRef = entity;

                if (mainQuery[field] && mainQuery[field].isNavigational) {
                    entityRef = $that.getEntity(field, query.entityMap);
                    field = item.fields[1];
                }

                let func = item.expressions[exp].func;
                const arg = item.expressions[exp].arg;

                // Handle NULL
                if (arg === "null") {
                    if (func === "=") func = "IS";
                    if (func === "!=") func = "IS NOT";
                }

                if (strQuery === "") {
                    if (arg === "null") {
                        strQuery = `WHERE ${entityRef}.${field} ${func} ${arg}`;
                    } else if (func === "IN") {
                        strQuery = `WHERE ${entityRef}.${field} ${func} ${arg}`;
                    } else {
                        // Check if arg is a parameterized placeholder ($1, $2, etc.)
                        const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                        if (isPlaceholder) {
                            strQuery = `WHERE ${entityRef}.${field} ${func} ${arg}`;
                        } else {
                            strQuery = `WHERE ${entityRef}.${field} ${func} '${arg}'`;
                        }
                    }
                } else {
                    if (arg === "null") {
                        strQuery = `${strQuery} AND ${entityRef}.${field} ${func} ${arg}`;
                    } else if (func === "IN") {
                        strQuery = `${strQuery} AND ${entityRef}.${field} ${func} ${arg}`;
                    } else {
                        // Check if arg is a parameterized placeholder
                        const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                        if (isPlaceholder) {
                            strQuery = `${strQuery} AND ${entityRef}.${field} ${func} ${arg}`;
                        } else {
                            strQuery = `${strQuery} AND ${entityRef}.${field} ${func} '${arg}'`;
                        }
                    }
                }
            }
        }

        return strQuery;
    }

    buildLimit(query) {
        if (query.take) {
            return `LIMIT ${query.take}`;
        }
        return "";
    }

    buildSkip(query) {
        if (query.skip) {
            return `OFFSET ${query.skip}`;
        }
        return "";
    }

    buildOrderBy(query) {
        if (query.orderBy) {
            const entityStr = this.getEntity(query.parentName, query.entityMap);
            return `ORDER BY ${entityStr}.${query.orderBy} ASC`;
        } else if (query.orderByDescending) {
            const entityStr = this.getEntity(query.parentName, query.entityMap);
            return `ORDER BY ${entityStr}.${query.orderByDescending} DESC`;
        }
        return "";
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
     * Build parameterized INSERT object for PostgreSQL
     * Uses $1, $2, $3... instead of ?
     */
    _buildSQLInsertObjectParameterized(fields, modelEntity) {
        const $that = this;
        const columnNames = [];
        const params = [];
        let paramIndex = 1;

        for (const column in modelEntity) {
            if (column.indexOf("__") === -1) {
                let fieldColumn = fields[column];

                if ((fieldColumn !== undefined && fieldColumn !== null) && typeof(fieldColumn) !== "object") {
                    // Apply toDatabase transformer
                    try {
                        fieldColumn = FieldTransformer.toDatabase(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch (transformError) {
                        throw new Error(`INSERT failed: ${transformError.message}`);
                    }

                    // Validate and coerce type
                    try {
                        fieldColumn = $that._validateAndCoerceFieldType(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch (typeError) {
                        throw new Error(`INSERT failed: ${typeError.message}`);
                    }

                    // Skip auto-increment primary keys
                    if (modelEntity[column].auto !== true) {
                        columnNames.push(column);
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
            case 'int':
                const intVal = parseInt(value, 10);
                if (isNaN(intVal)) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be an integer, got: ${value}`);
                }
                return intVal;

            case 'float':
            case 'double':
            case 'decimal':
                const floatVal = parseFloat(value);
                if (isNaN(floatVal)) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be a number, got: ${value}`);
                }
                return floatVal;

            case 'boolean':
            case 'bool':
                return Boolean(value);

            case 'date':
            case 'datetime':
            case 'timestamp':
                if (value instanceof Date) {
                    return value;
                }
                const dateVal = new Date(value);
                if (isNaN(dateVal.getTime())) {
                    throw new Error(`Field '${entityName}.${fieldName}' must be a valid date, got: ${value}`);
                }
                return dateVal;

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
     * Execute parameterized query with pg library
     */
    async _runWithParams(query, params = []) {
        try {
            console.log("SQL:", query);
            console.log("Params:", params);

            const client = await this.pool.connect();
            try {
                const result = await client.query(query, params);
                return result;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL query error:', error);
            throw error;
        }
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

module.exports = postgresEngine;
