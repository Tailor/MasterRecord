
// version  0.0.13
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
        // Reset validation state for this operation to avoid stale errors
        if(this._errorModel){
            this._errorModel.isValid = true;
            this._errorModel.errors = [];
        }
        var cleanCurrentModel = tools.clearAllProto(currentModel);
        this.validateEntity(cleanCurrentModel, currentModel, currentModel.__entity);
        if(this._errorModel.isValid){
            
                var modelEntity = currentModel.__entity;
                // TODO: if you try to add belongs to you must have a tag added first. if you dont throw error
                currentModel = this.belongsToInsert(currentModel, modelEntity);
                var SQL = this._SQLEngine.insert(cleanCurrentModel);
                var primaryKey = tools.getPrimaryKeyObject(currentModel.__entity);
                // return all fields that have auto and dont have a value to the current model on insert
                if(currentModel.__entity[primaryKey].auto === true){
                    var query = `select * from ${currentModel.__entity.__name} where ${primaryKey} = ${ SQL.id }`;
                    var jj = this.__queryObject.raw(query);
                    var getQueryModel = this._SQLEngine.get(jj, currentModel.__entity, currentModel.__context );
                    var idVal = SQL.id;
                    // SQLite returns an object, MySQL may return array. Guard for nulls.
                    if(getQueryModel){
                        if(Array.isArray(getQueryModel)){
                            if(getQueryModel[0]){ idVal = getQueryModel[0][primaryKey]; }
                        }else if(typeof getQueryModel === 'object'){
                            if(getQueryModel[primaryKey] !== undefined){ idVal = getQueryModel[primaryKey]; }
                        }
                    }
                    currentModel[primaryKey] = idVal;
                }

                const proto = Object.getPrototypeOf(currentModel);
                const props = Object.getOwnPropertyNames(proto);
                const cleanPropList = tools.returnEntityList(props, modelEntity);
                const modelKeys = Object.keys(currentModel);
                const mergedArray =  [...new Set(modelKeys.concat(cleanPropList))];
                // loop through model properties
                for (const property of mergedArray) {
                    var propertyModel = currentModel[property];
                    var entityProperty = modelEntity[property] ? modelEntity[property] : {};
                    if(entityProperty.type === "hasOne"){
                        // only insert child if user provided a concrete object with data
                        if(propertyModel && typeof(propertyModel) === "object" ){
                            // check if model has its own entity
                            if(modelEntity){
                                // check if property has a value because we dont want this to run on every insert if nothing was added
                                // ensure it has some own props; otherwise skip
                                const hasOwn = Object.keys(propertyModel).length > 0;
                                if(hasOwn){
                                    propertyModel.__entity = tools.getEntity(property, $that._allEntities);
                                    propertyModel[currentModel.__entity.__name] = SQL.id;
                                    $that.runQueries(propertyModel);
                                }
                            }
                            else{
                                throw `Relationship "${entityProperty.name}" could not be found please check if object has correct spelling or if it has been added to the context class`
                            }
                        }
                    }
                    
                    if(entityProperty.type === "hasMany"){
                        // skip when not provided; only enforce array type if user supplied a value
                        if(propertyModel === undefined || propertyModel === null){
                            continue;
                        }
                        if(tools.checkIfArrayLike(propertyModel)){
                            const propertyKeys = Object.keys(propertyModel);
                            for (const propertykey of propertyKeys) {
                                if(propertyModel[propertykey]){
                                    let targetName = entityProperty.foreignTable || property;
                                    let resolved = tools.getEntity(targetName, $that._allEntities) 
                                                    || tools.getEntity(tools.capitalize(targetName), $that._allEntities)
                                                    || tools.getEntity(property, $that._allEntities);
                                    if(!resolved){
                                        throw `Relationship entity for '${property}' could not be resolved. Expected '${targetName}'.`;
                                    }
                                    // Coerce primitive into object with primary key if user passed an id
                                    if(typeof propertyModel[propertykey] !== "object" || propertyModel[propertykey] === null){
                                        const childPrimaryKey = tools.getPrimaryKeyObject(resolved);
                                        const primitiveValue = propertyModel[propertykey];
                                        propertyModel[propertykey] = {};
                                        propertyModel[propertykey][childPrimaryKey] = primitiveValue;
                                    }
                                    propertyModel[propertykey].__entity = resolved;
                                    propertyModel[propertykey][currentModel.__entity.__name] = SQL.id;
                                    $that.runQueries(propertyModel[propertykey]);
                                }
                            }
                        }
                        else{
                            throw `Relationship "${entityProperty.name}" must be an array`;
                        }
                    }

                    if(entityProperty.type === "hasManyThrough"){
                        if(tools.checkIfArrayLike(propertyModel)){
                            const propertyKeys = Object.keys(propertyModel);
                            for (const propertykey of propertyKeys) {
                                if(propertyModel[propertykey]){
                                    let targetName = entityProperty.foreignTable || property;
                                    let resolved = tools.getEntity(targetName, $that._allEntities) 
                                                    || tools.getEntity(tools.capitalize(targetName), $that._allEntities)
                                                    || tools.getEntity(property, $that._allEntities);
                                    if(!resolved){
                                        throw `Relationship entity for '${property}' could not be resolved. Expected '${targetName}'.`;
                                    }
                                    if(typeof propertyModel[propertykey] !== "object" || propertyModel[propertykey] === null){
                                        const childPrimaryKey = tools.getPrimaryKeyObject(resolved);
                                        const primitiveValue = propertyModel[propertykey];
                                        propertyModel[propertykey] = {};
                                        propertyModel[propertykey][childPrimaryKey] = primitiveValue;
                                    }
                                    propertyModel[propertykey].__entity = resolved;
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
            var messages = this._errorModel.errors;
            const combinedError = messages.join('; and ');
            throw combinedError;

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
                    var propertyCleanCurrentModel = tools.clearAllProto(newPropertyModel);
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

    // validate entity for nullable fields and if the entity has any values at all
    validateEntity(currentModel, currentRealModel, entityModel){
        for(var entity in entityModel) {
            var currentEntity = entityModel[entity];
            if (entityModel.hasOwnProperty(entity)) {
                // check if there is a default value
                if(currentEntity.default){
                    if(currentRealModel[entity] === undefined || currentRealModel[entity] === null){
                        // if its empty add the default value
                        currentRealModel[entity] = currentEntity.default;
                    }
                }
            
                // SKIP belongs too -----   // call sets for correct data for DB
                if(currentEntity.type !== "belongsTo" && currentEntity.type !== "hasMany"){
                    if(currentEntity.relationshipType !== "belongsTo"){
                        // Auto-populate common timestamp fields if required and missing
                        if((entity === 'created_at' || entity === 'updated_at') && (currentRealModel[entity] === undefined || currentRealModel[entity] === null)){
                            var nowVal = Date.now().toString();
                            currentRealModel[entity] = nowVal;
                            currentModel[entity] = nowVal;
                        }
                        // primary is always null in an insert so validation insert must be null
                        if(currentEntity.nullable === false && !currentEntity.primary){
                            // if it doesnt have a get method then call error
                            if(currentEntity.set === undefined){
                                const realVal = currentRealModel[entity];
                                const cleanVal = currentModel[entity];
                                let hasValue = (realVal !== undefined && realVal !== null) || (cleanVal !== undefined && cleanVal !== null);
                                // For strings, empty string should be considered invalid for notNullable
                                const candidate = (realVal !== undefined && realVal !== null) ? realVal : cleanVal;
                                if(typeof candidate === 'string' && candidate.trim() === ''){
                                    hasValue = false;
                                }
                                // Fallback: check backing field on tracked model if both reads were undefined/null
                                if(!hasValue && currentRealModel && currentRealModel.__proto__){
                                    const backing = currentRealModel.__proto__["_" + entity];
                                    hasValue = (backing !== undefined && backing !== null);
                                    if(hasValue){
                                        // normalize into both models so downstream sees it
                                        currentRealModel[entity] = backing;
                                        currentModel[entity] = backing;
                                    }
                                }
                                if(!hasValue){
                                    this._errorModel.isValid = false;
                                    var errorMessage = `Entity ${currentModel.__entity.__name} column ${entity} is a required Field`;
                                    this._errorModel.errors.push(errorMessage);
                                    //throw errorMessage;
                                }
                            }
                            else{
                                var realData = currentEntity.set(currentModel[entity]);
                                currentRealModel[entity] = realData;
                                currentModel[entity] = realData;
                            }
                        }
                    }
                   
                }
            }

        }
    }
    
}


module.exports = InsertManager;
