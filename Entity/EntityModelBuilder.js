var modelDB  = require('./EntityModel');

// creates new instance if entity model and calls inner functions to build out a valid entity
class EntityModelBuilder {

    static create(model){
        if(model.name === undefined){
            throw "dbset model declaired incorrectly. Check you dbset models for code errors."
        }
        var mod = new model(); //create new instance of Entity Model
        var obj = {};
        var methodNamesArray = Object.getOwnPropertyNames( mod.__proto__ );
        var constructorIndex = methodNamesArray.indexOf("constructor");
        // remove contructor method
        if (constructorIndex > -1) {
            methodNamesArray.splice(constructorIndex, 1);
        }
        // loop through all method names in the entity model
        for (var i = 0; i < methodNamesArray.length; i++) {
            let MDB = new modelDB(model.name); // create a new instance of entity Model class
            mod[methodNamesArray[i]](MDB);
            this.cleanNull(MDB.obj); // remove objects that are null or undefined
            if(Object.keys(MDB.obj).length === 0){
                MDB.obj.virtual = true;
            }
            MDB.obj.name = methodNamesArray[i];
            obj[methodNamesArray[i]] = MDB.obj;
        }
        return obj;
    }

    static cleanNull(obj) {
        for (var propName in obj) { 
          if (obj[propName] === null) {
            delete obj[propName];
          }
        }
    }

}

module.exports = EntityModelBuilder;