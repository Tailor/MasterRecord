// ALL THIS SHOULD DO IS BUILD A SQL QUERY
// version 1.0.1

class queryManager{
    constructor( query) {

        /*
            queryObject
            {
                "where": where user.id = 1
                "raw": "select * from tablename where user.id = 2" OR false,
                "builder": builderObject,
                "select" : "*",
                "from" : from tablename
            }
        */
        this._query = query;
        this._queryBuilder = query.builder;
        this._context = query.builder.__context;
    }
    
    single(){
        var entityValue = this._context._SQLEngine.get(this._query.getScript());
        var sing = this._queryBuilder.__execute(entityValue, this._queryBuilder);
        return sing;
    }

    //
    select(query){
       // this will come after the where
       this._query.select = "select " + query;
       return this;
    }
    
    count(){
        // trying to match string select and relace with select Count(*);
        var res = this._query.select.replace("select *", "select Count(*)");
        var entityValue = this._context._SQLEngine.get(res);
        var val = entityValue[Object.keys(entityValue)[0]];
        return val;
    }

    toList(){
        var entityValue = this._context._SQLEngine.all(this._query);
        var toLi = this._queryBuilder.__executeList(entityValue, this._queryBuilder);
        return toLi;
    }

}

module.exports = queryManager;


/*

LINQ Extension Methods
First()
FirstOrDefault()
SingleOrDefault()
Count()
Min()
Max()
Last()
LastOrDefault()
Average()
*/
/*

LINQ Extension Methods
First()
FirstOrDefault()
SingleOrDefault()
Count()
Min()
Max()
Last()
LastOrDefault()
Average()
*/