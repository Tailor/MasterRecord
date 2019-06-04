
var modelBuilder  = require('masterrecord/Entity/EntityModelBuilder');
var query = require('masterrecord/QueryLanguage/simpleQuery');
var tools =  require('./Tools');
var sqlEngine = require('./SQLEngine');

class Context {

    constructor(){
        this.__allContexts = [];
        this.__trackedEntities = [];
        this.__relationshipModels = [] // tracked entities must only come from entity tracker models
    }

    dbset(model){
        var validModel = modelBuilder.init(model);
        validModel.__name = model.name;
        this.__allContexts.push(validModel);
        this.createNewInstance(validModel);
    }

    createNewInstance(validModel){
        this[validModel.__name] = new query(validModel, this);
    }

    saveChanges(){
        
        // TODO: convert dirty to update
        for (var model in this.__trackedEntities) {
            var currentModel = this.__trackedEntities[model];
            switch(currentModel.__state) {
                case "modified":
                    if(currentModel.__dirtyFields.length <= 0){
                        throw "Tracked entity modified with no values being changed";
                    }
                    // build columns equal to value string 
                    var argu = tools.buildSQLEqualTo(currentModel);
                    var primaryKey  = tools.getPrimaryKeyObject(currentModel.__entity);
                    var sqlUpdate = {tableName: currentModel.__entity.__name, arg: argu, primaryKey : primaryKey, value : currentModel[primaryKey] };
                    sqlEngine.update(sqlUpdate);
                  // code block
                  break;
                case "insert":
                    var insertObj =  tools.getInsertObj(currentModel);
                    var sqlUpdate = {tableName: currentModel.__entity.__name, columns: insertObj.columns, values: insertObj.values };
                    sqlEngine.insert(sqlUpdate);
                  break;
                case "delete":
                    var primaryKey  = tools.getPrimaryKeyObject(currentModel.__entity);
                    var sqlUpdate = {tableName: currentModel.__entity.__name, primaryKey : primaryKey, value : currentModel[primaryKey] };
                    sqlEngine.delete(sqlUpdate);
                  break;
              }

        }
        return true;
    }

    // https://www.learnentityframeworkcore.com/dbset/deleting-data

    __Track(model){
        this.__trackedEntities.push(model);
        return model;
    }

    __FindTracked(id){
        if(id){
            for (var model in this.__trackedEntities) {
                if(this.__trackedEntities[model].__ID === id){
                    return this.__trackedEntities[model];
                }
            }
        }
        return null;
    }
}

module.exports = Context;