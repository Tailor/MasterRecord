
// version 0.0.4
var tools =  require('./Tools');
var queryScript = require('masterrecord/QueryLanguage/queryScript');

class InsertManager {

    constructor(sqlEngine, errorModel, allEntities ){
        this._SQLEngine = sqlEngine;
        this._errorModel = errorModel;
        this._allEntities = allEntities;
        this.__queryObject = new queryScript();
    }

    init(currentModel){
        this.runQueries(currentModel);
    }

    runQueries(currentModel){
        var $that = this;
        var cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel.__entity);
        this.validateEntity(cleanCurrentModel, currentModel, currentModel.__entity);
        if(this._errorModel.isValid){
            
                var modelEntity = currentModel.__entity;
                // TODO: if you try to add belongs to you must have a tag added first. if you dont throw error
                currentModel = this.belongsToInsert(currentModel, modelEntity);
                var SQL = this._SQLEngine.insert(currentModel);
                var primaryKey = tools.getPrimaryKeyObject(currentModel.__entity);
                // return all fields that have auto and dont have a value to the current model on insert
                if(currentModel.__entity[primaryKey].auto === true){
                    var query = `select * from ${currentModel.__entity.__name} where ${primaryKey} = ${ SQL.id }`;
                    var jj = this.__queryObject.raw(query);
                    var getQueryModel = this._SQLEngine.get(jj, currentModel.__entity, currentModel.__context );
                    currentModel[primaryKey] = getQueryModel[0][primaryKey];
                }

                const modelKeys = Object.keys(currentModel);
                // loop through model properties
                for (const property of modelKeys) {
                    var propertyModel = currentModel[property];
                    var entityProperty = modelEntity[property] ? modelEntity[property] : {};
                    if(entityProperty.type === "hasOne"){
                        // make sure property model is an object not a primary data type like number or string
                        if(typeof(propertyModel) === "object"){
                            // check if model has its own entity
                            if(modelEntity){
                                propertyModel.__entity = tools.getEntity(property, $that._allEntities);
                                propertyModel[currentModel.__entity.__name] = SQL.id;
                                $that.runQueries(propertyModel);
                            }
                            else{
                                throw `Relationship "${entityProperty.name}" could not be found please check if object has correct spelling or if it has been added to the context class`
                            }
                        }
                    }
                    
                    if(entityProperty.type === "hasMany"){
                        if(Array.isArray(propertyModel)){
                            const propertyKeys = Object.keys(propertyModel);
                            for (const propertykey of propertyKeys) {
                                if(propertyModel[propertykey]){
                                    propertyModel[propertykey].__entity = tools.getEntity(property, $that._allEntities);
                                    propertyModel[propertykey][currentModel.__entity.__name] = SQL.id;
                                    $that.runQueries(propertyModel[propertykey]);
                                }
                            }
                        }
                        else{
                            throw `Relationship "${entityProperty.name}" must be an array`;
                        }
                    }

                }
        }
        else{
            var name = currentModel.__entity.__name;
            console.log(`entity ${name} not valid`);
        }
    }

    // will insert belongs to row first and return the id so that next call can be make correctly
    belongsToInsert(currentModel, modelEntity){
        var $that = this;
        for(var entity in modelEntity) {
            if(modelEntity[entity].relationshipType === "belongsTo"){
                var foreignKey = modelEntity[entity].foreignKey === undefined ? modelEntity[entity].name : modelEntity[entity].foreignKey;
                var newPropertyModel = currentModel[foreignKey];
                // check if model is a an object. If so insert the child first then the parent. 
                if(typeof newPropertyModel === 'object'){
                    newPropertyModel.__entity = tools.getEntity(entity, $that._allEntities);
                    var propertyCleanCurrentModel = tools.removePrimarykeyandVirtual(newPropertyModel, newPropertyModel.__entity);
                    this.validateEntity(propertyCleanCurrentModel, newPropertyModel, newPropertyModel.__entity);
                    var propertySQL = this._SQLEngine.insert(newPropertyModel);
                    currentModel[foreignKey] = propertySQL.id; 
                }
            }
        }
        // todo:
            // loop through all modelEntity and find all the belongs to
            // if belongs to is true then make sql call to insert
            // update the currentModel.
        return currentModel;
    }
    // validate entity for nullable fields
    validateEntity(currentModel, currentRealModel, entityModel){
        for(var entity in entityModel) {
            var currentEntity = entityModel[entity];
            if (entityModel.hasOwnProperty(entity)) {
                // check if there is a default value
                if(currentEntity.default){
                    if(!currentRealModel[entity]){
                        // if its empty add the default value
                        currentRealModel[entity] = currentEntity.default;
                    }
                }
            
                // SKIP belongs too
                if(currentEntity.type !== "belongsTo" && currentEntity.type !== "hasMany"){
                    if(currentEntity.relationshipType !== "belongsTo"){
                        // primary is always null in an insert so validation insert must be null
                        if(currentEntity.nullable === false && !currentEntity.primary){
                            // if it doesnt have a get method then call error
                            if(currentEntity.set === undefined){
                                if(currentModel[entity] === undefined || currentModel[entity] === null || currentModel[entity] === "" ){
                                    this._errorModel.isValid = false;
                                    var errorMessage = `Entity ${currentModel.__entity.__name} column ${entity} is a required Field`;
                                    this._errorModel.errors.push(errorMessage);
                                    throw errorMessage;
                                }
                            }
                            else{
                                currentRealModel[entity] = currentEntity.set(currentModel[entity]);
                            }
                        }
                    }
                   
                }
            }

        }
    }
    
}


module.exports = InsertManager;
