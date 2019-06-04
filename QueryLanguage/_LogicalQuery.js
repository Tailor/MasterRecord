

var Query = require('masterrecord/QueryLanguage/_simpleQuery');

class LogicalQuery {
    constructor(context, modelName){
        this.__model = context.__allContext[0].__name === modelName;
        this.__query = new Query(this.__model, context);
    }

    build(tokenQuery){

        // we will run code to create new instances of the of the QueryModel and procss code
        // where(r => r.name == "richard").single().flys.distinct().toList();

        // loop thourgh and call all functions to build out the query;
        return this.__query;
    }


}

module.exports =  LogicalQuery;