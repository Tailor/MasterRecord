// version : 0.0.6

var tools =  require('masterrecord/Tools');
var util = require('util');

class SQLLiteEngine {

    unsupportedWords = ["order"]

    update(query){
        var sqlQuery = ` UPDATE ${query.tableName} SET ${query.arg} WHERE ${query.tableName}.${query.primaryKey} = ${query.primaryKeyValue}` // primary key for that table = 
        return this._run(sqlQuery);
    }

    delete(queryObject){
       var sqlObject = this._buildDeleteObject(queryObject);
       var sqlQuery = `DELETE FROM ${sqlObject.tableName} WHERE ${sqlObject.tableName}.${sqlObject.primaryKey} = ${sqlObject.value}`;
       return this._run(sqlQuery);
    }

    insert(queryObject){
        var sqlObject = this._buildSQLInsertObject(queryObject, queryObject.__entity);
        var query = `INSERT INTO ${sqlObject.tableName} (${sqlObject.columns}) VALUES (${sqlObject.values})`;
        var queryObj = this._run(query);
        // return 
        var open = {
            "id": queryObj.insertId
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
                this.db.connect(this.db);
                const result = this.db.query(queryString.query);
                console.log("results:", result);
                return result;
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
                this.db.connect(this.db);
                const result = this.db.query(queryString.query);
                console.log("results:", result);
                return result;
            }
            return null;
        } catch (err) {
            console.error(err);
            return null;
        }
    }


    buildQuery(query, entity, context){

        var queryObject = {};
        if(entity){
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
        else{
            console.log("Error: Entity object is blank");
        }
       

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
					if(item.fields && item.fields[1]){
						field = item.fields[1];
					}
				}
			}
			let func = expr.func;
			let arg = expr.arg;
			if(!func || func === 'exists' || typeof arg === 'undefined'){
				return null;
			}
			if(arg === "null"){
				if(func === "=") func = "is";
				if(func === "!=") func = "is not";
				return `${ent}.${field}  ${func} ${arg}`;
			}
			if(func === "IN"){
				return `${ent}.${field}  ${func} ${arg}`;
			}
			return `${ent}.${field}  ${func} '${$that._santizeSingleQuotes(arg)}'`;
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
				i--; // compensate for loop increment
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
            var type = model.__entity[dirtyFields[column]].type;
            
            if(model.__entity[dirtyFields[column]].relationshipType === "belongsTo"){
                type = "belongsTo";
            }

            switch(type){
                case "belongsTo" :
                    const foreignKey = model.__entity[dirtyFields[column]].foreignKey;
                    argument = `${foreignKey} = ${model[dirtyFields[column]]},`;
                break;
                case "integer" :
                    const columneValue = model[`_${dirtyFields[column]}`];
                    argument = argument === null ? `[${dirtyFields[column]}] = ${model[dirtyFields[column]]},` : `${argument} [${dirtyFields[column]}] = ${columneValue},`;
                break;
                case "string" :
                    argument = argument === null ? `${dirtyFields[column]} = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',` : `${argument} ${dirtyFields[column]} = '${$that._santizeSingleQuotes(model[dirtyFields[column]])}',`;
                break;
                case "boolean" :
                    argument = argument === null ? `${dirtyFields[column]} = '${this.boolType(model[dirtyFields[column]])}',` : `${argument} ${dirtyFields[column]} = '${this.boolType(model[dirtyFields[column]])}',`;
                break;
                default:
                    argument = argument === null ? `${dirtyFields[column]} = '${model[dirtyFields[column]]}',` : `${argument} ${dirtyFields[column]} = '${model[dirtyFields[column]]}',`;
            }
        }
       if(argument){
            return argument.replace(/,\s*$/, "");
        }
        else{
            return -1;
        }
    }

    boolType(type){
        var jj = String(type);
        switch(jj) {
            case "true":
                return 1
              break;
              case "false":
                return 0
              break;
              default:
                return type;
        }
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
                
                if((fieldColumn !== undefined && fieldColumn !== null ) && typeof(fieldColumn) !== "object"){
                    switch(modelEntity[column].type){
                        case "string" : 
                            fieldColumn = `'${$that._santizeSingleQuotes(fields[column])}'`;
                        break;
                        case "time" : 
                            fieldColumn = fields[column];
                        break;
                    }
                    
                    var relationship = modelEntity[column].relationshipType
                    if(relationship === "belongsTo"){
                        column = modelEntity[column].foreignKey
                    }


                    columns = columns === null ? `${column},` : `${columns} ${column},`;
                    values = values === null ? `${fieldColumn},` : `${values} ${fieldColumn},`;

                }
            }
        }

        return {tableName: modelEntity.__name, columns: columns.replace(/,\s*$/, ""), values: values.replace(/,\s*$/, "")};

    }

    // will add double single quotes to allow sting to be saved.
    _santizeSingleQuotes(string){

        if(typeof string === "string"){
            return string.replace(/'/g, "''");
        }else{
            return `${string}`;
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
        this.db.connect(this.db);
        return this.db.query(query);
    }

     _run(query){
        try{        
            
            console.log("SQL:", query);
            this.db.connect(this.db);
            const result = this.db.query(query);
    
            return result;}
        catch (error) {
            console.error(error);
            // Expected output: ReferenceError: nonExistentFunction is not defined
            // (Note: the exact output may be browser-dependent)
          }
    }

    setDB(db, type){
       this.db = db;
       this.dbType = type; // this will let us know which type of sqlengine to use.
   }
}

module.exports = SQLLiteEngine;




/***
 * 
 * 
 * 
 * const mysql = require('mysql2/promise');

class MySQLClient {
    constructor(config) {
        this.config = config;
        this.pool = mysql.createPool(config);
    }

    async query(sql, params = []) {
        const connection = await this.pool.getConnection();
        try {
            const [results] = await connection.execute(sql, params);
            return results;
        } finally {
            connection.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = MySQLClient;

 */