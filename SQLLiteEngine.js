// Version 0.0.13
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

        var strQuery = "";
        var $that = this;
        if(whereEntity){
            var entity = this.getEntity(query.parentName, query.entityMap);

            var item = whereEntity[query.parentName].query;
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
                        strQuery = `WHERE ${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`;
                    }else{
                        if(item.expressions[exp].func === "IN"){
                            strQuery = `WHERE ${entity}.${field}  ${item.expressions[exp].func} ${item.expressions[exp].arg}`;
                        }
                        else{
                            strQuery = `WHERE ${entity}.${field}  ${item.expressions[exp].func} '${item.expressions[exp].arg}'`;
                        }
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

            
                
        }
        return strQuery;
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

            // TODO Boolean value is a string with a letter
            switch(model.__entity[dirtyFields[column]].type){
                 case "integer" :
                    //model.__entity[dirtyFields[column]].skipGetFunction = true;
                    argument = argument === null ? `[${dirtyFields[column]}] = ${model[dirtyFields[column]]},` : `${argument} [${dirtyFields[column]}] = ${model[dirtyFields[column]]},`;
                    //model.__entity[dirtyFields[column]].skipGetFunction = false;
                break;
                case "string" :
                    argument = argument === null ? `[${dirtyFields[column]}] = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',` : `${argument} [${dirtyFields[column]}] = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',`;
                break;
                case "boolean" :
                    var bool = "";
                    if(model.__entity[dirtyFields[column]].valueConversion){
                        bool = tools.convertBooleanToNumber(model[dirtyFields[column]]);
                    }
                    else{
                        bool = model[dirtyFields[column]];
                    }
                    argument = argument === null ? `[${dirtyFields[column]}] = '${bool}',` : `${argument} [${dirtyFields[column]}] = ${bool},`;
                break;
                case "time" :
                    argument = argument === null ? `[${dirtyFields[column]}] = '${model[dirtyFields[column]]}',` : `${argument} [${dirtyFields[column]}] = ${model[dirtyFields[column]]},`;
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
        return argument.replace(/,\s*$/, "");
    }

    
    _buildDeleteObject(currentModel){
        var primaryKey = currentModel.__Key === undefined ? tools.getPrimaryKeyObject(currentModel.__entity) : currentModel.__Key;
        var value = currentModel.__value === undefined ? currentModel[primaryKey] : currentModel.__value;
        var tableName = currentModel.__tableName === undefined ? currentModel.__entity.__name : currentModel.__tableName;
        return {tableName: tableName, primaryKey : primaryKey, value : value};
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

                if((fieldColumn !== undefined && fieldColumn !== null && fieldColumn !== "" ) && typeof(fieldColumn) !== "object"){
                    switch(modelEntity[column].type){
                        case "belongsTo" :
                            column = modelEntity[column].foreignKey === undefined ? column : modelEntity[column].foreignKey;
                        break;
                        case "string" : 
                            fieldColumn = `'${$that._santizeSingleQuotes(fields[column])}'`;
                        break;
                        case "time" : 
                            fieldColumn = fields[column];
                        break;
                    }

                    columns = columns === null ? `'${column}',` : `${columns} '${column}',`;
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
                                columns = columns === null ? `'${column}',` : `${columns} '${column}',`;
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

    // will add double single quotes to allow sting to be saved.
    _santizeSingleQuotes(string){
        if (typeof string === 'string' || string instanceof String){
            return string.replace(/'/g, "''");
        }
    else{
        console.log("warning - Field being passed is not a string");
        throw "warning - Field being passed is not a string";
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