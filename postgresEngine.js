// Version 0.1.0 - Complete PostgreSQL implementation with pg 8.16.3
import tools from './Tools.js';
import FieldTransformer from './Entity/fieldTransformer.js';
import pg from 'pg';

const { Pool } = pg;

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
        // Security: ONLY use parameterized queries - no fallback to string concatenation
        // query.arg must contain {query, params} from _buildSQLEqualToParameterized
        if (!query.arg || typeof query.arg !== 'object' || !query.arg.query || !query.arg.params) {
            throw new Error('UPDATE failed: Invalid parameterized query structure. Check entity definition.');
        }

        const sqlQuery = `UPDATE ${query.tableName} SET ${query.arg.query} WHERE ${query.tableName}.${query.primaryKey} = $${query.arg.params.length + 1}`;
        // Add primaryKeyValue to params array
        const params = [...query.arg.params, query.primaryKeyValue];
        return await this._runWithParams(sqlQuery, params);
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
     * Batch insert using PostgreSQL's multi-value INSERT with RETURNING
     */
    async bulkInsert(entities) {
        if (!entities || entities.length === 0) return [];

        // Group by table name
        const byTable = {};
        for (const entity of entities) {
            const tableName = entity.__entity.__name;
            if (!byTable[tableName]) byTable[tableName] = [];
            byTable[tableName].push(entity);
        }

        const results = [];
        for (const tableName in byTable) {
            const tableEntities = byTable[tableName];
            const primaryKey = tools.getPrimaryKeyObject(tableEntities[0].__entity);

            // Build multi-value INSERT
            const first = this._buildSQLInsertObjectParameterized(tableEntities[0], tableEntities[0].__entity);
            const allParams = [...first.params];
            let paramIndex = first.params.length + 1;
            const valueGroups = [`(${first.placeholders})`];

            for (let i = 1; i < tableEntities.length; i++) {
                const sqlObj = this._buildSQLInsertObjectParameterized(tableEntities[i], tableEntities[i].__entity);
                // Renumber placeholders
                const placeholders = sqlObj.params.map(() => `$${paramIndex++}`).join(', ');
                valueGroups.push(`(${placeholders})`);
                allParams.push(...sqlObj.params);
            }

            const query = `INSERT INTO "${first.tableName}" (${first.columns}) VALUES ${valueGroups.join(', ')} RETURNING ${primaryKey}`;
            const result = await this._runWithParams(query, allParams);

            // PostgreSQL returns rows with the primary key values
            // Convert to consistent format: { id: value }
            for (const row of result.rows) {
                results.push({ id: row[primaryKey] });
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
     * Batch delete using WHERE IN
     */
    async bulkDelete(tableName, ids) {
        if (!ids || ids.length === 0) return;

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        const query = `DELETE FROM "${tableName}" WHERE id IN (${placeholders})`;
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
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryString.query);
                    console.debug("[Params]", queryString.params || []);
                }
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
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryString.query);
                    console.debug("[Params]", queryString.params);
                }
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
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", selectQuery.query);
                    console.debug("[Params]", selectQuery.params || []);
                }
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

        const sql = `SELECT ${this.buildSelectString(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)} ${this.buildLimit(query)} ${this.buildSkip(query)} ${this.buildOrderBy(query, entity)}`;

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
        const $that = this;

        if (andEntity) {
            const entity = this.getEntity(query.parentName, query.entityMap);
            const andList = [];

            for (let entityPart in andEntity) {
                const itemEntity = andEntity[entityPart];
                for (let table in itemEntity[query.parentName]) {
                    const item = itemEntity[query.parentName][table];
                    const expressions = [];
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

                        if (arg === "null") {
                            expressions.push(`${entityRef}.${field} ${func} ${arg}`);
                        } else {
                            // Check if arg is a parameterized placeholder
                            const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                            if (isPlaceholder || func === "IN") {
                                expressions.push(`${entityRef}.${field} ${func} ${arg}`);
                            } else {
                                expressions.push(`${entityRef}.${field} ${func} '${arg}'`);
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

                if (arg === "null") {
                    conditions.push(`${entityRef}.${field} ${func} ${arg}`);
                } else if (func === "IN") {
                    conditions.push(`${entityRef}.${field} ${func} ${arg}`);
                } else {
                    // Check if arg is a parameterized placeholder ($1, $2, etc.)
                    const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
                    if (isPlaceholder) {
                        conditions.push(`${entityRef}.${field} ${func} ${arg}`);
                    } else {
                        conditions.push(`${entityRef}.${field} ${func} '${arg}'`);
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

    buildOrderBy(query, entity) {
        if (query.orderBy) {
            // Security: Validate field exists in entity
            if (entity && !entity[query.orderBy]) {
                throw new Error(`Invalid ORDER BY field: ${query.orderBy} not found in ${entity.__name || 'entity'}`);
            }
            const entityStr = this.getEntity(query.parentName, query.entityMap);
            return `ORDER BY ${entityStr}.${query.orderBy} ASC`;
        } else if (query.orderByDescending) {
            // Security: Validate field exists in entity
            if (entity && !entity[query.orderByDescending]) {
                throw new Error(`Invalid ORDER BY field: ${query.orderByDescending} not found in ${entity.__name || 'entity'}`);
            }
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
     * Build SQL SET clause with parameterized queries for UPDATE (PostgreSQL)
     * Returns {query: "column1 = $1, column2 = $2", params: [value1, value2]}
     */
    _buildSQLEqualToParameterized(model) {
        const $that = this;
        const sqlParts = [];
        const params = [];
        const dirtyFields = model.__dirtyFields;
        let paramIndex = 1;

        for (let column in dirtyFields) {
            const fieldName = dirtyFields[column];
            const entityDef = model.__entity[fieldName];

            // Check for required fields
            if (entityDef && entityDef.nullable === false && entityDef.primary !== true) {
                // Read the raw backing field to get the set()-transformed value,
                // bypassing get() which may change the type (e.g. parseFloat)
                let persistedValue = model["_" + fieldName];
                if (persistedValue === undefined) {
                    persistedValue = model[fieldName];
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
                case "belongsTo":
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    let fkValue = model[dirtyFields[column]];
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
                    const fore = `_${dirtyFields[column]}`;
                    sqlParts.push(`${foreignKey} = $${paramIndex++}`);
                    params.push(model[fore]);
                    break;

                case "integer":
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
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
                    params.push(intValue);
                    break;

                case "string":
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
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
                    params.push(strValue);
                    break;

                case "boolean":
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
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
                    params.push(boolValue);
                    break;

                case "time":
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
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
                    params.push(timeValue);
                    break;

                case "hasMany":
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
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
                    sqlParts.push(`${dirtyFields[column]} = $${paramIndex++}`);
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
        let paramIndex = 1;

        for (const column in modelEntity) {
            if (column.indexOf("__") === -1) {
                let fieldColumn = fields[column];

                // 🔥 FIX: For belongsTo relationships, also check the foreignKey field name
                // Users can set either orgRole.User = obj OR orgRole.user_id = 2
                if ((fieldColumn === undefined || fieldColumn === null) &&
                    modelEntity[column].relationshipType === "belongsTo" &&
                    modelEntity[column].foreignKey) {
                    fieldColumn = fields[modelEntity[column].foreignKey];
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
                if (typeof value === 'boolean') return value;
                if (value === 1 || value === '1' || value === 'true' || value === true) return true;
                if (value === 0 || value === '0' || value === 'false' || value === false) return false;
                throw new Error(`Invalid boolean value: ${value}`);

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
        return this._runWithParams(query, params || []);
    }

    async _runWithParams(query, params = []) {
        try {
            if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                console.debug("[SQL]", query);
                console.debug("[Params]", params);
            }

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

export default postgresEngine;
