var tools =  require('./Tools');

class DeleteManager{
    constructor(sqlEngine, entities){
        this._SQLEngine = sqlEngine;
        this._allEntities = entities;
    }

    init(currentModel){
        var $that = this;
        try{
           this.cascadeDelete(currentModel);
        }
        catch(error){
            throw error;
        }
    }

    cascadeDelete(currentModel){
        var $that = this;
        if(!Array.isArray(currentModel)){
            const entityKeys = Object.keys(currentModel.__entity);
            // loop though all entity properties
            for (const property of entityKeys) {
                // cascade delete
                if(currentModel.__entity[property].type === "hasOne" || currentModel.__entity[property].type === "hasMany"){
                    $that.cascadeDelete( currentModel[property]);
                }
            }
            this._SQLEngine.delete(currentModel);
        }
        else{

            for(let i = 0 ; i < currentModel.length; i++) {
                const entityKeys = Object.keys(currentModel[i].__entity);
                // loop though all entity properties
                for (const property of entityKeys) {
                    // cascade delete
                    if(currentModel[i].__entity[property].type === "hasOne" || currentModel[i].__entity[property].type === "hasMany"){
                        $that.cascadeDelete( currentModel[i][property]);
                    }
                }
                this._SQLEngine.delete(currentModel[i]);
            }
        }
        

    }
}

module.exports = DeleteManager;