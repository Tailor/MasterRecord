
// version 0.0.15
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
        str = this.__validateAndReplacePlaceholders(str, args, 'orderByCount');
        this.__queryObject.orderByCount(str, this.__entity.__name);
        return this;
    }

    ______orderByCountDescending(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'orderByCountDescending');
        this.__queryObject.orderByCountDesc(str, this.__entity.__name);
        return this;
    }

    orderBy(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'orderBy');
        this.__queryObject.orderBy(str, this.__entity.__name);
        return this;
    }

    orderByDescending(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'orderByDescending');
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
        str = this.__validateAndReplacePlaceholders(str, args, 'and');
        this.__queryObject.and(str, this.__entity.__name);
        return this;
    }

    where(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'where');
        this.__queryObject.where(str, this.__entity.__name);
        return this;
    }

    // when you dont want to use lazy loading and want it called at that moment
    //Eagerly loading
    include(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'include');
        this.__queryObject.include(str, this.__entity.__name);
        return this;
    }

    // only takes a array of selected items
    select(query,  ...args){
        var str = query.toString();
        str = this.__validateAndReplacePlaceholders(str, args, 'select');
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
            str = this.__validateAndReplacePlaceholders(str, args, 'count');
            this.__queryObject.count(str, this.__entity.__name);
        }

        if(this.__context.isSQLite){
            // trying to match string select and relace with select Count(*);
            var entityValue = this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        
        if(this.__context.isMySQL){
            // trying to match string select and relace with select Count(*);
            var entityValue = this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
    }

    __validateAndReplacePlaceholders(str, args, methodName){
        // Count placeholders
        const placeholderCount = (str.match(/\$\$/g) || []).length;
        const providedCount = args ? args.length : 0;
        if(placeholderCount !== providedCount){
            const msg = `Query argument error in ${methodName}: expected ${placeholderCount} value(s) for '$$', but received ${providedCount}.`;
            console.error(msg);
            throw new Error(msg);
        }
        if(args){
            for(let argument in args){
                var item = args[argument];
                if(typeof item === 'undefined'){
                    const msg = `Query argument error in ${methodName}: placeholder value at index ${argument} is undefined.`;
                    console.error(msg);
                    throw new Error(msg);
                }
                str = str.replace("$$", item);
            }
        }
        return str;
    }

    single(){
        // If no clauses were used before single(), seed defaults so SQL is valid
        if(this.__queryObject.script.entityMap.length === 0){
            this.__queryObject.skipClause(this.__entity.__name);
            this.__queryObject.script.take = 1;
        }

        if(this.__context.isSQLite){
            var entityValue = this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            var sing = this.__singleEntityBuilder(entityValue);
            this.__reset();
            return sing;
        }
        
        if(this.__context.isMySQL){
            var entityValue = this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            var sing = this.__singleEntityBuilder(entityValue[0]);
            this.__reset();
            return sing;
        }
    }

    toList(){
        if(this.__context.isSQLite){
            if(this.__queryObject.script.entityMap.length === 0){
                this.__queryObject.skipClause( this.__entity.__name);
                if(!this.__queryObject.script.take || this.__queryObject.script.take === 0){
                    this.__queryObject.script.take = 1000;
                }
            }
            var entityValue = this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            var toLi = this.__multipleEntityBuilder(entityValue);
            this.__reset();
            return toLi;
        }

        if(this.__context.isMySQL){
            if(this.__queryObject.script.entityMap.length === 0){
                this.__queryObject.skipClause( this.__entity.__name);
                if(!this.__queryObject.script.take || this.__queryObject.script.take === 0){
                    this.__queryObject.script.take = 1000;
                }
            }
            var entityValue = this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            var toLi = this.__multipleEntityBuilder(entityValue);
            this.__reset();
            return toLi;
        }
    }

      // ------------------------------- FUNCTIONS THAT UPDATE SQL START FROM HERE  -----------------------------------------------------
    // ---------------------------------------------------------------------------------------------------------------------------------------
    add(entityValue){
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

        // If the entity has an __ID, try to find and update it in tracked entities
        if(entityValue.__ID){
            var tracked = this.__context.__findTracked(entityValue.__ID);
            if(tracked){
                // Update the tracked entity's state
                tracked.__state = "delete";
                return;
            }
        }

        // If not already tracked, track it now
        this.__context.__track(entityValue);
    }

    removeRange(entityValues){
        for (const property in entityValues) {
            var entityValue = entityValues[property];
            entityValue.__state = "delete";
            entityValue.__entity = this.__entity;
            entityValue.__context = this.__context;

            // If the entity has an __ID, try to find and update it in tracked entities
            if(entityValue.__ID){
                var tracked = this.__context.__findTracked(entityValue.__ID);
                if(tracked){
                    // Update the tracked entity's state
                    tracked.__state = "delete";
                    continue;
                }
            }

            // If not already tracked, track it now
            this.__context.__track(entityValue);
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

