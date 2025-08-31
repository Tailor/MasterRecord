// Version 0.0.4
class Tools{

    static checkIfArrayLike(obj) {
        if (Array.isArray(obj)) {
          return true;
        }
      
        if (
          obj &&
          typeof obj === 'object' &&
          Object.keys(obj).some(k => !isNaN(k)) &&
          '0' in obj
        ) {
          return true;
        }
      
        return -1;
    }

    static returnEntityList(list, entityList ){
        var newList = [];
        for(var max = 0; max < list.length; max++ ){
            var ent = entityList[list[max]];
            if(ent){
                if(ent.relationshipType === "hasMany" || ent.relationshipType === "hasOne"){
                    newList.push(ent.name);
                } 
            }
        }
        return newList;
    }

    static findEntity(name, entityList){
        return entityList[name];
    }

    // this will remove everthing from back slash amount
    static removeBackwardSlashSection(string, amount, type){
        type = type === undefined ? "\\" : type;
        var stringArray =  string.split(type);
        for(var i = 0; i < amount; i++){
            stringArray.pop();
        }
        return stringArray.join(type);
    }

    static getPrimaryKeyObject(model){
        for (var key in model) {
            if (model.hasOwnProperty(key)) {
                if(model[key].primary){
                    if(model[key].primary === true){
                        return key
                    }
                }
            }
        }
    }

    static findForeignTable(name, model){
        for (var key in model) {
            if (model.hasOwnProperty(key)) {
                if(model[key].foreignTable){
                    if(model[key].foreignTable === name){
                        return model[key];
                    }
                }
            }
        }
        return null;
    }

    static createNewInstance(validModel, type, classModel){
        return new type(validModel, classModel);
    }

    static findTrackedObject(obj, name){
        for (const property in obj) {
            if(obj[property].__name === name){
                return obj[property];
            }
        }
        return {};
    }

    static clearAllProto(proto){
       
        var newproto = {}
        if(proto.__proto__ ){
            for (var key in proto) {
                if(!key.startsWith("_")){
                    var typeObj = typeof(proto[key]);
                    newproto[key] = proto[key];
                    if(typeObj === "object"){
                        proto[key] = this.clearAllProto(proto[key]);
                    }
                }
            }
        }

         newproto["__name"] = proto["__name"];
         newproto["__state"] = proto["__state"];
         newproto["__entity"] = proto["__entity"];
         newproto["__context"] = proto["__context"];
         newproto["__dirtyFields"] = proto["__dirtyFields"];
         
         newproto.__proto__ = null;
        return newproto;

    }

    static removePrimarykeyandVirtual(currentModel, modelEntity){
        var newCurrentModel = Object.create(currentModel);

        for(var entity in modelEntity) {
            var currentEntity = modelEntity[entity];
            if (modelEntity.hasOwnProperty(entity)) {
                if(currentEntity.primary === true){
                    delete newCurrentModel[`_${entity}`];
                }
            }
            if(currentEntity.virtual === true){
                // skip it from the insert
                delete newCurrentModel[`_${entity}`];
            }

        }
        return newCurrentModel;
    }

    static getEntity(name, modelEntity){
        for(var entity in modelEntity) {
            var currentEntity = modelEntity[entity];
            if (modelEntity.hasOwnProperty(entity)) {
                if(currentEntity.__name === name){
                    return currentEntity;
                }
            }
        }
        return false;
    }

    static capitalize = (s) => {
        if (typeof s !== 'string') return ''
        return s.charAt(0).toUpperCase() + s.slice(1)
    }

    static capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
      }

             // return randome letter that is not the skip letter
    static getRandomLetter(length, skip){
        var result           = '';
        var characters       = 'abcdefghijklmnopqrstuvwxyz';
        var charactersLength = characters.length;
        
        for ( var i = 0; i < length; i++ ) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            if(skip){
                for ( var b = 0; b < skip.length; b++ ) {
                    if(result === skip[i].entity){
                        result = "";
                        i--;
                    }
                }
            }
        }
         
       return result;
    }

    // TODO: this should be removed once we create a SQLIte Manager;
    // converts any object into SQL parameter select string

    static convertEntityToSelectParameterString(obj){
        // todo: loop throgh object and append string with comma to 
        var mainString = "";
        const entries = Object.keys(obj);
        for (const key of entries) {
            if(obj[key].type !== 'hasManyThrough' && obj[key].type !== "hasMany" && obj[key].type !== "hasOne"){
                if(obj[key].name){
                    mainString = mainString === "" ?  `${obj.__name}.${obj[key].name}` : `${mainString}, ${obj.__name}.${obj[key].name}`;
                }
            }
          }
        return mainString;;
    }

    static convertBooleanToNumber(num) {
        num = num === 'true' ? true : (num === 'false' ? false : num);
        return num ? 1 : 0;
   }
}

module.exports = Tools;