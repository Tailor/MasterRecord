// Version 0.0.1
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
                queryString = this.buildQuery(query, entity, context);
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
                queryString = this.buildQuery(query, entity, context);
            }
            if(queryString.query){
                var queryCount = queryObject.count(queryString.query)
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


    buildQuery(query, entity, context){

        var queryObject = {};
        queryObject.entity = this.getEntity(entity.__name, query.entityMap);
        queryObject.select = this.buildSelect(query, entity);
        queryObject.from = this.buildFrom(query, entity);
        queryObject.include = this.buildInclude(query, entity, context, queryObject);
        queryObject.where = this.buildWhere(query, entity);

        var queryString = `${queryObject.select} ${queryObject.from} ${queryObject.include} ${queryObject.where}`;
        return { 
                query : queryString,
                entity : this.getEntity(entity.__name, query.entityMap)
        }

    }

    buildWhere(query, mainQuery){
        var whereEntity = query.where;
        var strQuery = "";
        var $that = this;
        if(whereEntity){
            var entity = this.getEntity(query.parentName, query.entityMap);
            for (let part in whereEntity[query.parentName]) {
                    var item = whereEntity[query.parentName][part];
                    for (let exp in item.expressions) {
                        var field = tools.capitalizeFirstLetter(item.expressions[exp].field);
                        if(mainQuery[field]){
                            if(mainQuery[field].isNavigational){
                                entity = $that.getEntity(field, query.entityMap);
                                field = item.fields[1];
                            }
                        }
                        if(strQuery === ""){
                            strQuery = `WHERE ${entity}.${field}  ${item.expressions[exp].func} '${item.expressions[exp].arg}'`;
                        }
                        else{
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
            if(tools.capitalizeFirstLetter(name) === map.name){
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
                    argument = argument === null ? `[${dirtyFields[column]}] = ${model[dirtyFields[column]]},` : `${argument} [${dirtyFields[column]}] = ${model[dirtyFields[column]]},`;
                break;
                case "string" :
                    argument = argument === null ? `[${dirtyFields[column]}] = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',` : `${argument} [${dirtyFields[column]}] = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',`;
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
                            column = modelEntity[column].relationshipTable === undefined ? column : modelEntity[column].relationshipTable;
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
            }
        }
        return {tableName: modelEntity.__name, columns: columns.replace(/,\s*$/, ""), values: values.replace(/,\s*$/, "")};

    }

    // will add double single quotes to allow sting to be saved.
    _santizeSingleQuotes(string){
        return string.replace(/'/g, "''");
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