
// version 0.0.8
var entityTrackerModel = require('masterrecord/Entity/entityTrackerModel');
var tools = require('masterrecord/Tools');
var queryScript = require('masterrecord/QueryLanguage/queryScript');

class queryMethods{

    constructor(entity, context) {
        this.__entity = entity;
        this.__context = context;
        this.__queryObject = new queryScript();
    }

    // build a single entity
    __singleEntityBuilder(dataModel){
        var $that = this;
        if(dataModel){
            var ent = new entityTrackerModel();
            var mod = ent.build(dataModel, $that.__entity, $that.__context);
            mod.__state = "track";
            $that.__context.__track(mod);
            return mod;
        }else{
            return null;
        }
    }

    // build multiple entities
    __multipleEntityBuilder(entityValue){
        var $that = this;
        var listArray = [];
        if(entityValue){
            for(let i = 0; i < entityValue.length; i++){
                listArray.push($that.__singleEntityBuilder(entityValue[i]));
             }
             return listArray;
        }else{
            return null;
        }
    }

    __reset(){
        this.__queryObject.reset();
    }


    // do join on two tables = inner join
    join(){

    }

    groupBy(){
        
    }

    // do join on two tables = inner join
    _____leftJoin(){

    }

    ______orderByCount(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.orderByCount(str, this.__entity.__name);
        return this;
    }

    ______orderByCountDescending(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.orderByCountDesc(str, this.__entity.__name);
        return this;
    }

    orderBy(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.orderBy(str, this.__entity.__name);
        return this;
    }

    orderByDescending(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.orderByDesc(str, this.__entity.__name);
        return this;
    }

    raw(query){
        this.__queryObject.raw(query);
        return this;
    }

    /* WHERE and AND work together its a way to add to the WHERE CLAUSE DYNAMICALLY */
    and(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.and(str, this.__entity.__name);
        return this;
    }

    where(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }

        this.__queryObject.where(str, this.__entity.__name);
        return this;
    }

    // when you dont want to use lazy loading and want it called at that moment
    //Eagerly loading
    include(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.include(str, this.__entity.__name);
        return this;
    }

    // only takes a array of selected items
    select(query,  ...args){
        var str = query.toString();
        if(args){
            for(let argument in args){
                var item = args[argument];
                str = str.replace("$$", item);
            }
        }
        this.__queryObject.select(str, this.__entity.__name);
        return this;
    }

    take(number){
        this.__queryObject.script.take = number;
        return this;
    }

    skip(number){
        this.__queryObject.script.skip = number;
        return this;
    }

    
    // ------------------------------- FUNCTIONS THAT MAKE THE SQL CALL START FROM HERE ON -----------------------------------------------------
    // ---------------------------------------------------------------------------------------------------------------------------------------

    count(query,  ...args){
        if(query){
            var str = query.toString();
            if(args){
                for(let argument in args){
                    var item = args[argument];
                    str = str.replace("$$", item);
                }
            }
            this.__queryObject.count(str, this.__entity.__name);
        }

        if(this.__context.isSQLite){
            // trying to match string select and relace with select Count(*);
            var entityValue = this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
    }

    single(){
        if(this.__context.isSQLite){
            var entityValue = this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            var sing = this.__singleEntityBuilder(entityValue, this._queryBuilder);
            this.__reset();
            return sing;
        }
    }

    toList(){
        if(this.__context.isSQLite){
            var entityValue = this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            var toLi = this.__multipleEntityBuilder(entityValue, this._queryBuilder);
            this.__reset();
            return toLi;
        }
    }

      // ------------------------------- FUNCTIONS THAT UPDATE SQL START FROM HERE  -----------------------------------------------------
    // ---------------------------------------------------------------------------------------------------------------------------------------
    add(entityValue){
        // This will call context API to REMOVE entity to update list
        tools.clearAllProto(entityValue);
        entityValue.__state = "insert";
        entityValue.__entity = this.__entity;
        entityValue.__context = this.__context;
        entityValue.__name = this.__entity.__name;
        this.__context.__track(entityValue);
    }
    
    remove(entityValue){
        entityValue.__state = "delete";
        entityValue.__entity = this.__entity;
        entityValue.__context = this.__context;
    }

    removeRange(entityValues){
        for (const property in entityValues) {
            entityValues[property].__state = "delete";
            entityValues[property].__entity = this.__entity;
            entityValues[property].__context = this.__context;
        }
    }

    track(entityValue){
        entityValue.__state = "track";
        tools.clearAllProto(entityValue);
        entityValue.__entity = this.__entity;
        entityValue.__context = this.__context;
        this.__context.__track(entityValue);
    }
}

module.exports = queryMethods;

