// ALL THIS SHOULD DO IS BUILD A SQL QUERY
var entityTrackerModel  = require('masterrecord/Entity/EntityTrackerModel');
var sqlEngine = require('./SQLEngine');

class queryBuilder{
    constructor(model, context) {
        this.__model = model;
        this.__context = context;
        this.__contextList = context.__allContexts;
    }
    
    raw(query){
        // get the query
        var entityValue = sqlEngine.get(query);
        var ent = entityTrackerModel.build(entityValue, this.__model);
        ent.__state = "track";
        this.__context.__Track(ent);
        return ent;
    }

    add(entityValue){
        // This will call context API to REMOVE entity to update list
        var ent = entityTrackerModel.build(entityValue, this.__model);
        ent.__state = "insert";
        this.__context.__Track(ent);
    }
    
    remove(entityValue){
        // This will call context API to REMOVE entity to Delete list
        var ent = entityTrackerModel.build(entityValue, this.__model);
        ent.__state = "delete";
        this.__context.__Track(ent);
    }

    track(entityValue){
        var ent = entityTrackerModel.build(entityValue, this.__model);
        ent.__state = "track";
        return this.__context.__Track(ent);
    }
}

module.exports = queryBuilder;