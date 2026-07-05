// Version 0.0.23
import tools from './Tools.js';
import FieldTransformer from './Entity/fieldTransformer.js';

class SQLLiteEngine {

    unsupportedWords = ["order"]

    async update(query){
        // Security: ONLY use parameterized queries - no fallback to string concatenation
        // query.arg must contain {sql, params} from _buildSQLEqualToParameterized
        if(!query.arg || typeof query.arg !== 'object' || !query.arg.sql || !query.arg.params){
            throw new Error('UPDATE failed: Invalid parameterized query structure. Check entity definition.');
        }

        const sqlQuery = ` UPDATE [${query.tableName}]
        SET ${query.arg.sql}
        WHERE [${query.tableName}].[${query.primaryKey}] = ?`;
        // Add primaryKeyValue to params array
        const params = [...query.arg.params, query.primaryKeyValue];
        return Promise.resolve(this._runWithParams(sqlQuery, params));
    }

    async delete(queryObject){
       const sqlObject = this._buildDeleteObject(queryObject);
       // Use parameterized query to prevent SQL injection
       const sqlQuery = `DELETE FROM [${sqlObject.tableName}] WHERE [${sqlObject.tableName}].[${sqlObject.primaryKey}] = ?`;
       return Promise.resolve(this._executeWithParams(sqlQuery, [sqlObject.value]));
    }

    async insert(queryObject){
        // Use NEW SECURE parameterized version
        const sqlObject = this._buildSQLInsertObjectParameterized(queryObject, queryObject.__entity);
        if(sqlObject === -1){
            throw new Error('INSERT failed: No columns to insert');
        }
        const query = `INSERT INTO [${sqlObject.tableName}] (${sqlObject.columns})
        VALUES (${sqlObject.placeholders})`;
        const queryObj = this._runWithParams(query, sqlObject.params);
        const open = {
            "id": queryObj.lastInsertRowid
        };
        return Promise.resolve(open);
    }

    /**
     * Batch insert multiple entities in a single transaction
     * Performance: 100x faster than N separate inserts
     */
    async bulkInsert(entities) {
        if (!entities || entities.length === 0) return Promise.resolve([]);

        const results = [];
        // SQLite: Use transaction for batch inserts (only if not already in one)
        const needsTransaction = !this.db.inTransaction;
        if (needsTransaction) {
            await this.startTransaction();
        }
        try {
            for (const entity of entities) {
                const result = await this.insert(entity);
                results.push(result);
            }
            if (needsTransaction) {
                await this.endTransaction();
            }
            return Promise.resolve(results);
        } catch (error) {
            if (needsTransaction) {
                await this.errorTransaction();
            }
            throw error;
        }
    }

    /**
     * Batch update multiple entities
     */
    async bulkUpdate(updateQueries) {
        if (!updateQueries || updateQueries.length === 0) return Promise.resolve();

        // Only start transaction if not already in one
        const needsTransaction = !this.db.inTransaction;
        if (needsTransaction) {
            await this.startTransaction();
        }
        try {
            for (const query of updateQueries) {
                await this.update(query);
            }
            if (needsTransaction) {
                await this.endTransaction();
            }
        } catch (error) {
            if (needsTransaction) {
                await this.errorTransaction();
            }
            throw error;
        }
    }

    /**
     * Batch delete multiple entities using WHERE IN
     */
    async bulkDelete(tableName, ids, primaryKey = 'id') {
        if (!ids || ids.length === 0) return Promise.resolve();

        const placeholders = ids.map(() => '?').join(', ');
        const query = `DELETE FROM [${tableName}] WHERE [${primaryKey}] IN (${placeholders})`;
        return Promise.resolve(this._runWithParams(query, ids));
    }

    async get(query, entity, context){
        let queryString = {};
        try {
            if(query.raw){
                queryString.query = query.raw;
            }
            else{
                if(typeof query === 'string'){
                    queryString.query = query;
                }
                else{
                    queryString = this.buildQuery(query, entity, context);
                }
            }
            if(queryString.query){
                // Get parameters from query script
                const params = query.parameters ? query.parameters.getParams() : [];
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryString.query);
                    console.debug("[Params]", params);
                }
                const queryReturn = this.db.prepare(queryString.query).get(...params);
                return Promise.resolve(queryReturn);
            }
            return Promise.resolve(null);
        } catch (err) {
            console.error(err);
            return Promise.resolve(null);
        }
    }

    // Introspection helpers
    async tableExists(tableName){
        // A genuinely-absent table returns no row -> false. A real failure
        // (locked/corrupt db, etc.) MUST throw — never disguise an error as
        // "table absent", or schema.createTable() silently blind-creates and
        // skips column syncs with no error.
        try{
            // Use parameterized query to prevent SQL injection
            const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
            const row = this.db.prepare(sql).get(tableName);
            return !!row;
        }catch(err){
            throw new Error(`masterrecord: could not determine whether table '${tableName}' exists (SQLite introspection failed): ${err.message}`);
        }
    }

    async getTableInfo(tableName){
        // Security: Validate table name to prevent SQL injection — PRAGMA
        // can't be parameterized. An invalid name is a programming error and
        // must throw, not be swallowed into an empty column list.
        if (!tableName || typeof tableName !== 'string') {
            throw new Error('Invalid table name: must be a non-empty string');
        }
        // Allow only alphanumeric characters, underscores; must start with letter/underscore
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
            throw new Error(`Invalid table name format: ${tableName}`);
        }
        try{
            // PRAGMA on a non-existent table returns an empty list (not an
            // error), so a genuinely-absent table is [] — only real failures
            // throw.
            const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
            return rows || [];
        }catch(err){
            throw new Error(`masterrecord: could not read columns for table '${tableName}' (SQLite introspection failed): ${err.message}`);
        }
    }

    async getCount(queryObject, entity, _context){
        const query = queryObject.script;
        const queryString = {};
        try {
            if(query.raw){
                queryString.query = query.raw;
            }
            else{
                if(query.count === undefined){
                    query.count = "none";
                }
                queryString.entity = this.getEntity(entity.__name, query.entityMap);
                // Include buildAnd so chained .and() calls (separate from
                // .where()) survive into the COUNT SQL. Without this they
                // were silently dropped.
                queryString.query = `SELECT ${this.buildCount(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)} ${this.buildAnd(query, entity)}`
            }
            if(queryString.query){
                const queryCount = queryString.query
                // Get parameters from query script
                const params = query.parameters ? query.parameters.getParams() : [];
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", queryCount);
                    console.debug("[Params]", params);
                }
                const queryReturn = this.db.prepare(queryCount).get(...params);
                return Promise.resolve(queryReturn);
            }
            return Promise.resolve(null);
        } catch (err) {
            console.error(err);
            return Promise.resolve(null);
        }
    }

    async all(query, entity, context){
        let selectQuery = {};
        try {
            if(query.raw){
                selectQuery.query = query.raw;
            }
            else{

                selectQuery = this.buildQuery(query, entity, context);
            }
            if(selectQuery.query){
                // Get parameters from query script
                const params = query.parameters ? query.parameters.getParams() : [];
                if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
                    console.debug("[SQL]", selectQuery.query);
                    console.debug("[Params]", params);
                }
                const queryReturn = this.db.prepare(selectQuery.query).all(...params);
                return Promise.resolve(queryReturn);
            }
            return Promise.resolve(null);
        } catch (err) {
            console.error(err);
            return Promise.resolve(null);
        }
    }

    changeNullQuery(query){
        if(query.where){
            let whereClaus;
            whereClaus = query.where.expr.replace("=== null", "is null");
            if(whereClaus === query.where.expr){
                whereClaus = query.where.expr.replace("!= null", "is not null");
            }
            query.where.expr = whereClaus;
        }

    }

    buildCount(query, _mainQuery){
            const entity = this.getEntity(query.parentName, query.entityMap);
            if(query.count){
                if(query.count !== "none"){
                    return `COUNT(${entity}.${query.count.selectFields[0]})`
                }
                else{
                    return `COUNT(*)`
                }             
            }
            else{
                return ""
            }
    }

    buildQuery(query, entity, context, _limit){

        const queryObject = {};
        queryObject.entity = this.getEntity(entity.__name, query.entityMap);
        queryObject.select = this.buildSelect(query, entity);
        queryObject.count = this.buildCount(query, entity);
        queryObject.from = this.buildFrom(query, entity);
        queryObject.include = this.buildInclude(query, entity, context, queryObject);
        queryObject.where = this.buildWhere(query, entity);
        queryObject.and = this.buildAnd(query, entity);
        queryObject.take = this.buildTake(query);
        queryObject.skip = this.buildSkip(query);
        queryObject.orderBy = this.buildOrderBy(query, entity);

        // FTS5 full-text search bolted on top of the assembled query.
        // The FTS5 virtual table is joined by rowid==id; we add a `__rank`
        // column, a MATCH predicate against the search query, and default
        // to ordering by rank if the user didn't chain their own .orderBy().
        const fts = this._buildSearch(query, entity);
        if (fts) {
            queryObject.select = queryObject.select.replace(/\s*$/, `, ${fts.rankSelect} `);
            queryObject.from = `${queryObject.from} ${fts.join}`;
            if (queryObject.where && queryObject.where.trim().length > 0) {
                queryObject.where = `${queryObject.where} AND ${fts.predicate}`;
            } else {
                queryObject.where = `WHERE ${fts.predicate}`;
            }
            if (!queryObject.orderBy || queryObject.orderBy.trim().length === 0) {
                queryObject.orderBy = fts.defaultOrder;
            }
        }

        const queryString = `${queryObject.select} ${queryObject.count} ${queryObject.from} ${queryObject.include} ${queryObject.where} ${queryObject.and} ${queryObject.orderBy} ${queryObject.take} ${queryObject.skip}`;
        return {
                query : queryString,
                entity : this.getEntity(entity.__name, query.entityMap)
        }

    }

    /**
     * Build the FTS5 plumbing fragments for the current query if a
     * `.search()` clause was chained. Returns null if not.
     */
    _buildSearch(query, entity){
        if (!query.search) return null;
        const alias = this.getEntity(query.parentName || entity.__name, query.entityMap);
        const ftsTable = `${entity.__name}_fts`;
        // FTS5's MATCH operator does not work with bracket-quoted aliases —
        // `[_fts] MATCH ?` errors with `no such column: _fts`. We must use
        // the FTS5 table name (or an unbracketed alias) directly in MATCH.
        // Aliasing the FTS5 table also breaks MATCH; reference the table by
        // its real name throughout the JOIN and WHERE.
        const placeholder = query.parameters
            ? query.parameters.addParam(query.search.query, 'sqlite')
            : '?';
        return {
            rankSelect: `${ftsTable}.rank AS __rank`,
            join: `JOIN ${ftsTable} ON ${ftsTable}.rowid = ${alias}.id`,
            predicate: `${ftsTable} MATCH ${placeholder}`,
            // FTS5 rank is bm25; lower = more relevant. ASC gives best-first.
            defaultOrder: `ORDER BY ${ftsTable}.rank`,
        };
    }

    buildOrderBy(query, entity){
        // ORDER BY column1, column2, ... ASC|DESC;
        let orderByType = "ASC";
        let orderByEntity = query.orderBy;
        let strQuery = "";
        if(orderByEntity === false){
            orderByType = "DESC";
            orderByEntity = query.orderByDesc;
        }
        if(orderByEntity){
            // Security: Validate field exists in entity
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
                fieldList.push(`${entityAlias}.${orderByEntity.selectFields[item]}`);
            };
            strQuery = "ORDER BY";
            strQuery += ` ${fieldList.join(', ')} ${orderByType}`;
        }
        return strQuery;
    }

    buildTake(query){
        if(query.take){
            // Defense-in-depth: coerce to an integer at the SQL boundary. The
            // `.take()` setter already validates, but LIMIT cannot be
            // parameterized, so we never interpolate anything but a number.
            return `LIMIT ${this._safeRowCount(query.take, 'take')}`
        }
        else{
            return "";
        }
    }

    buildSkip(query){
        if(query.skip){
            // SQLite requires a LIMIT before OFFSET. When the caller paginated
            // with .skip() but no .take(), emit `LIMIT -1` (SQLite's documented
            // "no upper bound") so the OFFSET is valid SQL instead of a syntax
            // error. Now that .toList() no longer injects a default LIMIT 1000,
            // this is the path a bare .skip() takes.
            const skip = this._safeRowCount(query.skip, 'skip');
            return query.take ? `OFFSET ${skip}` : `LIMIT -1 OFFSET ${skip}`;
        }
        else{
            return "";
        }
    }

    // Coerce a LIMIT/OFFSET value to a non-negative integer or throw. OFFSET
    // and LIMIT are not parameterizable, so this is the last line of defense
    // against a non-numeric (injection) value reaching the SQL string.
    _safeRowCount(value, label){
        const n = typeof value === 'number' ? value : Number(value);
        if(!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)){
            throw new Error(`Invalid ${label} value for LIMIT/OFFSET: ${JSON.stringify(value)} (expected a non-negative integer)`);
        }
        return n;
    }

    buildAnd(query, mainQuery){
        // loop through the AND
        // loop update ther where .expr
        const andEntity = query.and;
        const $that = this;
        let str = "";

        if(andEntity){
            let entity = this.getEntity(query.parentName, query.entityMap);
            var andList = [];
            for (const entityPart in andEntity) { // loop through list of and's
                    const itemEntity = andEntity[entityPart]; // get the entityANd
                for (const table in itemEntity[query.parentName]) { // find the main table
                     const item = itemEntity[query.parentName][table];
                    const expressions = [];
                    for (const exp in item.expressions) {
                        // Use the field name verbatim for SQL emission; only
                        // use the capitalized form for the navigational
                        // relationship lookup (those are PascalCase keys).
                        const originalField = item.expressions[exp].field;
                        const capitalized = tools.capitalizeFirstLetter(originalField);
                        let field = originalField;
                        if(mainQuery[capitalized]){
                            if(mainQuery[capitalized].isNavigational){
                                entity = $that.getEntity(capitalized, query.entityMap);
                                field = item.fields[1];
                            }
                        }
                        if(item.expressions[exp].arg === "null"){
                            if(item.expressions[exp].func === "="){
                                item.expressions[exp].func = "is"
                            }
                            if(item.expressions[exp].func === "!="){
                                item.expressions[exp].func = "is not"
                            }
                        }
                        if(item.expressions[exp].arg === "null"){
                            tools.assertSafeOperator(item.expressions[exp].func);
                            expressions.push(`${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`);
                        }else{
                            // Check if arg is a parameterized placeholder
                            const isPlaceholder = (item.expressions[exp].arg === '?' || /^\$\d+$/.test(item.expressions[exp].arg));
                            tools.assertSafeOperator(item.expressions[exp].func);
                            if(isPlaceholder){
                                expressions.push(`${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`);
                            }else{
                                expressions.push(`${entity}.${field}  ${item.expressions[exp].func} '${tools.escapeSqlLiteral(item.expressions[exp].arg)}'`);
                            }
                        }
                    }
                    if(expressions.length > 0){
                        andList.push(expressions.join(" and "));
                    }
                }
            }
        }

        if(andList.length > 0){
            str = `and ${andList.join(" and ")}`;
        }
        return str
    }

    buildWhere(query, mainQuery){
        const whereEntity = query.where;

        const $that = this;
        if(!whereEntity){
            return "";
        }

        const entityAlias = this.getEntity(query.parentName, query.entityMap);
        const item = whereEntity[query.parentName].query;
        const exprs = item.expressions || [];

        function exprToSql(expr){
            // Preserve case for column emission. SQLite identifier matching
            // is case-insensitive so the old `.toLowerCase()` worked in
            // practice, but it would have hidden a bug if SQLite were ever
            // configured with strict case-sensitive identifiers, and it
            // produced inconsistent SQL output across engines.
            let field = expr.field;
            let ent = entityAlias;
            if(mainQuery[field]){
                if(mainQuery[field].isNavigational){
                    ent = $that.getEntity(field, query.entityMap);
                    // field alias fallback kept as original logic; if item.fields exists, use second
                    if(item.fields && item.fields[1]){
                        field = item.fields[1];
                    }
                }
            }
            let func = expr.func;
            const arg = expr.arg;
            if((!func && typeof arg === 'undefined')){
                return null;
            }
            // Removed fallback that coerced 'exists' with an argument to '='
            // Bare field or !field: interpret as IS [NOT] NULL for SQLite
            if(func === 'exists' && typeof arg === 'undefined'){
                const isNull = expr.negate === true; // '!field' -> IS NULL
                return `${ent}.${field}  is ${isNull ? '' : 'not '}null`;
            }
            if(arg === "null"){
                if(func === "=") func = "is";
                if(func === "!=") func = "is not";
                tools.assertSafeOperator(func);
                return `${ent}.${field}  ${func} ${arg}`;
            }
            if(func === "IN"){
                return `${ent}.${field}  ${func} ${arg}`;
            }
            tools.assertSafeOperator(func);
            // Check if arg is a parameterized placeholder (? for MySQL/SQLite, $1/$2/etc for Postgres)
            const isPlaceholder = (arg === '?' || /^\$\d+$/.test(arg));
            if(isPlaceholder){
                // Don't quote placeholders - they must remain as bare ? or $1
                return `${ent}.${field}  ${func} ${arg}`;
            }
            // Literal (inline lambda constant). Escape the single quote so a
            // value containing `'` can't break out of the string literal.
            return `${ent}.${field}  ${func} '${tools.escapeSqlLiteral(arg)}'`;
        }

        const pieces = [];
        for(let i = 0; i < exprs.length; i++){
            const e = exprs[i];
            if(e.group){
                const gid = e.group;
                const orParts = [];
                while(i < exprs.length && exprs[i].group === gid){
                    const sql = exprToSql(exprs[i]);
                    if(sql){ orParts.push(sql); }
                    i++;
                }
                i--; // step back one since for-loop will increment
                if(orParts.length > 0){
                    pieces.push(`(${orParts.join(" or ")})`);
                }
            }else{
                const sql = exprToSql(e);
                if(sql){ pieces.push(sql); }
            }
        }

        if(pieces.length === 0){
            return "";
        }
        return `WHERE ${pieces.join(" and ")}`;
    }

    buildInclude( query, entity, context){
        const includeQueries = [];
        for (const part in query.include) {
            const includeEntity = query.include[part];
            const $that = this;
            if(includeEntity){
                const parentObj = includeEntity[query.parentName];
                let currentContext = "";
                if(includeEntity.selectFields){
                    currentContext = context[tools.capitalizeFirstLetter(includeEntity.selectFields[0])];
                }

                if(parentObj){
                    parentObj.entityMap = query.entityMap;
                    let foreignKey = $that.getForeignKey(entity.__name, currentContext.__entity);
                    let mainPrimaryKey = $that.getPrimarykey(entity);
                    var mainEntity = $that.getEntity(entity.__name, query.entityMap);
                    if(currentContext.__entity[entity.__name].type === "hasManyThrough"){
                        const foreignTable = tools.capitalizeFirstLetter(currentContext.__entity[entity.__name].foreignTable); //to uppercase letter
                        foreignKey = $that.getPrimarykey(currentContext.__entity);
                        mainPrimaryKey = context[foreignTable].__entity[currentContext.__entity.__name].foreignKey;
                        var mainEntity = $that.getEntity(foreignTable,query.entityMap);
                    }
                    // add foreign key to select so that it picks it up
                    if(parentObj.select){
                        parentObj.select.selectFields.push(foreignKey);
                    }else{
                        parentObj.select = {};
                        parentObj.select.selectFields = [];
                        parentObj.select.selectFields.push(foreignKey);
                    }

                    const innerQuery = $that.buildQuery(parentObj, currentContext.__entity, context);

                    includeQueries.push(`LEFT JOIN (${innerQuery.query}) AS ${innerQuery.entity} ON ${ mainEntity}.${mainPrimaryKey} = ${innerQuery.entity}.${foreignKey}`);

                }
            }
        }
        return includeQueries.join(' ');
    }

    buildFrom(query, entity){
        const entityName = this.getEntity(entity.__name, query.entityMap);
        if(entityName ){
            return `FROM ${entity.__name } AS ${entityName}`;
        }
        else{ return "" }
    }

    buildSelect(query, entity){
        // this means that there is a select statement
        const select = "SELECT";
        const arr = [];
        const $that = this;
        if(query.select){
            for (const item in query.select.selectFields) {
                arr.push(`${$that.getEntity(entity.__name, query.entityMap)}.${query.select.selectFields[item]}`);
            };

        }
        else{
            const entityList = this.getEntityList(entity);
            for (const item in entityList) {
                arr.push(`${$that.getEntity(entity.__name, query.entityMap)}.${entityList[item]}`);
            };
        }
        return `${select} ${arr.join(', ')} `;
    }

    getForeignKey(name, entity){
        if(entity && name){
           return entity[name].foreignKey;
        }
    }

    getPrimarykey(entity){
            for (const item in entity) {
                if(entity[item].primary){
                    if(entity[item].primary === true){
                        return entity[item].name;
                    }
                }
            };
    }

    getForeignTable(name, entity){
        if(entity && name){
           return entity[name].foreignTable;
        }
    }

    getInclude(name, query){
        const include = query.include;
        if(include){
            for (const part in include) {
                if(tools.capitalizeFirstLetter(include[part].selectFields[0]) === name){
                    return include[part];
                }
            }
        }
        else{
            return "";
        }
    }

    getEntity(name, maps){
        for (const item in maps) {
            const map = maps[item];
            if(tools.capitalizeFirstLetter(name) === tools.capitalizeFirstLetter(map.name)){
                return map.entity
            }
        }
        // Fallthrough: return the input name so buildFrom/buildSelect still
        // produce valid SQL when entityMap has not been populated (e.g. a
        // `.count()` with no prior `.where()`). Returning "" used to produce
        // `SELECT COUNT(*)` with no FROM clause, which silently returned 1.
        // MySQL/Postgres getEntity already have this fallthrough.
        return name || "";
    }

 // return a list of entity names and skip foreign keys and underscore.
 getEntityList(entity){
    const entitiesList = [];
    const $that = this;
    for (const ent in entity) {
            if(!ent.startsWith("_")){
                // Skip lifecycle hooks - they are not database columns
                if(entity[ent].lifecycle === true){
                    continue;
                }
                if(!entity[ent].foreignKey){
                    if(entity[ent].relationshipTable){
                        if($that.chechUnsupportedWords(entity[ent].relationshipTable)){
                            entitiesList.push(`'${entity[ent].relationshipTable}'`);
                        }
                        else{
                            entitiesList.push(entity[ent].relationshipTable);
                        }
                    }
                    else{
                        if($that.chechUnsupportedWords(ent)){
                            entitiesList.push(`'${ent}'`);
                        }
                        else{
                            entitiesList.push(ent);
                        }
                    }
                }
                else{
                    
                    if(entity[ent].relationshipType === "belongsTo"){
                        const name = entity[ent].foreignKey;
                        if($that.chechUnsupportedWords(name)){
                            entitiesList.push(`'${name}'`);
                            //entitiesList.push(`'${ent}'`);
                        }
                        else{
                            entitiesList.push(name);
                            //entitiesList.push(ent);
                        }
                    }
                    
                }
            }
        }
    // Ensure primary key is always included in SELECT list
    try{
        const pk = this.getPrimarykey(entity);
        if(pk){
            const hasPk = entitiesList.indexOf(pk) !== -1 || entitiesList.indexOf(`[${pk}]`) !== -1 || entitiesList.indexOf(`'${pk}'`) !== -1;
            if(!hasPk){ entitiesList.unshift(pk); }
        }
    }catch(_){ /* ignore */ }
    return entitiesList
}
    chechUnsupportedWords(word){
        for (const item in this.unsupportedWords) {
            const text = this.unsupportedWords[item];
            if(text === word){
                return true
            }
        }
        return false;
    }

    async startTransaction(){
        // Prevent nested transactions (SQLite limitation)
        return Promise.resolve(
            this.db.inTransaction ? null : this.db.prepare('BEGIN').run()
        );
    }

    async endTransaction(){
        // Only commit if transaction is active
        return Promise.resolve(
            this.db.inTransaction ? this.db.prepare('COMMIT').run() : null
        );
    }

    async errorTransaction(){
        // Only rollback if transaction is active
        return Promise.resolve(
            this.db.inTransaction ? this.db.prepare('ROLLBACK').run() : null
        );
    }

    // True while a transaction is open. Used by saveChanges' batch fallbacks
    // to decide whether to protect a bulk attempt with a SAVEPOINT.
    inTransaction(){
        return !!(this.db && this.db.inTransaction);
    }

    // Nested-rollback primitives so a failed bulk write can be undone without
    // aborting the whole enclosing transaction. `name` is an internally
    // generated identifier (`mr_sp_<n>`), never user input.
    async savepoint(name){
        return Promise.resolve(this.db.prepare(`SAVEPOINT ${name}`).run());
    }

    async releaseSavepoint(name){
        return Promise.resolve(this.db.prepare(`RELEASE SAVEPOINT ${name}`).run());
    }

    async rollbackToSavepoint(name){
        // ROLLBACK TO leaves the savepoint defined; RELEASE removes it so the
        // savepoint stack doesn't grow across repeated fallbacks.
        this.db.prepare(`ROLLBACK TO SAVEPOINT ${name}`).run();
        return Promise.resolve(this.db.prepare(`RELEASE SAVEPOINT ${name}`).run());
    }

    _buildSQLEqualTo(model){
        const $that = this;
        let argument = null;
        const dirtyFields = model.__dirtyFields;

        for (const column in dirtyFields) {

			// Validate non-nullable constraints on updates
			const fieldName = dirtyFields[column];
			const entityDef = model.__entity[fieldName];
			if(entityDef && entityDef.nullable === false && entityDef.primary !== true){
				// Determine the value that will actually be persisted for this field
				var persistedValue;
				switch(entityDef.type){
					case "integer":
						persistedValue = model["_" + fieldName];
					break;
					case "belongsTo":
						persistedValue = model["_" + fieldName] !== undefined ? model["_" + fieldName] : model[fieldName];
					break;
					default:
						persistedValue = model[fieldName];
				}
				const isEmptyString = (typeof persistedValue === 'string') && (persistedValue.trim() === '');
				if(persistedValue === undefined || persistedValue === null || isEmptyString){
					throw `Entity ${model.__entity.__name} column ${fieldName} is a required Field`;
				}
			}

            let type = model.__entity[dirtyFields[column]].type;

            if(model.__entity[dirtyFields[column]].relationshipType === "belongsTo"){
                type = "belongsTo";
            }
            // TODO Boolean value is a string with a letter
            switch(type){
                case "belongsTo" : {
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    let fkValue = model[dirtyFields[column]];
                    // 🔥 NEW: Validate foreign key type
                    try {
                        fkValue = $that._validateAndCoerceFieldType(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    // Append (don't overwrite) — a belongsTo field after other
                    // dirty fields must not wipe the accumulated SET clause.
                    argument = argument === null ? `${foreignKey} = ${fkValue},` : `${argument} ${foreignKey} = ${fkValue},`;
                break;
                }
                 case "integer" :
                     //model.__entity[dirtyFields[column]].skipGetFunction = true;
                    var columneValue = model[`_${dirtyFields[column]}`];
                    var intValue = columneValue !== undefined ? columneValue : model[dirtyFields[column]];
                    // 🔥 NEW: Validate integer type
                    try {
                        intValue = $that._validateAndCoerceFieldType(intValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    argument = argument === null ? `[${dirtyFields[column]}] = ${intValue},` : `${argument} [${dirtyFields[column]}] = ${intValue},`;
                    //model.__entity[dirtyFields[column]].skipGetFunction = false;
                break;
                case "string" :
                    var strValue = model[dirtyFields[column]];
                    // 🔥 NEW: Validate string type
                    try {
                        strValue = $that._validateAndCoerceFieldType(strValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    argument = argument === null ? `[${dirtyFields[column]}] = '${$that._santizeSingleQuotes(strValue, { entityName: model.__entity.__name, fieldName: dirtyFields[column] })}',` : `${argument} [${dirtyFields[column]}] = '${$that._santizeSingleQuotes(strValue, { entityName: model.__entity.__name, fieldName: dirtyFields[column] })}',`;
                break;
                case "boolean" :
                    var bool = "";
                    var boolValue = model[dirtyFields[column]];
                    // 🔥 NEW: Validate boolean type
                    try {
                        boolValue = $that._validateAndCoerceFieldType(boolValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    if(model.__entity[dirtyFields[column]].valueConversion){
                        bool = tools.convertBooleanToNumber(boolValue);
                    }
                    else{
                        bool = boolValue;
                    }
                    argument = argument === null ? `[${dirtyFields[column]}] = '${bool}',` : `${argument} [${dirtyFields[column]}] = '${bool}',`;
                break;
                case "time" :
                    var timeValue = model[dirtyFields[column]];
                    // 🔥 NEW: Validate time type
                    try {
                        timeValue = $that._validateAndCoerceFieldType(timeValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    argument = argument === null ? `[${dirtyFields[column]}] = '${timeValue}',` : `${argument} [${dirtyFields[column]}] = '${timeValue}',`;
                break;
                case "hasMany" :
                    argument = argument === null ? `[${dirtyFields[column]}] = '${model[dirtyFields[column]]}',` : `${argument} [${dirtyFields[column]}] = '${model[dirtyFields[column]]}',`;
                break;
                default:
                    argument = argument === null ? `[${dirtyFields[column]}] = '${model[dirtyFields[column]]}',` : `${argument} [${dirtyFields[column]}] = '${model[dirtyFields[column]]}',`;
            }
        }

        if(argument){
            return argument.replace(/,\s*$/, "");
        }
        else{
            return -1;
        }

    }

    /**
     * NEW SECURE VERSION: Build SQL SET clause with parameterized queries
     * Returns {sql: "column1 = ?, column2 = ?", params: [value1, value2]}
     * This prevents SQL injection by separating SQL structure from values
     */
    _buildSQLEqualToParameterized(model){
        const $that = this;
        const sqlParts = [];
        const params = [];
        const dirtyFields = model.__dirtyFields;

        for (const column in dirtyFields) {
            // Validate non-nullable constraints on updates
            const fieldName = dirtyFields[column];
            const entityDef = model.__entity[fieldName];
            if(entityDef && entityDef.nullable === false && entityDef.primary !== true){
                // Read the raw backing field to get the set()-transformed value,
                // bypassing get() which may change the type (e.g. parseFloat)
                let persistedValue = model["_" + fieldName];
                if(persistedValue === undefined){
                    persistedValue = model[fieldName];
                }
                const isEmptyString = (typeof persistedValue === 'string') && (persistedValue.trim() === '');
                if(persistedValue === undefined || persistedValue === null || isEmptyString){
                    throw `Entity ${model.__entity.__name} column ${fieldName} is a required Field`;
                }
            }

            let type = model.__entity[dirtyFields[column]].type;

            if(model.__entity[dirtyFields[column]].relationshipType === "belongsTo"){
                type = "belongsTo";
            }

            // Build parameterized SET clause
            switch(type){
                case "belongsTo": {
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    let fkValue = model[dirtyFields[column]];

                    // 🔥 Apply toDatabase transformer before validation
                    try {
                        fkValue = FieldTransformer.toDatabase(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }

                    try {
                        fkValue = $that._validateAndCoerceFieldType(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    var fore = `_${dirtyFields[column]}`;
                    sqlParts.push(`[${foreignKey}] = ?`);
                    params.push(model[fore]);
                break;
                }
                case "integer":
                    var intValue = model["_" + dirtyFields[column]];

                    // 🔥 Apply toDatabase transformer before validation
                    try {
                        intValue = FieldTransformer.toDatabase(intValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }

                    try {
                        intValue = $that._validateAndCoerceFieldType(intValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(intValue);
                break;
                case "string":
                    var strValue = model["_" + dirtyFields[column]];

                    // 🔥 Apply toDatabase transformer before validation
                    try {
                        strValue = FieldTransformer.toDatabase(strValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }

                    try {
                        strValue = $that._validateAndCoerceFieldType(strValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(strValue);
                break;
                case "boolean":
                    var boolValue = model["_" + dirtyFields[column]];

                    // 🔥 Apply toDatabase transformer before validation
                    try {
                        boolValue = FieldTransformer.toDatabase(boolValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }

                    try {
                        boolValue = $that._validateAndCoerceFieldType(boolValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }

                    // Convert to database-specific format (e.g., boolean → 1/0 for SQLite)
                    boolValue = $that._convertValueForDatabase(boolValue, model.__entity[dirtyFields[column]].type);

                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(boolValue);
                break;
                case "time":
                    var timeValue = model["_" + dirtyFields[column]];

                    // 🔥 Apply toDatabase transformer before validation
                    try {
                        timeValue = FieldTransformer.toDatabase(timeValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }

                    try {
                        timeValue = $that._validateAndCoerceFieldType(timeValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(timeValue);
                break;
                case "hasMany":
                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(model[dirtyFields[column]]);
                break;
                default: {
                    // Covers `text` and any other column type without a dedicated
                    // case above. Run the toDatabase transformer here too so that
                    // fields with a serializer (e.g. JSON text columns) get their
                    // object values turned into scalars before they reach better-sqlite3.
                    let rawValue = model["_" + dirtyFields[column]];
                    if (rawValue === undefined) {
                        rawValue = model[dirtyFields[column]];
                    }
                    try {
                        rawValue = FieldTransformer.toDatabase(rawValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch (transformError) {
                        throw new Error(`UPDATE failed: ${transformError.message}`);
                    }
                    sqlParts.push(`[${dirtyFields[column]}] = ?`);
                    params.push(rawValue);
                }
            }
        }

        if(sqlParts.length > 0){
            return {
                sql: sqlParts.join(', '),
                params: params
            };
        }
        else{
            return -1;
        }
    }


    _buildDeleteObject(currentModel){
        const primaryKey = currentModel.__Key === undefined ? tools.getPrimaryKeyObject(currentModel.__entity) : currentModel.__Key;
        const value = currentModel.__value === undefined ? currentModel[primaryKey] : currentModel.__value;
        const tableName = currentModel.__tableName === undefined ? currentModel.__entity.__name : currentModel.__tableName;
        return {tableName: tableName, primaryKey : primaryKey, value : value};
    }

    /**
     * Validate and coerce field value to match entity type definition
     * Throws detailed error if type cannot be coerced
     * @param {*} value - The field value to validate
     * @param {object} entityDef - The entity definition for this field
     * @param {string} entityName - Name of the entity (for error messages)
     * @param {string} fieldName - Name of the field (for error messages)
     * @returns {*} - The validated/coerced value
     */
    _validateAndCoerceFieldType(value, entityDef, entityName, fieldName){
        if(value === undefined || value === null){
            return value; // Let nullable validation handle this
        }

        const expectedType = entityDef.type;
        const actualType = typeof value;

        switch(expectedType){
            case "integer":
                // Coerce to integer if possible
                if(actualType === 'number'){
                    if(!Number.isInteger(value)){
                        console.warn(`⚠️  Field ${entityName}.${fieldName}: Expected integer but got float ${value}, rounding to ${Math.round(value)}`);
                        return Math.round(value);
                    }
                    return value;
                }
                if(actualType === 'string'){
                    const parsed = parseInt(value, 10);
                    if(isNaN(parsed)){
                        throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected integer, got string "${value}" which cannot be converted to a number`);
                    }
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting string "${value}" to integer ${parsed}`);
                    return parsed;
                }
                if(actualType === 'boolean'){
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting boolean ${value} to integer ${value ? 1 : 0}`);
                    return value ? 1 : 0;
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected integer, got ${actualType} with value ${JSON.stringify(value)}`);

            case "string":
                // Coerce to string
                if(actualType === 'string'){
                    return value;
                }
                // Allow auto-conversion from primitives
                if(['number', 'boolean'].includes(actualType)){
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
                // Time fields should be strings or timestamps
                if(actualType === 'string' || actualType === 'number'){
                    return value;
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected time (string/number), got ${actualType} with value ${JSON.stringify(value)}`);

            default:
                // For unknown types, allow the value through but warn
                if(actualType === 'object'){
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Setting object value for type "${expectedType}". This may cause issues.`);
                }
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

        // SQLite boolean conversion: JavaScript boolean → INTEGER (1/0)
        if(fieldType === 'boolean' && typeof value === 'boolean'){
            return value ? 1 : 0;
        }

        return value;
    }


       // return columns and value strings
    _buildSQLInsertObject(fields, modelEntity){
        const $that = this;
        let columns = null;
        let values = null;
        for (let column in modelEntity) {
            // column1 = value1, column2 = value2, ...
            if(column.indexOf("__") === -1 ){
                // call the get method if avlable
                let fieldColumn = "";
                // check if get function is avaliable if so use that
                fieldColumn = fields[column];

                if((fieldColumn !== undefined && fieldColumn !== null ) && typeof(fieldColumn) !== "object"){
                    // 🔥 NEW: Validate and coerce field type before processing
                    try {
                        fieldColumn = $that._validateAndCoerceFieldType(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch(typeError) {
                        throw new Error(`INSERT failed: ${typeError.message}`);
                    }

                    switch(modelEntity[column].type){
                        case "string" :
                            fieldColumn = `'${$that._santizeSingleQuotes(fieldColumn, { entityName: modelEntity.__name, fieldName: column })}'`;
                        break;
                        case "time" :
                            // time values are inserted as-is (no quoting transform)
                        break;
                    }

                    const relationship = modelEntity[column].relationshipType
                    if(relationship === "belongsTo"){
                        column = modelEntity[column].foreignKey
                    }

                    // Use bracket-quoted identifiers for SQLite column names
                    columns = columns === null ? `[${column}],` : `${columns} [${column}],`;
                    values = values === null ? `${fieldColumn},` : `${values} ${fieldColumn},`;

                }
                else{
                    switch(modelEntity[column].type){
                        case "belongsTo" :
                            var fieldObject = tools.findTrackedObject(fields.__context.__trackedEntities, column );
                            if( Object.keys(fieldObject).length > 0){
                                const primaryKey = tools.getPrimaryKeyObject(fieldObject.__entity);
                                fieldColumn = fieldObject[primaryKey];
                                column = modelEntity[column].foreignKey;
                                // Use bracket-quoted identifiers for SQLite column names
                                columns = columns === null ? `[${column}],` : `${columns} [${column}],`;
                                values = values === null ? `${fieldColumn},` : `${values} ${fieldColumn},`;
                            }else{
                                console.log("Cannot find belings to relationship")
                            }
    
                        break;
                    }
                
                }
            }
        }
        return {tableName: modelEntity.__name, columns: columns.replace(/,\s*$/, ""), values: values.replace(/,\s*$/, "")};

    }

    /**
     * NEW SECURE VERSION: Build SQL INSERT with parameterized queries
     * Returns {tableName, columns, placeholders, params}
     * This prevents SQL injection by separating SQL structure from values
     */
    _buildSQLInsertObjectParameterized(fields, modelEntity){
        const $that = this;
        const columnNames = [];
        const params = [];

        for (const column in modelEntity) {
            // Skip internal properties
            if(column.indexOf("__") === -1 ){
                let fieldColumn = fields[column];

                // 🔥 FIX: For belongsTo relationships, also check the foreignKey field name
                // Users can set either orgRole.User = obj OR orgRole.user_id = 2
                if((fieldColumn === undefined || fieldColumn === null) &&
                   modelEntity[column].relationshipType === "belongsTo" &&
                   modelEntity[column].foreignKey) {
                    fieldColumn = fields[modelEntity[column].foreignKey];
                }

                // Auto-increment primary keys are assigned by the database, so
                // they must never be emitted in the INSERT unless the caller
                // set an explicit value. An unset auto PK surfaces either as
                // undefined/null (an unread `.new()` getter) or as the schema-
                // definition function `id(db){…}` (when the row is a class
                // instance). A function is also never a valid value for any
                // column. Skip in those cases so the batched-insert path
                // behaves like the single-insert path instead of failing type
                // validation with "Expected integer, got function".
                const _columnDef = modelEntity[column];
                const _isAutoPrimaryKey = _columnDef && _columnDef.primary === true && _columnDef.auto === true;
                if (typeof fieldColumn === 'function' ||
                    (_isAutoPrimaryKey && (fieldColumn === undefined || fieldColumn === null))) {
                    continue;
                }

                if (fieldColumn !== undefined && fieldColumn !== null) {
                    // 🔥 Apply toDatabase transformer FIRST — transformers may turn
                    // objects into scalars (e.g. JSON.stringify), so running them
                    // before the type check is essential for fields that use a
                    // custom serializer on top of a text/json column.
                    try {
                        fieldColumn = FieldTransformer.toDatabase(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch(transformError) {
                        throw new Error(`INSERT failed: ${transformError.message}`);
                    }
                }

                if((fieldColumn !== undefined && fieldColumn !== null) && typeof(fieldColumn) !== "object"){
                    // Validate and coerce field type before processing
                    try {
                        fieldColumn = $that._validateAndCoerceFieldType(fieldColumn, modelEntity[column], modelEntity.__name, column);
                    } catch(typeError) {
                        throw new Error(`INSERT failed: ${typeError.message}`);
                    }

                    // Convert to database-specific format (e.g., boolean → 1/0 for SQLite)
                    fieldColumn = $that._convertValueForDatabase(fieldColumn, modelEntity[column].type);

                    const relationship = modelEntity[column].relationshipType;
                    var actualColumn = relationship === "belongsTo" ? modelEntity[column].foreignKey : column;

                    // Add column name and parameter
                    columnNames.push(`[${actualColumn}]`);
                    params.push(fieldColumn);
                }
                else{
                    switch(modelEntity[column].type){
                        case "belongsTo":
                            var fieldObject = tools.findTrackedObject(fields.__context.__trackedEntities, column);
                            if(Object.keys(fieldObject).length > 0){
                                const primaryKey = tools.getPrimaryKeyObject(fieldObject.__entity);
                                fieldColumn = fieldObject[primaryKey];
                                var actualColumn = modelEntity[column].foreignKey;
                                columnNames.push(`[${actualColumn}]`);
                                params.push(fieldColumn);
                            } else{
                                console.log("Cannot find belongs to relationship")
                            }
                        break;
                    }
                }
            }
        }

        if(columnNames.length > 0){
            // Create placeholders: ?, ?, ?, ...
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

    // will add double single quotes to allow string to be saved.
    _santizeSingleQuotes(value, context){
        if (typeof value === 'string' || value instanceof String){
            return value.replace(/'/g, "''");
        }
        else{
            const details = context || {};
            const entityName = details.entityName || 'UnknownEntity';
            const fieldName = details.fieldName || 'UnknownField';
            const valueType = (value === null) ? 'null' : (value === undefined ? 'undefined' : typeof value);
            let preview;
            try{ preview = (value === null || value === undefined) ? String(value) : JSON.stringify(value); }
            catch(_){ preview = '[unserializable]'; }
            if(preview && preview.length > 120){ preview = preview.substring(0, 120) + '…'; }
            const message = `Field is not a string: entity=${entityName}, field=${fieldName}, type=${valueType}, value=${preview}`;
            console.error(message);
            throw new Error(message);
        }
    }

    // converts any object into SQL parameter select string
    _convertEntityToSelectParameterString(obj, entityName){
        // todo: loop throgh object and append string with comma to 
        let mainString = "";
        const entries = Object.keys(obj);

        for (const [name] of entries) {
         mainString += `${mainString}, ${entityName}.${name}`;
        }
        return mainString;;
    }

    _execute(query, params){
        if (params && params.length > 0) {
            return this._executeWithParams(query, params);
        }
        // Migration/DDL path — always log so migrations are observable in
        // production (the gated [SQL] debug log only fires in dev).
        if (process.env.MR_SILENT_MIGRATIONS !== 'true') {
            console.log("[masterrecord:migration]", typeof query === 'string' ? query.replace(/\s+/g, ' ').trim() : query);
        }
        return this.db.exec(query);
    }

    _executeWithParams(query, params = []){
        if (process.env.MR_SILENT_MIGRATIONS !== 'true') {
            console.log("[masterrecord:migration]", typeof query === 'string' ? query.replace(/\s+/g, ' ').trim() : query);
            if (params && params.length) console.log("[masterrecord:migration] params", params);
        }
        return this.db.prepare(query).run(...params);
    }

    _run(query){
        if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
            console.debug("[SQL]", query);
        }
        return this.db.prepare(query).run();
    }

    _runWithParams(query, params = []){
        if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
            console.debug("[SQL]", query);
            console.debug("[Params]", params);
        }
        return this.db.prepare(query).run(...params);
    }

    // Engine-agnostic raw query backing the public ctx.query()/ctx.execute().
    // Returns an array of rows for row-returning statements (SELECT / PRAGMA /
    // RETURNING); for writes returns better-sqlite3's run info
    // ({ changes, lastInsertRowid }). `stmt.reader` tells the two apart.
    query(query, params = []){
        if (process.env.LOG_SQL === 'true' || process.env.NODE_ENV !== 'production') {
            console.debug("[SQL]", query);
            if (params && params.length) console.debug("[Params]", params);
        }
        const stmt = this.db.prepare(query);
        const args = Array.isArray(params) ? params : (params === undefined ? [] : [params]);
        return stmt.reader ? stmt.all(...args) : stmt.run(...args);
    }

    setDB(db, type){
       this.db = db;
       this.dbType = type; // this will let us know which type of sqlengine to use.
   }

    /**
     * Close database connection
     * Required for proper cleanup of better-sqlite3 native bindings
     */
    async close() {
        return Promise.resolve(
            this.db ? (this.db.close(), console.log('SQLite database closed')) : null
        );
    }
}

export default SQLLiteEngine;