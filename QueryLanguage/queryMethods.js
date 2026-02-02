
// version 0.0.16
var entityTrackerModel = require('masterrecord/Entity/entityTrackerModel');
var tools = require('masterrecord/Tools');
var queryScript = require('masterrecord/QueryLanguage/queryScript');

class queryMethods{

    constructor(entity, context) {
        this.__entity = entity;
        this.__context = context;
        this.__queryObject = new queryScript();
        this.__useCache = false;  // Disable caching by default (opt-in with .cache())
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
        str = this.__validateAndCollectParameters(str, args, 'orderByCount');
        this.__queryObject.orderByCount(str, this.__entity.__name);
        return this;
    }

    ______orderByCountDescending(query,  ...args){
        var str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderByCountDescending');
        this.__queryObject.orderByCountDesc(str, this.__entity.__name);
        return this;
    }

    orderBy(query,  ...args){
        var str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderBy');
        this.__queryObject.orderBy(str, this.__entity.__name);
        return this;
    }

    orderByDescending(query,  ...args){
        var str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderByDescending');
        this.__queryObject.orderByDesc(str, this.__entity.__name);
        return this;
    }

    /**
     * Enable query result caching for this query
     * Use for frequently accessed, rarely changed data (categories, settings, etc.)
     * Cache is shared across all context instances and invalidated on saveChanges()
     *
     * @example
     * // Cache this query result
     * const categories = db.Categories.cache().toList();
     *
     * // Without .cache(), always hits database (default)
     * const user = db.User.findById(1);
     */
    cache() {
        this.__useCache = true;
        return this;
    }

    raw(query){
        this.__queryObject.raw(query);
        return this;
    }

    /* WHERE and AND work together its a way to add to the WHERE CLAUSE DYNAMICALLY */
    and(query,  ...args){
        var str = query.toString();
        // Transform .includes() syntax to .any() syntax
        var transformResult = this.__transformIncludes(str, args);
        str = transformResult.query;
        args = transformResult.args;
        str = this.__validateAndCollectParameters(str, args, 'and');
        this.__queryObject.and(str, this.__entity.__name);
        return this;
    }

    where(query,  ...args){
        var str = query.toString();
        // Transform .includes() syntax to .any() syntax
        var transformResult = this.__transformIncludes(str, args);
        str = transformResult.query;
        args = transformResult.args;
        str = this.__validateAndCollectParameters(str, args, 'where');
        this.__queryObject.where(str, this.__entity.__name);
        return this;
    }

    // when you dont want to use lazy loading and want it called at that moment
    //Eagerly loading
    include(query,  ...args){
        var str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'include');
        this.__queryObject.include(str, this.__entity.__name);
        return this;
    }

    // only takes a array of selected items
    select(query,  ...args){
        var str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'select');
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

    async count(query,  ...args){
        if(query){
            var str = query.toString();
            str = this.__validateAndCollectParameters(str, args, 'count');
            this.__queryObject.count(str, this.__entity.__name);
        }

        if(this.__context.isSQLite){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }

        if(this.__context.isMySQL){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
    }

    /**
     * Transform .includes() syntax to .any() syntax
     * Converts: $$.includes(entity.field) => entity.field.any($$)
     * This allows natural JavaScript array syntax while using existing .any() infrastructure
     */
    __transformIncludes(str, args){
        // Pattern: $$.includes(entity.field) or $$.includes(entity.field.nested)
        const includesPattern = /\$\$\.includes\s*\(\s*([\w\d$_]+)\.([.\w\d_]+)\s*\)/g;

        // Use replace with a function - when using a function, return value is used literally
        const transformedStr = str.replace(includesPattern, (match, entity, field) => {
            // Transform to .any() syntax: entity.field.any($$)
            return entity + '.' + field + '.any($$)';
        });

        return { query: transformedStr, args: args };
    }

    __validateAndCollectParameters(str, args, methodName){
        // Count placeholders - support both $$ (standard) and $ (backwards compatibility)
        // Match $$ first to avoid double-counting, then match remaining single $
        let placeholderCount = 0;
        let tempStr = str;

        // Count $$ placeholders first
        const doubleDollarMatches = tempStr.match(/\$\$/g);
        if(doubleDollarMatches){
            placeholderCount += doubleDollarMatches.length;
            // Remove $$ from string to avoid double-counting
            tempStr = tempStr.replace(/\$\$/g, '');
        }

        // Count remaining single $ placeholders
        // Exclude $N (postgres placeholders like $1, $2) and $$ (already counted)
        const singleDollarMatches = tempStr.match(/\$(?!\d)/g);
        if(singleDollarMatches){
            placeholderCount += singleDollarMatches.length;
        }

        const providedCount = args ? args.length : 0;
        if(placeholderCount !== providedCount){
            const msg = `Query argument error in ${methodName}: expected ${placeholderCount} value(s) for parameter placeholders, but received ${providedCount}. Use $$ or $ for parameters.`;
            console.error(msg);
            throw new Error(msg);
        }

        // Get database type from context
        const dbType = this.__context.isSQLite ? 'sqlite' :
                      this.__context.isMySQL ? 'mysql' :
                      this.__context.isPostgres ? 'postgres' : 'sqlite';

        // Replace $$ with ? placeholders and collect parameter values
        if(args){
            for(let argument in args){
                var item = args[argument];
                if(typeof item === 'undefined'){
                    const msg = `Query argument error in ${methodName}: placeholder value at index ${argument} is undefined.`;
                    console.error(msg);
                    throw new Error(msg);
                }

                // Check if this is an array (for IN clauses / .includes() / .any())
                let itemArray = null;
                if(Array.isArray(item)){
                    itemArray = item;
                }
                // Also handle comma-separated strings for .any() method
                else if(typeof item === 'string' && item.includes(',')){
                    // Split comma-separated string into array
                    itemArray = item.split(',').map(v => v.trim());
                }

                if(itemArray){
                    // Validate each array element
                    try {
                        for(const val of itemArray){
                            this.__queryObject.parameters.validateValue(val);
                        }
                    } catch(err) {
                        const msg = `Query argument error in ${methodName}: ${err.message}`;
                        console.error(msg);
                        throw new Error(msg);
                    }

                    // Add array parameters and get comma-separated placeholders
                    const placeholders = this.__queryObject.parameters.addParams(itemArray, dbType);
                    // Replace $$ first (preferred), then $ (backwards compatibility)
                    if(str.includes('$$')){
                        str = str.replace("$$", placeholders);
                    } else {
                        // Replace single $ but not $N (postgres placeholders)
                        str = str.replace(/\$(?!\d)/, placeholders);
                    }
                }
                else{
                    // Single value - existing logic
                    // Validate parameter value is safe
                    try {
                        this.__queryObject.parameters.validateValue(item);
                    } catch(err) {
                        const msg = `Query argument error in ${methodName}: ${err.message}`;
                        console.error(msg);
                        throw new Error(msg);
                    }

                    // Add parameter and replace placeholder
                    const placeholder = this.__queryObject.parameters.addParam(item, dbType);
                    // Replace $$ first (preferred), then $ (backwards compatibility)
                    if(str.includes('$$')){
                        str = str.replace("$$", placeholder);
                    } else {
                        // Replace single $ but not $N (postgres placeholders)
                        str = str.replace(/\$(?!\d)/, placeholder);
                    }
                }
            }
        }
        return str;
    }

    // Convenience method: Find record by primary key ID
    async findById(id){
        // Find the primary key field in the entity
        let primaryKeyField = null;
        for (const fieldName in this.__entity) {
            const field = this.__entity[fieldName];
            if (field && field.primary === true) {
                primaryKeyField = fieldName;
                break;
            }
        }

        if (!primaryKeyField) {
            throw new Error(`findById error: No primary key defined on entity '${this.__entity.__name}'`);
        }

        // Build where clause: entity.primaryKey == id
        const entityParam = 'r'; // Standard parameter name
        const whereClause = `${entityParam} => ${entityParam}.${primaryKeyField} == $$`;

        // Chain where() and single()
        return await this.where(whereClause, id).single();
    }

    async single(){
        // If no clauses were used before single(), seed defaults so SQL is valid
        if(this.__queryObject.script.entityMap.length === 0){
            this.__queryObject.skipClause(this.__entity.__name);
            this.__queryObject.script.take = 1;
        }

        // Generate cache key
        const tableName = this.__entity.__name;
        const queryString = JSON.stringify(this.__queryObject.script);
        const params = this.__queryObject.script.parameters ? this.__queryObject.script.parameters.getParams() : [];
        const cacheKey = this.__context._queryCache.generateKey(queryString, params, tableName);

        // Check cache first (if enabled for this query)
        if (this.__useCache) {
            const cached = this.__context._queryCache.get(cacheKey);
            if (cached) {
                this.__reset();
                return cached;
            }
        }

        // Cache miss - execute query
        var result = null;
        if(this.__context.isSQLite){
            var entityValue = await this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            result = this.__singleEntityBuilder(entityValue);
        }

        if(this.__context.isMySQL){
            var entityValue = await this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            result = this.__singleEntityBuilder(entityValue[0]);
        }

        // Store in cache
        if (this.__useCache && result) {
            this.__context._queryCache.set(cacheKey, result, tableName);
        }

        this.__reset();
        return result;
    }

    async toList(){
        if(this.__queryObject.script.entityMap.length === 0){
            this.__queryObject.skipClause( this.__entity.__name);
            if(!this.__queryObject.script.take || this.__queryObject.script.take === 0){
                this.__queryObject.script.take = 1000;
            }
        }

        // Generate cache key
        const tableName = this.__entity.__name;
        const queryString = JSON.stringify(this.__queryObject.script);
        const params = this.__queryObject.script.parameters ? this.__queryObject.script.parameters.getParams() : [];
        const cacheKey = this.__context._queryCache.generateKey(queryString, params, tableName);

        // Check cache first (if enabled for this query)
        if (this.__useCache) {
            const cached = this.__context._queryCache.get(cacheKey);
            if (cached) {
                this.__reset();
                return cached;
            }
        }

        // Cache miss - execute query
        var result = [];
        if(this.__context.isSQLite){
            var entityValue = await this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            result = this.__multipleEntityBuilder(entityValue);
        }

        if(this.__context.isMySQL){
            var entityValue = await this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            result = this.__multipleEntityBuilder(entityValue);
        }

        // Store in cache
        if (this.__useCache && result) {
            this.__context._queryCache.set(cacheKey, result, tableName);
        }

        this.__reset();
        return result;
    }

      // ------------------------------- FUNCTIONS THAT UPDATE SQL START FROM HERE  -----------------------------------------------------
    // ---------------------------------------------------------------------------------------------------------------------------------------

    // Creates a new empty entity instance ready for insertion
    // Returns an object with property setters that track changes
    new(){
        var newEntity = {
            __ID : Math.floor((Math.random() * 100000) + 1),
            __dirtyFields : [],
            __state : "insert",
            __entity : this.__entity,
            __context : this.__context,
            __name : this.__entity.__name,
            __proto__ : {}
        };

        // Set up property setters for all entity fields
        var $that = this;
        for (var fieldName in this.__entity) {
            if(!fieldName.startsWith("__")){
                var field = this.__entity[fieldName];
                // Skip navigational properties (relationships)
                if(!field.isNavigational && field.type !== "hasMany" && field.type !== "hasOne" && field.type !== "hasManyThrough"){
                    (function(fname, fieldDef){
                        Object.defineProperty(newEntity, fname, {
                            enumerable: true,
                            configurable: true,
                            set: function(value) {
                                this.__proto__["_" + fname] = value;
                                if(!this.__dirtyFields.includes(fname)){
                                    this.__dirtyFields.push(fname);
                                }
                            },
                            get: function(){
                                // Apply get function if defined
                                if(fieldDef && typeof fieldDef.get === "function"){
                                    return fieldDef.get(this.__proto__["_" + fname]);
                                }
                                return this.__proto__["_" + fname];
                            }
                        });
                    })(fieldName, field);
                }
            }
        }

        // Add Active Record-style .save() method
        newEntity.save = async function() {
            if (!this.__context) {
                throw new Error('Cannot save: entity is not attached to a context');
            }

            // Ensure entity is tracked
            if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
                this.__context.__track(this);
            }

            // Save all tracked changes in the context
            return await this.__context.saveChanges();
        };

        // Track the entity
        this.__context.__track(newEntity);
        return newEntity;
    }

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
        this.__context.__track(entityValue);
    }

    removeRange(entityValues){
        for (const property in entityValues) {
            var entityValue = entityValues[property];
            entityValue.__state = "delete";
            entityValue.__entity = this.__entity;
            entityValue.__context = this.__context;
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

