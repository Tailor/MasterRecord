// Version 1.0.0 - Complete MySQL implementation with mysql2/promise
import tools from './Tools.js';
import FieldTransformer from './Entity/fieldTransformer.js';

class MySQLEngine {

    constructor() {
        this.pool = null;
        this.db = null;
        this.dbType = 'mysql';
        this.unsupportedWords = ["order"];
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

        const sqlQuery = `UPDATE \`${query.tableName}\` SET ${query.arg.sql} WHERE \`${query.tableName}\`.\`${query.primaryKey}\` = ?`;
        const params = [...query.arg.params, query.primaryKeyValue];
        return await this._runWithParams(sqlQuery, params);
    }

    /**
     * DELETE with parameterized query
     */
    async delete(queryObject) {
        const sqlObject = this._buildDeleteObject(queryObject);
        const sqlQuery = `DELETE FROM \`${sqlObject.tableName}\` WHERE \`${sqlObject.tableName}\`.\`${sqlObject.primaryKey}\` = ?`;
        return await this._runWithParams(sqlQuery, [sqlObject.value]);
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

            // Build multi-value INSERT
            const first = this._buildSQLInsertObjectParameterized(tableEntities[0], tableEntities[0].__entity);
            const allParams = [...first.params];
            const valueGroups = [`(${first.placeholders})`];

            for (let i = 1; i < tableEntities.length; i++) {
                const sqlObj = this._buildSQLInsertObjectParameterized(tableEntities[i], tableEntities[i].__entity);
                valueGroups.push(`(${sqlObj.placeholders})`);
                allParams.push(...sqlObj.params);
            }

            const query = `INSERT INTO \`${first.tableName}\` (${first.columns}) VALUES ${valueGroups.join(', ')}`;
            const result = await this._runWithParams(query, allParams);

            // MySQL returns insertId (first ID) and affectedRows (count)
            // Generate individual result objects for each entity
            const firstId = result.insertId;
            for (let i = 0; i < tableEntities.length; i++) {
                results.push({ id: firstId + i });
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
     * Batch delete using WHERE IN
     */
    async bulkDelete(tableName, ids) {
        if (!ids || ids.length === 0) return;

        const placeholders = ids.map(() => '?').join(', ');
        const query = `DELETE FROM \`${tableName}\` WHERE id IN (${placeholders})`;
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
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryString.query);
                    console.debug("[Params]", params);
                }
                const result = await this._runWithParams(queryString.query, params);
                return result[0] || null;
            }
            return null;
        } catch (err) {
            console.error('MySQL get error:', err);
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
                queryString = { query: query.raw };
            } else {
                queryString = this.buildQuery(query, entity, context);
            }

            if (queryString.query) {
                const queryCount = queryObject.count(queryString.query);
                const params = query.parameters ? query.parameters.getParams() : [];
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryCount);
                    console.debug("[Params]", params);
                }
                const result = await this._runWithParams(queryCount, params);
                return result[0] || null;
            }
            return null;
        } catch (err) {
            console.error('MySQL getCount error:', err);
            return null;
        }
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
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryString.query);
                    console.debug("[Params]", params);
                }
                const result = await this._runWithParams(queryString.query, params);
                return result || [];
            }
            return [];
        } catch (err) {
            console.error('MySQL all error:', err);
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
     * Introspection: Check if table exists
     */
    async tableExists(tableName) {
        try {
            const sql = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
            const res = await this._runWithParams(sql, [tableName]);
            return Array.isArray(res) ? res.length > 0 : !!res?.length;
        } catch (_) {
            return false;
        }
    }

    /**
     * Introspection: Get table column information
     */
    async getTableInfo(tableName) {
        try {
            const sql = `SELECT COLUMN_NAME as name, COLUMN_DEFAULT as dflt_value, IS_NULLABLE as is_nullable, DATA_TYPE as data_type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
            const res = await this._runWithParams(sql, [tableName]);
            return res || [];
        } catch (_) {
            return [];
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
            where: this.buildWhere(query, entity)
        };

        const queryString = `${queryObject.select} ${queryObject.from} ${queryObject.include} ${queryObject.where}`;
        return {
            query: queryString,
            entity: this.getEntity(entity.__name, query.entityMap)
        };
    }

    buildSelect(query, entity) {
        const select = "SELECT";
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

        for (let part in query.include) {
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
            let field = expr.field.toLowerCase();
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
            let arg = expr.arg;
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
                return `${ent}.\`${field}\` ${func} ${arg}`;
            }
            if (func === "IN") {
                return `${ent}.\`${field}\` ${func} ${arg}`;
            }
            const isPlaceholder = (arg === '?');
            if (isPlaceholder) {
                return `${ent}.\`${field}\` ${func} ${arg}`;
            }
            const safeArg = (typeof arg === 'string' || arg instanceof String)
                ? $that._santizeSingleQuotes(arg, { entityName: ent, fieldName: field })
                : String(arg);
            return `${ent}.\`${field}\` ${func} '${safeArg}'`;
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
        for (let item in maps) {
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
        const dirtyFields = model.__dirtyFields;

        for (const column in dirtyFields) {
            const fieldName = dirtyFields[column];
            const entityDef = model.__entity[fieldName];

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
                    const fore = `_${dirtyFields[column]}`;
                    sqlParts.push(`\`${foreignKey}\` = ?`);
                    params.push(model[fore]);
                    break;

                case "integer":
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

                case "string":
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

                case "boolean":
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

                case "time":
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
                        case "belongsTo":
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
        return this._runWithParams(query, params || []);
    }

    /**
     * Execute parameterized query with mysql2/promise
     */
    async _runWithParams(query, params = []) {
        try {
            if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                console.debug("[SQL]", query);
                console.debug("[Params]", params);
            }

            const [results] = await this.pool.execute(query, params);
            return results;
        } catch (error) {
            console.error('MySQL query error:', error);
            throw error;
        }
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
