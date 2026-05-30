// Version 0.0.5
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
        const newList = [];
        for(let max = 0; max < list.length; max++ ){
            const ent = entityList[list[max]];
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
        const stringArray =  string.split(type);
        for(let i = 0; i < amount; i++){
            stringArray.pop();
        }
        return stringArray.join(type);
    }

    static getPrimaryKeyObject(model){
        for (const key in model) {
            if (Object.prototype.hasOwnProperty.call(model, key)) {
                if(model[key].primary){
                    if(model[key].primary === true){
                        return key
                    }
                }
            }
        }
    }

    static findForeignTable(name, model){
        for (const key in model) {
            if (Object.prototype.hasOwnProperty.call(model, key)) {
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

        const newproto = {}
        if(proto.__proto__ ){
            // Include non-enumerable own properties so we don't lose values defined via getters
            const keys = Object.getOwnPropertyNames(proto);
            for (const key of keys) {
                if(!key.startsWith("_") && !key.startsWith("__")){
                    try{
                        const value = proto[key];
                        // Skip lifecycle hooks by checking entity definition
                        if(proto.__entity && proto.__entity[key] && proto.__entity[key].lifecycle === true){
                            continue;
                        }
                        // Skip functions EXCEPT if they're defined via getters (typeof returns value, not function)
                        // Only skip if it's actually a function value (methods like save, delete, toObject)
                        if(typeof value === "function"){
                            continue;
                        }
                        // Copy the value by reference. Do NOT recurse into nested
                        // objects/arrays — clearAllProto's job is to strip tracker
                        // metadata from a tracked entity, not to deep-clone user
                        // data. Recursing here used to turn Arrays into array-like
                        // plain objects (losing the Array shape), and to walk into
                        // nested plain objects (e.g. JSON values with a custom
                        // transformer) and discard keys starting with "_".
                        newproto[key] = value;
                    }catch(_){ /* ignore getter errors */ }
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
        const newCurrentModel = Object.create(currentModel);

        for(const entity in modelEntity) {
            const currentEntity = modelEntity[entity];
            if (Object.prototype.hasOwnProperty.call(modelEntity, entity)) {
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
        for(const entity in modelEntity) {
            const currentEntity = modelEntity[entity];
            if (Object.prototype.hasOwnProperty.call(modelEntity, entity)) {
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
        let result           = '';
        const characters       = 'abcdefghijklmnopqrstuvwxyz';
        const charactersLength = characters.length;
        
        for ( let i = 0; i < length; i++ ) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            if(skip){
                for ( let b = 0; b < skip.length; b++ ) {
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
        let mainString = "";
        const entries = Object.keys(obj);
        for (const key of entries) {
            // Skip lifecycle hooks - they are not database columns
            if(obj[key].lifecycle === true){
                continue;
            }
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

export default Tools;