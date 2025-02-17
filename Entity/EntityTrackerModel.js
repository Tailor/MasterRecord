
// version : 0.0.5
var tools =  require('../Tools');
class EntityTrackerModel {


    // entity states https://docs.microsoft.com/en-us/dotnet/api/system.data.entitystate?view=netframework-4.7.2

    // start tracking model
    build(dataModel, currentEntity, context){
        var $that = this;
        var modelClass = this.buildObject(); // build entity with models
        modelClass.__proto__ = {};
        const modelFields = Object.entries(dataModel); /// return array of objects
        modelClass.__entity = currentEntity;
        modelClass.__name = currentEntity.__name;
        modelClass.__context = context;
        this.buildRelationshipModels(modelClass, currentEntity, dataModel);
        
        // loop through data model fields
        for (const [modelField, modelFieldValue] of modelFields) { 
            
            // set the value dynamiclly
            if(!$that._isRelationship(currentEntity[modelField])){
                // current entity has a value then add
                modelClass["__proto__"]["_" + modelField] = modelFieldValue;

                // Setter
                modelClass.__defineSetter__(modelField, function(value){
                    modelClass.__state = "modified";
                    modelClass.__dirtyFields.push(modelField);
                    if(typeof currentEntity[modelField].set === "function"){
                        this["__proto__"]["_" + modelField] = currentEntity[modelField].set(value);
                    }else{
                        // Then it will add name to dirty fields
                        this["__proto__"]["_" + modelField] = value;
                    }
                });

                // Getter
                modelClass.__defineGetter__(modelField, function(){
                    // TODO: fix only when updating
                    if(currentEntity[modelField]){
                        if(!currentEntity[modelField].skipGetFunction){
                            if(typeof currentEntity[modelField].get === "function"){
                                return currentEntity[modelField].get(this["__proto__"]["_" + modelField]);
                            }else{
                                return this["__proto__"]["_" + modelField];
                            }
                        }
                    }else{
                        return this["__proto__"]["_" + modelField];
                    }
                
                
                });
            }   
        }
        
      
        return modelClass;
    }

    buildObject(){
        return {
            __ID : Math.floor((Math.random() * 100000) + 1),
            __dirtyFields : [],
            __state : "track",
            __entity : null,
            __context : null,
            __name : null
        }
    }

    _isRelationship(entity){
        if(entity){
            if(entity.type === "hasOne" || entity.type === "hasMany" || entity.type === "belongsTo" || entity.type === "hasManyThrough"){ 
                return true;
            }
            else{
                return false;
            }
        }else{
            return false;
        }
    }

    buildRelationshipModels(modelClass, currentEntity, currentModel){
        var $that = this;
        // loop though current entity and add only relationship models to this list
        const entityFields = Object.entries(currentEntity); 
        for (const [entityField, entityFieldValue] of entityFields) { // loop through entity values
          
            if($that._isRelationship(currentEntity[entityField])){ 
 
                // Setter
                modelClass.__defineSetter__(entityField, function(value){
                   
                    if(typeof value === "string" || typeof value === "number" || typeof value === "boolean"  || typeof value === "bigint" ){
                        modelClass.__state = "modified";
                        modelClass.__dirtyFields.push(entityField);
                         modelClass.__context.__track(modelClass);
                    }
                    this["__proto__"]["_" + entityField] = value;
                });

                // Getter
                modelClass.__defineGetter__(entityField, function(){

                    var ent = tools.findEntity(entityField, this.__context);
                    if(!ent){
                        var parentEntity = tools.findEntity(this.__name, this.__context);
                        if(parentEntity){
                            ent = tools.findEntity(parentEntity.__entity[entityField].foreignTable, this.__context);
                            if(!ent){
                                return  `Error - Entity ${parentEntity.__entity[entityField].foreignTable} not found. Please check your context for proper name.`
                            }
                        }
                        else{
                            return  `Error - Entity ${parentEntity} not found. Please check your context for proper name.`
                        }
                    }

                    
                    if(currentEntity[entityField].type === "belongsTo"){
                        if(currentEntity[entityField].lazyLoading){
                             // TODO: UPDATE THIS CODE TO USE SOMETHING ELSE - THIS WILL NOT WORK WHEN USING DIFFERENT DATABASES BECAUSE THIS IS USING SQLITE CODE. 
                        
                            var priKey = tools.getPrimaryKeyObject(ent.__entity);

                            var idValue = currentEntity[entityField].foreignKey;
                            var currentValue = this.__proto__[`_${idValue}`];
                            var modelValue = ent.where(`r => r.${priKey} == ${ currentValue }`).single();
                            this[entityField] = modelValue;
                        }
                        else{
                            return this["__proto__"]["_" + entityField];
                        }
                    }
                    else{
                        // user.tags = gets all tags related to user
                        // tag.users = get all users related to tags
                        if(currentEntity[entityField].lazyLoading){
                            var priKey = tools.getPrimaryKeyObject(this.__entity);
                            var entityName = currentEntity[entityField].foreignTable === undefined ? entityField : currentEntity[entityField].foreignTable;
                            var tableName = "";
                            if(entityName){
                                switch(currentEntity[entityField].type){
                                    // TODO: move the SQL generation part to the SQL builder so that we can later on use many diffrent types of SQL databases. 
                                    case "hasManyThrough" :
                                        try{
                                            var joiningEntity = this.__context[tools.capitalize(entityName)];
                                            var entityFieldJoinName = currentEntity[entityField].foreignTable === undefined? entityField : currentEntity[entityField].foreignTable;
                                            var thirdEntity = this.__context[tools.capitalize(entityFieldJoinName)];
                                            var firstJoiningID = joiningEntity.__entity[this.__entity.__name].foreignTable;
                                            var secondJoiningID = joiningEntity.__entity[entityField].foreignTable;
                                            if(firstJoiningID && secondJoiningID )
                                            {
                                                var modelValue = ent.include(`p => p.${entityFieldJoinName}.select(j => j.${joiningEntity.__entity[this.__entity.__name].foreignKey})`).include(`p =>p.${this.__entity.__name}`).where(`r =>r.${this.__entity.__name}.${priKey} = ${this[priKey]}`).toList();
                                                // var modelQuery = `select ${selectParameter} from ${this.__entity.__name} INNER JOIN ${entityName} ON ${this.__entity.__name}.${priKey} = ${entityName}.${firstJoiningID} INNER JOIN ${entityField} ON ${entityField}.${joinTablePriKey} = ${entityName}.${secondJoiningID} WHERE ${this.__entity.__name}.${priKey} = ${ this[priKey]}`;
                                                // var modelValue = ent.raw(modelQuery).toList();
                                                this[entityField] = modelValue;
                                            }
                                            else{
                                                return "Joining table must declaire joining table names"
                                            }
                                        }
                                        catch(error){
                                            return error;
                                        }
                                    /*
                                    select * from User 
                                    INNER JOIN Tagging ON User.id = Tagging.user_id
                                    INNER JOIN Tag ON Tag.id = Tagging.tag_id
                                    WHERE Tagging.user_id = 13
                                    */
                                    break;
                                    case "hasOne" : 
                                        var entityName = tools.findForeignTable(this.__entity.__name, ent.__entity);
                                        if(entityName){
                                            tableName = entityName.foreignKey;
                                        }
                                        else{
                                            return `Error - Entity ${ent.__entity.__name} has no property named ${this.__entity.__name}`;
                                        }

                                        //var jj = ent.raw(`select * from ${entityName} where ${tableName} = ${ this[priKey] }`).single();
                                        var modelValue = ent.where(`r => r.${tableName} == ${this[priKey]}`).single();
                                        this[entityField] = modelValue;
                                    break;
                                    case "hasMany" : 
                                        var entityName = tools.findForeignTable(this.__entity.__name, ent.__entity);
                                        if(entityName){
                                            tableName = entityName.foreignKey;
                                        }
                                        else{
                                            return  `Error - Entity ${ent.__entity.__name} has no property named ${this.__entity.__name}`;
                                        }
                                        //var modelValue = ent.raw(`select * from ${entityName} where ${tableName} = ${ this[priKey] }`).toList();
                                        var modelValue = ent.where(`r => r.${tableName} == ${this[priKey]}`).toList();
                                        this[entityField] = modelValue;
                                    break;
                                }
                            }
                            else{
                                return  "Entity name must be defined"
                            }
                        }
                        else{
                            return this["__proto__"]["_" + entityField];
                        }
                    }
                    
                    
                    return this["__proto__"]["_" + entityField];
                //return console.log("make db call to get value", entityField);
                });

                if(currentEntity[entityField].type === "belongsTo"){
                    // check if entity has a value if so then return that value
                    if(currentModel[entityField]){
                        modelClass[entityField] = currentModel[entityField];
                    }
                }
               
            }
        
        }
    }

}

module.exports = EntityTrackerModel