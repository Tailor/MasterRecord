class EntityTrackerModel {
    constructor () {
        this.__ID = Math.floor((Math.random() * 100000) + 1);;
        this.__dirtyFields = [];
        this.__state = "track";
        this.__entity = null;
        this.__name = null;
    }

    // entity states https://docs.microsoft.com/en-us/dotnet/api/system.data.entitystate?view=netframework-4.7.2

    // start tracking model
    build(modelValue, currentEntity){
        this.__proto__ = {};
        const modelFields = Object.entries(modelValue); /// return array of objects
        var modelClass = this; // build entity with models
        modelClass.__entity = currentEntity;
        modelClass.__name = currentEntity.__name;

        for (const [modelField, modelFieldValue] of modelFields) { // loop through database values
            // set the value dynamiclly
            if(currentEntity[modelField]){ // current entity has a value then add
                modelClass["_" + modelField] = modelFieldValue;

                // Setter
                this.__proto__.__defineSetter__(modelField, function(value){
                    modelClass.__state = "modified";
                    modelClass.__dirtyFields.push(modelField);
                    // Then it will add name to dirty fields
                    this["_" + modelField] = value;
                });

                // Getter
                this.__proto__.__defineGetter__(modelField, function(){
                    return this["_" + modelField];
                });
            }   
        }
        return modelClass;
    }
}

module.exports = EntityTrackerModel