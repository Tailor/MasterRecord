// create a queryModel

// dateRange =  to and from - BETWEEN predicate

// Operators =  NotDefined, Equals, NotEquals, Like, NotLike, In, NotIn

// LogicalOperator = NotDefined, Or, And, contains, like

// Conditions = joins, and all other predicates

// limits - single(), toList()

// TODO: Turning off lazy loading for specific navigation propertie

// Rules
// nothing comes after select statment
// where must have a an argument

// single() method adds limit


// TODO: build out conditions
var LogicalQuery = require('masterrecord/QueryLanguage/LogicalQuery');


class QueryModel {

    constructor(model, context){
        this.__model = model;
        this.__context = context;
        this.tokenList = null;
        this.firstToken = null;
        this.secondToken = null;
        this.thirdToken = null;
        this.buildQueryList = [];
        this.queryModel = {
            name : model.__name,
            context : null,
            limits:{},
            conditions : [],
            relationships: [],
            selects:[]
        };
    }

    updateQueryName(name){
        this.queryModel.name = name;
    }

    stringArrayList(addArray, list)
    {
        var listArray = list.split(',');
        for (var i = 0; i < listArray.length; i++) {
            addArray.push(listArray[i]);
        }
    }

    discardToken(){
        this.firstToken = this.secondToken;
        this.secondToken = this.thirdToken;
        if(this.tokenList.length !== 0){
            this.thirdToken = this.tokenList.shift();
        }
        else{
            this.thirdToken = "";
        }
    }

    setupTokenList(){
        this.firstToken = this.tokenList.shift();
        this.secondToken = this.tokenList.shift();
        this.thirdToken = this.tokenList.shift();
    }

    condition(tokenList, type){
        // update the condition part of the query
        this.tokenList = tokenList;
        this.setupTokenList();
        this.createNewCondition(type);
        return this.queryModel;
    }

    select(tokenList){

        //this.currentContext = currentContext;
        this.tokenList = tokenList;
        this.setupTokenList();
        this.createNewSelect();
        return this.queryModel;
    }

    relationship(name, innerQuery){

        var relationshipContext = this.getValidContext(this.__context.__allContexts, name);
        // this means it found the context
        if(relationshipContext !== -1){
            this.discardToken();
            var Query = require('masterrecord/QueryLanguage/simpleQuery');
            var queryNew = new Query(relationshipContext, this.__context);
            var innerQuery = innerQuery === undefined ? this.buildInnerQueryObject("",queryNew) : innerQuery;
            // get all the code that relates to relationship
            var relationshipQuery = this.callInnerQuery(innerQuery, queryNew);
            this.queryModel.relationships.push(relationshipQuery);
        }
        //var innerQuery = LQ.build(`s.Fruits.where(r => r.name == "richard").single().flys.distinct().toList()`);
    }

    callInnerQuery(innerProp, queryObj){
           // TODO: loop through innerprop
           var queryHolder = null;
    
           for (var i = 0; i < innerProp.length; i++) { 
                     
               if(innerProp[i].type === "method"){
                    queryHolder = queryObj[innerProp[i].name](innerProp[i].innerValue);
                }
                else{
                    // TODO: we need to turn this back into a string because the data is currupted.
                    innerProp = innerProp.splice(i, innerProp.length);
                    this.relationship(innerProp[0].name, innerProp);
                }
            }

            return queryHolder.__queryModel.queryModel;
    }

    buildInnerQueryObject(skip, queryObj){

        skip = skip === undefined ? false : skip;
        if(skip){
            this.discardToken();
        };

        var obj = {
            name : null,
            type: null,
            innerValue : null
        }

        if(this.firstToken[0] === "closeBraces"){
            this.discardToken();
            return this.buildQueryList;
        }
        else if(this.firstToken[0] === "comma"){
            this.discardToken();
            return this.buildQueryList;
        }
        else{
            if(this.firstToken[0] === "dot"){
                this.discardToken();
                this.buildInnerQueryObject(undefined, queryObj);
            }
            else{
                obj.name = this.firstToken[1];
                if(this.secondToken[0] === "openParenthesis"){
                    obj.type = "method";
                    obj.innerValue = this.getValueInsideParenthesis();
                    this.buildQueryList.push(obj);
                    this.buildInnerQueryObject(true, queryObj);
                }else{
                    if(this.firstToken[0] === "field" && this.secondToken[0] === "dot"){
                        if(queryObj.__queryModel.queryModel.name !== this.firstToken[1]){
                            obj.type = "relationship";
                            this.buildQueryList.push(obj);
                            this.buildInnerQueryObject(true, queryObj);
                        }else{
                            this.buildInnerQueryObject(true, queryObj);
                        }
                    }else{
                        this.buildInnerQueryObject(true, queryObj);
                    }
                }
            }
        }
        //this.buildInnerQueryObject();
        return this.buildQueryList;
    }

    getValueInsideParenthesis(){
        var inner = [];
        this.discardToken();
        while (this.firstToken[0] !== "closeParenthesis"){
            inner.push(this.firstToken[1]);
            this.discardToken();
        } 
        return inner.join(" ");
        // TODO: LOOP through and get all values inside paranthese
    }

    // loops through and checks if there is a field inside the context with that name.
    getValidContext(contextArray, name){
        for (var i = 0; i < contextArray.length; i++) {
            if(contextArray[i].__name === name){
                return contextArray[i];
            }
        }
        return -1;
    }

    limit(){
        // update the limit part of the query
    }

    dateRange(){
        // update ht edate range of the query
    }

    checkComplete(val, skip){
        skip = skip === undefined ? false : skip;
        if(skip){
            this.discardToken();
        };

        var switchValue = this.firstToken[0] + " " + this.secondToken[0] + " " + this.thirdToken[0];

        switch(switchValue) {
            case "field dot field":
                this.addFieldName(val);
                break;
            case "not field dot":
                // this.addNotFieldNot(); TODO : implement
            break;
            case "comma field colon":
                this.createNewSelect(true);
            break;
            case "field arrowHead openParenthesis":
                this.getContextName(val);
            break;
            case "field arrowHead field":
            this.getContextName(val);
            break;
            case "field colon not":
                this.getReturnName(val);
            break;
            case "field colon field":
                this.getReturnName(val);
            break;
            case "dot field openParenthesis":
                this.checkConditions();
            break;
            case "dot field dot":
                this.addFieldName(val);
            break;
            case undefined:
                return;
            break;
            case 'undefined undefined undefined':
                return;
            break
            default:
                // code block
                this.checkComplete(val, true);
            }

        return;
    }

    createNewCondition(type){

        this.currentCondition = {
            type : type,
            context: "",
            field : {},
            operators : [],
        };

        this.queryModel.conditions.push(this.currentCondition);
        this.checkComplete(this.currentCondition);
        return;
    }

    createNewSelect(option){

        this.currentSelect = {
            returnName : "",
            context: "",
            field : {},
            operators : [],
        };

        this.queryModel.selects.push(this.currentSelect);
        this.checkComplete(this.currentSelect, option);
        return;
    }

    getContextName(val){
        this.queryModel.context = this.firstToken[1];
        this.checkComplete(val, true);
        return;
    }

    getReturnName(prop){
        prop.returnName = this.firstToken[1];
        this.checkComplete(prop, true);
        return;
    }

    addFieldName(val){
        // loop through all the context to see if there is one with that name
        // and if so then thats a relationship
        if(this.__model[this.thirdToken[1]] !== undefined) //for testing purposes this will be a relationship
        {
            if(this.getValidContext(this.__context.__allContexts, this.thirdToken[1]) !== -1){
                this.relationship(this.thirdToken[1]);
            }
            else{
                if(val.field.context === undefined){
                    val.field.context = this.firstToken[1];
                    val.field.parent = this.queryModel.context;
                    val.field.name = this.thirdToken[1];
                }
            }
 
        }
        this.checkOperators(val);
        this.checkComplete(val, true);
        return;
    }

    checkConditions(){
        switch(this.secondToken[0] + " " + this.thirdToken[0]) {
            case "in openParenthesis":
                this.parseInCondition();
                this.checkSectionComplete(this.firstToken[0]);
                break;
            case "like openParenthesis":
                this.parseInCondition();
            break;
            case "single openParenthesis":
                this.parseSingleCondition();
            break;
            case "where openParenthesis":
                this.parseWhereCondition();
            break;
        }
        this.checkComplete();
        return;
    }

    checkOperators(val){

        this.discardToken();
        this.discardToken();
        this.discardToken();
        
        if(this.isOperator(this.firstToken))
        {
            this.createCurrentOperator(val.field);
            this.checkLogicalOperators();
            val.operators.push(this.currentOperator);
        }
        this.checkComplete(val);
        return;
    }

    checkLogicalOperators(){
       // will add logical operator to the
       if(this.isLogicalOperator(this.firstToken)){
            this.currentOperator.logicalOperator = this.firstToken[0];
            this.discardToken();
       }
    }

    isQuotes(token){
        return token[0] === "doubleQuotes"
            || token[0] === "singleQuotes";
    }

    isLogicalOperator(token){
        return token[0] === "or"
            || token[0] === "and";
    }

    isOperator(token)
    {
        return token[0] === "notEqualsSingle"
            || token[0] === "notEqualsDouble"
            || token[0] === "tripleEquals"
            || token[0] === "doubleEquals"
            || token[0] === "greaterThen"
            || token[0] === "lessThen"
            || token[0] === "greaterThenEqualTo"
            || token[0] === "lessThenEqualTo"
            || token[0] === "or"
            || token[0] === "and";
    }

    createCurrentOperator(field)
    {
        this.currentOperator = {
            context : field.name, // field name
            operator : this.firstToken[0],
            logicalOperator : null
        };

        this.discardToken();
        
        if(this.isQuotes(this.firstToken)){
            this.discardToken();
            this.currentOperator.value = this.firstToken[1]; // field name
            this.discardToken();
        }
        else{
            this.currentOperator.value = this.firstToken[1];
        }

        this.discardToken();
    }
    
    parseInCondition(){
        this.discardToken();

        this.currentOperator = {
            context : this.currentSelect.fields[this.currentSelect.fields.length - 1].name, // field name
            operator : this.firstToken[0],
            logicalOperator : null
        };

        this.discardToken();
        this.discardToken();
        
        if(this.isQuotes(this.firstToken)){
            this.discardToken();
            this.currentOperator.value = this.firstToken[1]; // field name
            this.discardToken();
        }
        else{
            this.currentOperator.value = this.firstToken[1];
        }
        this.currentSelect.operators.push(this.currentOperator);
        this.discardToken();
        this.discardToken();
    }

    parseWhereCondition(){

        // create new condition and with name where
    }
}


module.exports =  QueryModel;