class EntityTrackerModel {
    constructor (entity) {
        this.__ID = Math.floor((Math.random() * 100000) + 1);;
        this.__dirtyFields = [];
        this.__state = "track";
        this.__entity = entity;
        this.__name = entity.__name;
    }

    // entity states https://docs.microsoft.com/en-us/dotnet/api/system.data.entitystate?view=netframework-4.7.2

    // start tracking model
    static build(modelValue, currentEntity){
        const modelFields = Object.entries(modelValue); /// return array of objects
        var modelClass = new EntityTrackerModel(currentEntity);
    
        for (const [modelField, modelFieldValue] of modelFields) {
            // set the value dynamiclly
            modelClass["_" + modelField] = modelFieldValue;

            // Setter
            EntityTrackerModel.prototype.__defineSetter__(modelField, function(value){
                modelClass.__state = "modified";
                modelClass.__dirtyFields.push(modelField);
                // Then it will add name to dirty fields
                this["_" + modelField] = value;
            });

            // Getter
            EntityTrackerModel.prototype.__defineGetter__(modelField, function(){
                return this["_" + modelField];
            });
        }
        return modelClass;
    }
}

module.exports = EntityTrackerModel