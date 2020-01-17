// ALL THIS SHOULD DO IS BUILD A SQL QUERY
var entityTrackerModel  = require('masterrecord/Entity/EntityTrackerModel');

class queryBuilder{
    constructor(model, context) {
        this.__model = model;
        this.__context = context;
        this.__contextList = context.__allContexts;
    }
    
    raw(query){
        // get the query
        var entityValue = this.__context._SQLEngine.get(query);
        if(entityValue !== undefined){
            var ent = new entityTrackerModel();
            ent.build(entityValue, this.__model);
            ent.__state = "track";
            this.__context.__Track(ent);
            return ent;
        }else{
            return null;
        }

    }

    add(entityValue){
        // This will call context API to REMOVE entity to update list
        var ent = new entityTrackerModel();
        ent.build(entityValue, this.__model);
        ent.__state = "insert";
        this.__context.__Track(ent);
    }
    
    remove(entityValue){
        // This will call context API to REMOVE entity to Delete list
        var ent = new entityTrackerModel();
        ent.build(entityValue, this.__model);
        ent.__state = "delete";
        this.__context.__Track(ent);
    }

    track(entityValue){
        var ent = new entityTrackerModel();
        ent.build(entityValue, this.__model);
        ent.__state = "track";
        return this.__context.__Track(ent);
    }
}

module.exports = queryBuilder;