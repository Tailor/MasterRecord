var modelDB  = require('./EntityModel');

// creates new instance if entity model and calls inner functions to build out a valid entity
class EntityModelBuilder {

    static init(model){
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
            let MDB = new modelDB(); // create a new instance of entity Model class
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
          if (obj[propName] === null || obj[propName] === undefined) {
            delete obj[propName];
          }
        }
    }

    static selectColumnQuery(objectLiteral){
        var arr = "";
        for(var keys = Object.keys(model), i = 0, end = keys.length; i < end; i++) {
            var key = keys[i], value = model[key];
            if(value.virtual === undefined){
                arr += key + ",";
            }
        };
        let cleaned = arr.substring(0,  arr.length - 1);
        return cleaned;
    }

    // who calls this? What does this do?
    static callAllGets(data, model){
        console.log("callAllGets");
        for(var keys = Object.keys(model), i = 0, end = keys.length; i < end; i++) {
            var key = keys[i], value = model[key];
            if(value.get !== undefined){
                data[key] = value.get(data);
            }
        };
    
        return data;
    }

}

module.exports = EntityModelBuilder;