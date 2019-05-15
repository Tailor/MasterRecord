
var Expression = require("masterrecord/Expression");
// TODO: support for MySQL and Postgres Comming
/// TODO: Adding a ! ads not to the query

// IDEAS
// https://stackoverflow.com/questions/10455414/with-entity-framework-is-it-better-to-use-first-or-take1-for-top-1

// NEXT VERSION ADD LAMBDA SUPPORT 


class QueryLanguage{
    constructor(model, modelName, context) {
        this.__info__ = {};
        this.__info__.context = context;
        this.__info__.sexpress = new Expression();
        this.__info__.name = modelName;
        this.__info__.model = model;
        this.__info__.selectFields = [];
        this.__info__.orders = [];
        this.__info__.groups = [];
        this.__info__.where = [];
        this.__info__.joins = [];
        this.__info__.skipValue = null;
        this.__info__.except = null;
        this.__info__.limitValue = null;

    }

    skip(amount){
        /*
        
        SELECT   Name,
         ProductNumber,
         StandardCost
         FROM Production.Product
         ORDER BY StandardCost
         OFFSET 10 ROWS
         FETCH NEXT 10 ROWS ONLY

         // You can use OFFSET without FETCH, but FETCH can’t be used by itself.  
         // Regardless, OFFSET must be used with an ORDER BY clause.  
         // The reason is simple as OFFSET and FETCH are part of the ORDER BY clause

        */
        let skip = Math.floor(amount); 
        if (skip < 0) {
            throw new Error("Negative values are not allowed.");
        }
        this.__info__.skipValue = skip === 0 ? null : skip;
        return this;
    }

    take(amount){
        // SELECT * FROM Table ORDER BY ID DESC LIMIT AMOUNT
        let take = Math.floor(amount); 
        if (take < 0) {
            throw new Error("Negative values are not allowed.");
        }
        this.__info__.limitValue = take === 0 ? null : take;
        return this;
    }

    last(exp){
        // SELECT * FROM Table ORDER BY ID DESC LIMIT 1
        const expr = this.__info__.sexpress.matchExpression(exp); // will return selectFields
        this.__info__.orders.push({  name: "LAST", func: expr.selectFields + " DESC", arg: "DESC" });
        this.__info__.limitValue = 1;
        return this;
    }

    orderByDescending(expr){
        // SELECT * FROM Table ORDER BY ID DESC
        const expr = this.__info__.sexpress.matchExpression(exp);
        this.__info__.orders.push({ name: "DESC", func: expr.selectFields  + " DESC", arg: "DESC" });
        return this;
    }

    orderBy(expr){
        // SELECT * FROM Table ORDER BY ID ASC
        const expr = this.__info__.sexpress.matchExpression(exp);
        this.__info__.orders.push({ name: "ORDER BY", func:"ORDER BY " + expr.selectFields + " ASC", arg: "ASC" });
        return this;
    }

    groupBy(exp){
        /*
        SELECT column_name(s)
        FROM table_name
        WHERE condition
        GROUP BY column1, column2
        ORDER BY column_name(s);
        */
        const expr = this.__info__.sexpress.matchExpression(exp);
        this.__info__.groups.push({name: "GROUP BY", func:"GROUP BY " + expr.selectFields + " ASC", order: "ASC" });
        return this;
    }
    
    union(expr){
        // https://www.tabsoverspaces.com/233043-union-and-concat-in-linq-to-entities
        // https://weblogs.asp.net/dixin/entity-framework-core-and-linq-to-entities-4-query-methods
    }

    find(id){
        // Select * where id = "yaho"
        this.__info__.where.push({ ame: "ID", func: "ID = " + id, arg: "=" , value: id});
        return this;
    }

    where(exp, ...args){
        // TODO: MUST PARSE CONTAINS AND LIKE FUNCTIONS
        //https://github.com/Hookyns/unimapperjs/blob/master/src/Query.js;
        this.__info__.sexpress.addExpression(exp, ...args);
        var where = this.__info__.sexpress.whereArgs;
        var conditions =  this.__info__.sexpress.conditions
        return this;
    }

    except(exp){
        /*
         The SQL EXCEPT clause/operator is used to combine two SELECT statements and returns rows
         from the first SELECT statement that are not returned by the second SELECT statement
         This means EXCEPT returns only rows, which are not available in the second SELECT statement.
        */

        /*
        SELECT  ID, NAME, AMOUNT, DATE
        FROM CUSTOMERS
        LEFT JOIN ORDERS
        ON CUSTOMERS.ID = ORDERS.CUSTOMER_ID
        EXCEPT
        SELECT  ID, NAME, AMOUNT, DATE
        FROM CUSTOMERS
        RIGHT JOIN ORDERS
        ON CUSTOMERS.ID = ORDERS.CUSTOMER_ID;
        */
        this.__info__.except =  this.__info__.sexpress.matchExpression(exp);
        return this;
    }

    any(exp, ...args){
        // https://stackoverflow.com/questions/12429185/linq-to-entities-any-vs-first-vs-exists
        // checks is this expression exist
        // this.__info__.where = null;
        // SELECT *
        // FROM customers
        // WHERE EXISTS (SELECT *
        //       FROM order_details
        //       WHERE customers.customer_id = order_details.customer_id);
        
        this.__info__.where = [{name: "EXISTS", func: "EXISTS(" +  this.__info__.sexpress.addExpression(exp, ...args) + ")"}];
        return this;

    }


    //============================================================================================
    // ============================== */ Aggregate functions /* ===============================
    //============================================================================================

    // function returns the number of rows that matches a specified criteria.
    select(exp){
        // nested selects,
        // https://benjii.me/2018/01/expression-projection-magic-entity-framework-core/

        const expr = this.__info__.sexpress.initExpression(exp, this.__info__.model,this.__info__.name); // will return selectFields
        var entity = expr.entity;

        // loop through fields 
        for (const field of expr.selectFields) {
            this.__info__.selectFields.push({func: "[" + entity + "]." + "[" + field + "]"});
        }

        for (const virtualObj of expr.virtualFields) {
            var nestedField = []
            // if context has many/collection of the field name the next item after context should be an arg
            // if context has on of the field it's not a collection then the next field should be a field of context.
            var virtualObjff = this.__info__.sexpress.getContext(virtualObj, this.__info__.context);
            // virtualObjff returns the next item with the context
            // todo does it pass the rule 
            if(virtualObjff.type === "collection"){
                // next item should be an argument
                // TODO: this will create a new instance of query language and call all its arguments and return context values.
                var nestedInstance = this.__info__.sexpress.nestedQueryBuilder(virtualObjff);
                nestedField.push(nestedInstance);
                // or throw an error

            }
            else{
                // TODO: run loop aagain and build nested objects
            }
            var name = "";
        }

       // TODO : all nested fields  of that specific context should have an argument on the next call

        // TODO:
        // loop through virtualFields
            // create new object using the virtual name
            // if it doesn't exist then throw error
            // then get the next element on the string
            
            // check if the next element is a field of that context.
                // if not then check if its a nested object
                // if its not a nested object and not field then throw error
                // if it is then call that object with the inner expression.
            // if it is a field then get the next element after that

            // then check if the element is a nested arguments
            // if it is then get the inside of that string and pass it to the nested arguemnt
            // then run build query
            // return that query and add it the select fields func name.
        // loop through nestedFields

        return this;
    }

    distinct(){
        // SELECT DISTINCT
        this.__info__.selectFields.push({name: "DISTINCT", func: "DISTINCT", arg: ""});
        return this;
    }

    count(columnName){
        // todo: if columnName not added put *
        // SELECT COUNT(column_name)
        this.__info__.selectFields.push({ name: "COUNT", func: "COUNT(" + columnName + ")", arg: columnName});
        return this;
    }

        // function returns the average value of a numeric column.
    average(columnName){
        // SELECT AVG(column_name)
        this.__info__.selectFields.push({ name: "AVG", func: "AVG(" + columnName + ")", arg: columnName});
        return this;
    }

    // function returns the total sum of a numeric column.
    sum(columnName){
        // SELECT SUM(column_name)
        this.__info__.selectFields.push({ name: "SUM", func: "SUM(" + columnName + ")", arg: columnName});
        return this;
    }

    // function returns the largest value of the selected column.
    max(columnName){
        //SELECT MAX(column_name)
        this.__info__.selectFields.push({ name: "MAX", func: "MAX(" + columnName + ")", arg: columnName});
        return this;
    }

    // function returns the smallest value of the selected column.
    min(columnName){
        // SELECT MIN(column_name)
        this.__info__.selectFields.push({ name: "MIN", func: "MIN(" + columnName + ")", arg: columnName});
        return this;
    }


    //============================================================================================
    // ============================== */ Join functions /* ===============================
    //============================================================================================

    join(tableName, primaryKeyExp, foreignKeyExp ){
        // SELECT Orders.OrderID, Customers.CustomerName, Orders.OrderDate
        // FROM Orders
        // INNER JOIN Customers ON Orders.CustomerID=Customers.CustomerID;
        const primaryKeyExpr = this.__info__.sexpress.matchExpression(primaryKeyExp);
        const ForeignKeyExpr = this.__info__.sexpress.matchExpression(foreignKeyExp);

        this.__info__.joins.push({ func: "JOIN", arg:{primaryKeyExpr : primaryKeyExpr,  ForeignKeyExpr: ForeignKeyExpr} });
        // RETURNS AN ARRAY OBJECTS
        // [{
        //     FIRSTNAME: RICHARD,
        //     NICKNAME : JAMES
        // },
        // {
        //     FIRSTNAME: ROBERT,
        //     NICKNAME : ALEX
        // }]
        return this;
    }

    groupJoin(tableName, primaryKeyExp, foreignKeyExp ){
        // https://sqlzoo.net/wiki/The_JOIN_operation
        //https://arnhem.luminis.eu/linq-and-entity-framework-some-dos-and-donts/
        //IMPORTANT https://weblogs.thinktecture.com/pawel/2018/04/entity-framework-core-performance-beware-of-n1-queries.html
        // SELECT Orders.OrderID, Customers.CustomerName, Orders.OrderDate
        // FROM Orders
        // INNER JOIN Customers ON Orders.CustomerID=Customers.CustomerID;
        const primaryKeyExpr = this.__info__.sexpress.matchExpression(primaryKeyExp);
        const ForeignKeyExpr = this.__info__.sexpress.matchExpression(foreignKeyExp);

        this.__info__.joins.push({ func: "GROUPJOIN", arg:{primaryKeyExpr : primaryKeyExpr,  ForeignKeyExpr: ForeignKeyExpr} });
        // https://stackoverflow.com/questions/15595289/linq-to-entities-join-vs-groupjoin
        // RETURNS AN ARRAY OF GROUPED ARRAYS OBJECTS BY WHATEVER PRIMARY KEY YOU USED
        // [
            //[{
            //     FIRSTNAME: RICHARD,
            //     NICKNAME : JAMES
            // }
            //],
            // [{
            //     FIRSTNAME: ROBERT,
            //     NICKNAME : ALEX
            // }]
        // ]
        return this;
    }

    //============================================================================================
    // ============================== */ trigger will make call /* ===============================
    //============================================================================================

    // Anything that returns a concrete object or data structure 
    // (Count, Sum Single, First, ToList, ToArray, etc.) is evaluated immediately, so 
    // SingleOrDefault certainly does.

    // Anything that returns an IQueryable<T> (Select, GroupBy, Take) will be deferred 
    // (so that operations can be chained), so Queryable.Union will be deferred.

    // Anything that returns an IEnumerable<T> will also be deferred, but subsequent queries 
    // will be done in Linq-to-objects, so subsequent operations 
    // won't be translated to SQL. (Empty is an exception since there's not really 
    // anything to defer - it just returns an empty collection)

    // Entity Framework
    // SqlQuery


    // THESE ARE RETURN TYPES METHOD'S: these dont return this;
    // ToArray does the exact thing as tolist just syntax suger.
    // ToDictionary(kvp => kvp.Key, kvp => kvp.Value) // this will turn it into an object literal with column name and value.
    // ToList<TSource> return array list
    // single // return a single object literal.

    // https://docs.microsoft.com/en-us/dotnet/framework/data/adonet/ef/language-reference/supported-and-unsupported-linq-methods-linq-to-entities
    toArray(){
        // TODO: run query and parse results
    }

    toDictionary(){
 // TODO: run query and parse results
    }

    toList(){
    // TODO: run query and parse results


    }

    single(){
 // TODO: run query and parse results
    }

}


module.exports = QueryLanguage;


// this.trigger = function(queryName, query){
//     let queryString = "";
//     switch(queryName) {
//         case "count":
//             queryString += query;
//             break;
//         case undefined: 
//             queryString += `SELECT ${this.name}.* FROM ${this.name}`;
//             break;
            
//     }
    
//     for (var i = 0; i < this.query.length; i++) {
//         queryString += " " + this.query[i];
//     }

//     var select = selectColumns(this._model);
//     // TODO: COMBINE THIS_MODEL WITH THE MODEL THAT IS BEING RETURNED
//     // loop though model
//     // 
//     var qq = "select "+ select +" "+query;
//    var data = Masterrecord.db.prepare(qq).get();
//    return callGets(data, this._model);

// }