// Version 0.0.23
var tools =  require('masterrecord/Tools');

class SQLLiteEngine {

    unsupportedWords = ["order"]

    update(query){
        var sqlQuery = ` UPDATE [${query.tableName}]
        SET ${query.arg}
        WHERE [${query.tableName}].[${query.primaryKey}] = ${query.primaryKeyValue}` // primary key for that table = 
        return this._run(sqlQuery);
    }

    delete(queryObject){
       var sqlObject = this._buildDeleteObject(queryObject);
       var sqlQuery = `DELETE FROM [${sqlObject.tableName}] WHERE [${sqlObject.tableName}].[${sqlObject.primaryKey}] = ${sqlObject.value}`;
       return this._execute(sqlQuery);
    }

    insert(queryObject){
        var sqlObject = this._buildSQLInsertObject(queryObject, queryObject.__entity);
        var query = `INSERT INTO [${sqlObject.tableName}] (${sqlObject.columns})
        VALUES (${sqlObject.values})`;
        var queryObj = this._run(query);
        var open = {
            "id": queryObj.lastInsertRowid
        };
        return open;
    }

    get(query, entity, context){
        var queryString = {};
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
                console.log("SQL:", queryString.query);
                var queryReturn = this.db.prepare(queryString.query).get();
                return queryReturn;
            }
            return null;
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    // Introspection helpers
    tableExists(tableName){
        try{
            const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`;
            const row = this.db.prepare(sql).get();
            return !!row;
        }catch(_){ return false; }
    }

    getTableInfo(tableName){
        try{
            const sql = `PRAGMA table_info(${tableName})`;
            const rows = this.db.prepare(sql).all();
            return rows || [];
        }catch(_){ return []; }
    }

    getCount(queryObject, entity, context){
        var query = queryObject.script;
        var queryString = {};
        try {
            if(query.raw){
                queryString.query = query.raw;
            }
            else{
                if(query.count === undefined){
                    query.count = "none";
                }
                queryString.entity = this.getEntity(entity.__name, query.entityMap);
                queryString.query = `SELECT ${this.buildCount(query, entity)} ${this.buildFrom(query, entity)} ${this.buildWhere(query, entity)}`
            }
            if(queryString.query){
                var queryCount = queryString.query
                console.log("SQL:", queryCount );
                var queryReturn = this.db.prepare(queryCount ).get();
                return queryReturn;
            }
            return null;
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    all(query, entity, context){
        var selectQuery = {};
        try {
            if(query.raw){
                selectQuery.query = query.raw;
            }
            else{
              
                selectQuery = this.buildQuery(query, entity, context);
            }
            if(selectQuery.query){
                console.log("SQL:", selectQuery.query);
                var queryReturn = this.db.prepare(selectQuery.query).all();
                return queryReturn;
            }
            return null;
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    changeNullQuery(query){
        if(query.where){
            var whereClaus;
            whereClaus = query.where.expr.replace("=== null", "is null");
            if(whereClaus === query.where.expr){
                whereClaus = query.where.expr.replace("!= null", "is not null");
            }
            query.where.expr = whereClaus;
        }

    }

    buildCount(query, mainQuery){
            var entity = this.getEntity(query.parentName, query.entityMap);
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

    buildQuery(query, entity, context, limit){

        var queryObject = {};
        queryObject.entity = this.getEntity(entity.__name, query.entityMap);
        queryObject.select = this.buildSelect(query, entity);
        queryObject.count = this.buildCount(query, entity);
        queryObject.from = this.buildFrom(query, entity);
        queryObject.include = this.buildInclude(query, entity, context, queryObject);
        queryObject.where = this.buildWhere(query, entity);
        queryObject.and = this.buildAnd(query, entity);
        queryObject.take = this.buildTake(query);
        queryObject.skip = this.buildSkip(query);
        queryObject.orderBy = this.buildOrderBy(query);


        var queryString = `${queryObject.select} ${queryObject.count} ${queryObject.from} ${queryObject.include} ${queryObject.where} ${queryObject.and} ${queryObject.orderBy} ${queryObject.take} ${queryObject.skip}`;
        return { 
                query : queryString,
                entity : this.getEntity(entity.__name, query.entityMap)
        }

    }

    buildOrderBy(query){
        // ORDER BY column1, column2, ... ASC|DESC;
        var $that = this;
        var orderByType = "ASC";
        var orderByEntity = query.orderBy;
        var strQuery = "";
        if(orderByEntity === false){
            orderByType = "DESC";
            orderByEntity = query.orderByDesc;
        }
        if(orderByEntity){
            var entity = this.getEntity(query.parentName, query.entityMap);
            var fieldList = "";
            for (const item in orderByEntity.selectFields) {
                fieldList += `${entity}.${orderByEntity.selectFields[item]}, `;
            };
            fieldList = fieldList.replace(/,\s*$/, "");
            strQuery = "ORDER BY";
            strQuery += ` ${fieldList} ${orderByType}`;
        }
        return strQuery;
    }

    buildTake(query){
        if(query.take){
            return `LIMIT ${query.take}`
        }
        else{
            return "";
        }
    }

    buildSkip(query){
        if(query.skip){
            return `OFFSET ${query.skip}`
        }
        else{
            return "";
        }
    }

    buildAnd(query, mainQuery){
        // loop through the AND
        // loop update ther where .expr
        var andEntity = query.and;
        var strQuery = "";
        var $that = this;
        var str = "";

        if(andEntity){
            var entity = this.getEntity(query.parentName, query.entityMap);
            var andList = [];
            for (let entityPart in andEntity) { // loop through list of and's
                    var itemEntity = andEntity[entityPart]; // get the entityANd
                for (let table in itemEntity[query.parentName]) { // find the main table
                     var item = itemEntity[query.parentName][table];
                    for (let exp in item.expressions) {
                        var field = tools.capitalizeFirstLetter(item.expressions[exp].field);
                        if(mainQuery[field]){
                            if(mainQuery[field].isNavigational){
                                entity = $that.getEntity(field, query.entityMap);
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
                        if(strQuery === ""){
                            if(item.expressions[exp].arg === "null"){
                                strQuery = `${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`;
                            }else{
                                strQuery = `${entity}.${field}  ${item.expressions[exp].func} '${item.expressions[exp].arg}'`;
                            }
                        }
                        else{
                            if(item.expressions[exp].arg === "null"){
                                strQuery = `${strQuery} and ${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`;
                            }else{
                                strQuery = `${strQuery} and ${entity}.${field}  ${item.expressions[exp].func} '${item.expressions[exp].arg}'`;
                            }
                           
                        }
                    }
                    andList.push(strQuery);
                }
            }
        }
        
        if(andList.length > 0){
            str = `and ${andList.join(" and ")}`;
        }
        return str
    }

    buildWhere(query, mainQuery){
        var whereEntity = query.where;

        var $that = this;
        if(!whereEntity){
            return "";
        }

        var entityAlias = this.getEntity(query.parentName, query.entityMap);
        var item = whereEntity[query.parentName].query;
        var exprs = item.expressions || [];

        function exprToSql(expr){
            var field = expr.field.toLowerCase();
            var ent = entityAlias;
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
            let arg = expr.arg;
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
                return `${ent}.${field}  ${func} ${arg}`;
            }
            if(func === "IN"){
                return `${ent}.${field}  ${func} ${arg}`;
            }
            return `${ent}.${field}  ${func} '${arg}'`;
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
        var includeQuery =  "";
        for (let part in query.include) {
            var includeEntity = query.include[part];
            var $that = this;
            if(includeEntity){
                var parentObj = includeEntity[query.parentName];
                var currentContext = "";
                if(includeEntity.selectFields){
                    currentContext = context[tools.capitalizeFirstLetter(includeEntity.selectFields[0])];
                }
                
                if(parentObj){
                    parentObj.entityMap = query.entityMap;
                    var foreignKey = $that.getForeignKey(entity.__name, currentContext.__entity);
                    var mainPrimaryKey = $that.getPrimarykey(entity);
                    var mainEntity = $that.getEntity(entity.__name, query.entityMap);
                    if(currentContext.__entity[entity.__name].type === "hasManyThrough"){
                        var foreignTable = tools.capitalizeFirstLetter(currentContext.__entity[entity.__name].foreignTable); //to uppercase letter
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

                    var innerQuery = $that.buildQuery(parentObj, currentContext.__entity, context);

                    includeQuery += `LEFT JOIN (${innerQuery.query}) AS ${innerQuery.entity} ON ${ mainEntity}.${mainPrimaryKey} = ${innerQuery.entity}.${foreignKey} `;

                }
            }
        }
        return includeQuery;
    }

    buildFrom(query, entity){
        var entityName = this.getEntity(entity.__name, query.entityMap);
        if(entityName ){
            return `FROM ${entity.__name } AS ${entityName}`;
        }
        else{ return "" }
    }

    buildSelect(query, entity){
        // this means that there is a select statement
        var select = "SELECT";
        var arr = "";
        var $that = this;
        if(query.select){
            for (const item in query.select.selectFields) {
                arr += `${$that.getEntity(entity.__name, query.entityMap)}.${query.select.selectFields[item]}, `;
            };
          
        }
        else{
            var entityList = this.getEntityList(entity);
            for (const item in entityList) {
                arr += `${$that.getEntity(entity.__name, query.entityMap)}.${entityList[item]}, `;
            };
        }
        arr = arr.replace(/,\s*$/, "");
        return `${select} ${arr} `;
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
        var include = query.include;
        if(include){
            for (let part in include) {
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
        for (let item in maps) {
            var map = maps[item];
            if(tools.capitalizeFirstLetter(name) === tools.capitalizeFirstLetter(map.name)){
                return map.entity
            }
        }
        return "";
    }

 // return a list of entity names and skip foreign keys and underscore.
 getEntityList(entity){
    var entitiesList = [];
    var $that = this;
    for (var ent in entity) {
            if(!ent.startsWith("_")){
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
                        var name = entity[ent].foreignKey;
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
        for (var item in this.unsupportedWords) {
            var text = this.unsupportedWords[item];
            if(text === word){
                return true
            }
        }
        return false;
    }

    startTransaction(){
        this.db.prepare('BEGIN').run();
    }

    endTransaction(){
        this.db.prepare('COMMIT').run();
    }

    errorTransaction(){
        this.db.prepare('ROLLBACK').run();
    }

    _buildSQLEqualTo(model){
        var $that = this;
        var argument = null;
        var dirtyFields = model.__dirtyFields;

        for (var column in dirtyFields) {

			// Validate non-nullable constraints on updates
			var fieldName = dirtyFields[column];
			var entityDef = model.__entity[fieldName];
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
				var isEmptyString = (typeof persistedValue === 'string') && (persistedValue.trim() === '');
				if(persistedValue === undefined || persistedValue === null || isEmptyString){
					throw `Entity ${model.__entity.__name} column ${fieldName} is a required Field`;
				}
			}

            var type = model.__entity[dirtyFields[column]].type;

            if(model.__entity[dirtyFields[column]].relationshipType === "belongsTo"){
                type = "belongsTo";
            }
            // TODO Boolean value is a string with a letter
            switch(type){
                case "belongsTo" :
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    let fkValue = model[dirtyFields[column]];
                    // 🔥 NEW: Validate foreign key type
                    try {
                        fkValue = $that._validateAndCoerceFieldType(fkValue, model.__entity[dirtyFields[column]], model.__entity.__name, dirtyFields[column]);
                    } catch(typeError) {
                        throw new Error(`UPDATE failed: ${typeError.message}`);
                    }
                    argument = `${foreignKey} = ${fkValue},`;
                break;
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
                case "belongsTo" :
                    var fore = `_${dirtyFields[column]}`;
                    argument = argument === null ? `[${model.__entity[dirtyFields[column]].foreignKey}] = '${model[fore]}',` : `${argument} [${model.__entity[dirtyFields[column]].foreignKey}] = '${model[fore]}',`;
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

    
    _buildDeleteObject(currentModel){
        var primaryKey = currentModel.__Key === undefined ? tools.getPrimaryKeyObject(currentModel.__entity) : currentModel.__Key;
        var value = currentModel.__value === undefined ? currentModel[primaryKey] : currentModel.__value;
        var tableName = currentModel.__tableName === undefined ? currentModel.__entity.__name : currentModel.__tableName;
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
                // Coerce to boolean
                if(actualType === 'boolean'){
                    return value;
                }
                if(actualType === 'number'){
                    console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting number ${value} to boolean ${value !== 0}`);
                    return value !== 0;
                }
                if(actualType === 'string'){
                    const lower = value.toLowerCase().trim();
                    if(['true', '1', 'yes'].includes(lower)){
                        console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting string "${value}" to boolean true`);
                        return true;
                    }
                    if(['false', '0', 'no', ''].includes(lower)){
                        console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting string "${value}" to boolean false`);
                        return false;
                    }
                    throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected boolean, got string "${value}" which cannot be converted`);
                }
                throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected boolean, got ${actualType} with value ${JSON.stringify(value)}`);

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


       // return columns and value strings
    _buildSQLInsertObject(fields, modelEntity){
        var $that = this;
        var columns = null;
        var values = null;
        for (var column in modelEntity) {
            // column1 = value1, column2 = value2, ...
            if(column.indexOf("__") === -1 ){
                // call the get method if avlable
                var fieldColumn = "";
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
                            fieldColumn = fieldColumn;
                        break;
                    }

                    var relationship = modelEntity[column].relationshipType
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
                                var primaryKey = tools.getPrimaryKeyObject(fieldObject.__entity);
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

    // will add double single quotes to allow string to be saved.
    _santizeSingleQuotes(value, context){
        if (typeof value === 'string' || value instanceof String){
            return value.replace(/'/g, "''");
        }
        else{
            var details = context || {};
            var entityName = details.entityName || 'UnknownEntity';
            var fieldName = details.fieldName || 'UnknownField';
            var valueType = (value === null) ? 'null' : (value === undefined ? 'undefined' : typeof value);
            var preview;
            try{ preview = (value === null || value === undefined) ? String(value) : JSON.stringify(value); }
            catch(_){ preview = '[unserializable]'; }
            if(preview && preview.length > 120){ preview = preview.substring(0, 120) + '…'; }
            var message = `Field is not a string: entity=${entityName}, field=${fieldName}, type=${valueType}, value=${preview}`;
            console.error(message);
            throw new Error(message);
        }
    }

    // converts any object into SQL parameter select string
    _convertEntityToSelectParameterString(obj, entityName){
        // todo: loop throgh object and append string with comma to 
        var mainString = "";
        const entries = Object.keys(obj);

        for (const [name] of entries) {
         mainString += `${mainString}, ${entityName}.${name}`;
        }
        return mainString;;
    }

    _execute(query){
        console.log("SQL:", query);
        return this.db.exec(query);
    }

    _run(query){
        console.log("SQL:", query);
        return this.db.prepare(query).run();
    }

    setDB(db, type){
       this.db = db;
       this.dbType = type; // this will let us know which type of sqlengine to use.
   }
}

module.exports = SQLLiteEngine;