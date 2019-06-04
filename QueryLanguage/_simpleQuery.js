// ALL THIS SHOULD DO IS BUILD A SQL QUERY
var EntityTrackerModel  = require('masterrecord/Entity/EntityTrackerModel');
var Tokenize  = require('masterrecord/QueryLanguage/_Tokenization');
var QueryModel = require('masterrecord/QueryLanguage/_QueryModel');


class simpleQuery{
    constructor(model, context) {
        this.__model = model;
        this.__context = context;
        this.__contextList = context.__allContexts;
        this.__queryModel = new QueryModel(model, context);
    }
    
    raw(query){

    }

    add(entityValue){
        // This will call context API to REMOVE entity to update list
        var ent = EntityTrackerModel.build(entityValue, this.__model);
        ent.__state = "insert";
        this.__context.__Track(ent);
    }
    
    remove(entityValue){
        // This will call context API to REMOVE entity to Delete list
        var ent = EntityTrackerModel.build(entityValue, this.__model);
        ent.__state = "delete";
        this.__context.__Track(ent);
    }

    track(entityValue){
        var ent = EntityTrackerModel.build(entityValue, this.__model);
        ent.__state = "track";
        return this.__context.__Track(ent);
    }
    

    toList(){
        // Rule you cannot do fucntions on queryNames s.count() will through error
        /// select delimiter
        // select [ID] AS [ID], 
        // CASE WHEN ([Extent1].[Name] LIKE N'%jist%') THEN cast(1 as bit) WHEN ( NOT ([Extent1].[Name] LIKE N'%Jist%')) THEN cast(0 as bit) END AS [C1],
        // cannot do where on fields that dont have relationships;;
            var qq = `s => ({
                id: s.Id,
                jj: s.Name != "richy" && s.james === "josj",
                name: !s.Name.contains("jist"),
                NumberOfFruits : s.Fruits.where(r => r.name == "richard").single().Courses.distinct()
           }`;

           var were = `s => s.Fruits.where(r => r.name == "richard").single().flys.distinct().toList()`;

           var QueryModelTest = {
                name : "posts",
                limit:{},
                dateRange: "",
                conditions:[],
                selects: [{
                    returnName : "id",
                    field : {
                        property: "s",
                        name : "id"
                    },
                    property : "s",
                },{
                    returnName : "jj",
                    field : {
                        property : "s",
                        name : "Name"
                    },
                    property : "s",
                    operators : [{
                        property : "s",
                        field: "Name",
                        operator: "notEqual",
                        value : "richy",
                        logicalOperator : "and"
                    },{
                        property : "s",
                        field: "james",
                        operator: "equal",
                        value : "josj",
                        logicalOperator : ""
                    }]
                },{
                    returnName : "name",
                    field : {
                        property : "s",
                        name : "name"
                    },
                    property : "s",
                    operator: [{
                        property : "s",
                        field: "name",
                        operator: "not",
                        value : "",
                        logicalOperator : "",
                    },
                    {
                        property : "s",
                        field: "Name",
                        operator: "in",
                        value : "jist",
                        logicalOperator : "",
                    }]
                },
                {
                    returnName : "NumberOfFruits",
                    fields : {},
                    property : "s",
                    operator: [],
                }
            ],
            relationships :  [{ // union all relationships together
                name: "Fruits", // could be changed nested type
                dateRange: "",
                limits: {
                    amount :1,
                    object : "single"  //  nested limit will produce inner select top
                },
                selects:[],
                relationships: [{
                    name: "flys", // could be changed nested type
                    dateRange: "",
                    limits: {},
                    selects:[],
                    relationships: [],
                    conditions: []
                }],
                conditions: [{
                    type: "where",
                    context: "r",
                    field : {
                        property : "r",
                        name : "id"
                    },
                    operators: [{
                        property : "r",
                        field: "name",
                        operator: "equal",
                        value : "richard",
                        logicalOperator : ""
                    }],
                }]
            }]

        };


        var tt = new Tokenize();
        var tokenList = tt.Tokenize(qq);
        var james = this.__queryModel.select(tokenList);
        var jj = "";
    }

    where(query){
        if(query !== undefined || query !== null){
            var tt = new Tokenize();
            var tokenList = tt.Tokenize(query);
            this.__queryModel.condition(tokenList, "where");
        }
        return this;
    }

    select(query){
        var tt = new Tokenize();
        var tokenList = tt.Tokenize(query);
        this.__queryModel.select(tokenList);
        return this;
    }
    
    // can only be used at the end of a query not an inner query
    single(){
        return this;
    }

    distinct(){
        return this;
    }
}

module.exports = simpleQuery;