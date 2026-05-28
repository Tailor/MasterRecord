
// version 0.0.16
import entityTrackerModel from '../Entity/entityTrackerModel.js';
import tools from '../Tools.js';
import queryScript from './queryScript.js';

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

    /**
     * Full-text search across one or more columns.
     *
     * The schema must already have a full-text index created in a migration
     * via `schema.createFullTextIndex({ tableName, columns })`. The runtime
     * search uses FTS5 MATCH on SQLite, tsvector @@ on Postgres, and
     * MATCH AGAINST on MySQL. Each row gets a `__rank` field for ordering.
     *
     * Composes with .where(), .take(), .skip(), .orderBy(). If no .orderBy()
     * is chained, results come back ordered by rank descending.
     *
     * @param {object|string} opts - Either { in: [columns], query: 'terms' }
     *   or a bare string (which searches every column declared in the
     *   nearest createFullTextIndex — caller is responsible for matching).
     * @param {string[]} [opts.in] - Columns to search. Required.
     * @param {string} [opts.query] - Search terms.
     *
     * @example
     * await ctx.MemoryDoc
     *     .search({ in: ['title', 'body'], query: 'auth login' })
     *     .where(d => d.workspace_id == ctx.$$, wid)
     *     .take(10)
     *     .toList();
     */
    search(opts){
        let columns, query;
        if (typeof opts === 'string') {
            // Bare string form requires the caller to declare columns elsewhere;
            // we currently require explicit `in:` to keep the API honest.
            throw new Error('search() requires { in: [columns], query: \'terms\' }. Bare-string form is reserved for a future declarative API.');
        } else if (opts && typeof opts === 'object') {
            columns = opts.in;
            query = opts.query;
        }
        if (!Array.isArray(columns) || columns.length === 0) {
            throw new Error('search() requires `in: [columns]` to be a non-empty array');
        }
        if (typeof query !== 'string' || query.length === 0) {
            throw new Error('search() requires `query` to be a non-empty string');
        }

        // Stash the config on the script; engine buildQuery turns this into
        // the right FTS predicate at SQL-generation time.
        this.__queryObject.script.search = { columns: columns.slice(), query };
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

        // Bootstrap the entityMap if no prior clause was chained. Without
        // this, a plain `.count()` produced empty FROM/alias on SQLite and
        // silently returned 1 (the row count of a no-FROM SELECT). `.single()`
        // and `.toList()` already do this bootstrap — count() was the gap.
        if(this.__queryObject.script.entityMap.length === 0){
            this.__queryObject.skipClause(this.__entity.__name);
        }

        await this.__context._ensureReady();

        if(this.__context.isSQLite){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        else if(this.__context.isMySQL){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        else if(this.__context.isPostgres){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context);
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        else {
            this.__reset();
            throw new Error('No database type configured. Ensure context.env() or context.useMySql()/useSqlite() has been called and awaited.');
        }
    }

    /**
     * Get first record ordered by primary key
     */
    async first() {
        // Find primary key
        let primaryKey = null;
        for (const fieldName in this.__entity) {
            if (this.__entity[fieldName]?.primary === true) {
                primaryKey = fieldName;
                break;
            }
        }

        if (primaryKey && !this.__queryObject.script.orderBy) {
            // Use proper orderBy syntax with lambda expression
            const orderByExpr = `e => e.${primaryKey}`;
            this.orderBy(orderByExpr);
        }

        this.__queryObject.script.take = 1;
        return await this.single();
    }

    /**
     * Get last record ordered by primary key descending
     */
    async last() {
        let primaryKey = null;
        for (const fieldName in this.__entity) {
            if (this.__entity[fieldName]?.primary === true) {
                primaryKey = fieldName;
                break;
            }
        }

        if (primaryKey && !this.__queryObject.script.orderBy) {
            // Use proper orderByDescending syntax with lambda expression
            const orderByExpr = `e => e.${primaryKey}`;
            this.orderByDescending(orderByExpr);
        }

        this.__queryObject.script.take = 1;
        return await this.single();
    }

    /**
     * Check if any records match the query
     */
    async exists() {
        this.__queryObject.script.take = 1;
        const result = await this.single();
        return result !== null;
    }

    /**
     * Extract single column values as array
     */
    async pluck(fieldName) {
        if (!fieldName || typeof fieldName !== 'string') {
            throw new Error('pluck() requires a field name string');
        }

        if (!this.__entity[fieldName]) {
            throw new Error(`Field '${fieldName}' does not exist on ${this.__entity.__name}`);
        }

        const entities = await this.toList();
        return entities.map(entity => entity[fieldName]);
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
        // Normalize `<ident>.$$` (e.g. `ctx.$$`, `this.$$`) to bare `$$` so
        // TypeScript/ESLint-clean lambdas like `(u) => u.id == ctx.$$` work
        // identically to `'u => u.id == $$'`. The lambda is never evaluated
        // at runtime — only stringified — so the property path doesn't matter.
        // Note: `$$$$` in a String.prototype.replace replacement string means
        // a literal `$$` (each `$$` escapes to a single `$`).
        str = str.replace(/[A-Za-z_$][\w$]*\.\$\$/g, '$$$$');

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
                      this.__context.isPostgres ? 'postgres' : 'unknown';

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
                    // Replace ONLY FIRST $$ occurrence (not all with /g flag)
                    // This ensures each parameter gets replaced in order
                    if(str.includes('$$')){
                        str = str.replace(/\$\$/, placeholders);  // ✅ No 'g' flag - replace first only
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
                    // Replace ONLY FIRST $$ occurrence (not all with /g flag)
                    // This ensures each parameter gets replaced in order
                    if(str.includes('$$')){
                        str = str.replace(/\$\$/, placeholder);  // ✅ No 'g' flag - replace first only
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
                // Cached entities already have methods - return directly
                return cached;
            }
        }

        // Cache miss - execute query
        await this.__context._ensureReady();
        var result = null;
        if(this.__context.isSQLite){
            var entityValue = await this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            result = this.__singleEntityBuilder(entityValue);
        }
        else if(this.__context.isMySQL){
            var entityValue = await this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            result = this.__singleEntityBuilder(entityValue);
        }
        else if(this.__context.isPostgres){
            var entityValue = await this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context);
            result = this.__singleEntityBuilder(entityValue);
        }
        else {
            this.__reset();
            throw new Error('No database type configured. Ensure context.env() or context.useMySql()/useSqlite() has been called and awaited.');
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
                // Cached entities already have methods - return array directly
                return cached;
            }
        }

        // Cache miss - execute query
        await this.__context._ensureReady();
        var result = [];
        if(this.__context.isSQLite){
            var entityValue = await this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            result = this.__multipleEntityBuilder(entityValue);
        }
        else if(this.__context.isMySQL){
            var entityValue = await this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            result = this.__multipleEntityBuilder(entityValue);
        }
        else if(this.__context.isPostgres){
            var entityValue = await this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context);
            result = this.__multipleEntityBuilder(entityValue);
        }
        else {
            this.__reset();
            throw new Error('No database type configured. Ensure context.env() or context.useMySql()/useSqlite() has been called and awaited.');
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
                                // Run validators before setting value
                                if (fieldDef && fieldDef.validators && Array.isArray(fieldDef.validators)) {
                                    for (const validator of fieldDef.validators) {
                                        let isValid = true;
                                        let errorMsg = validator.message;

                                        switch (validator.type) {
                                            case 'required':
                                                isValid = value !== null && value !== undefined && value !== '';
                                                break;

                                            case 'email':
                                                if (value) {
                                                    isValid = validator.pattern.test(value);
                                                }
                                                break;

                                            case 'minLength':
                                                if (value && typeof value === 'string') {
                                                    isValid = value.length >= validator.length;
                                                }
                                                break;

                                            case 'maxLength':
                                                if (value && typeof value === 'string') {
                                                    isValid = value.length <= validator.length;
                                                }
                                                break;

                                            case 'pattern':
                                                if (value) {
                                                    isValid = validator.pattern.test(value);
                                                }
                                                break;

                                            case 'min':
                                                if (value !== null && value !== undefined) {
                                                    isValid = Number(value) >= validator.min;
                                                }
                                                break;

                                            case 'max':
                                                if (value !== null && value !== undefined) {
                                                    isValid = Number(value) <= validator.max;
                                                }
                                                break;

                                            case 'custom':
                                                if (typeof validator.validator === 'function') {
                                                    isValid = validator.validator(value);
                                                }
                                                break;
                                        }

                                        if (!isValid) {
                                            throw new Error(`Validation failed: ${errorMsg}`);
                                        }
                                    }
                                }

                                // Apply fieldDef.set transform if the entity defines one — the
                                // tracker-entity setter (entityTrackerModel.build) already does
                                // this on UPDATE; we need the same behavior on INSERT so values
                                // normalize consistently regardless of which path created them.
                                if (fieldDef && typeof fieldDef.set === 'function') {
                                    this.__proto__["_" + fname] = fieldDef.set(value);
                                } else {
                                    this.__proto__["_" + fname] = value;
                                }
                                if(!this.__dirtyFields.includes(fname)){
                                    this.__dirtyFields.push(fname);
                                }
                                // After INSERT (state transitions to "track"), behave like
                                // query-loaded entities: mark modified and re-register with tracker
                                if (this.__state === 'track') {
                                    this.__state = 'modified';
                                }
                                if (this.__context && typeof this.__context.__track === 'function') {
                                    this.__context.__track(this);
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

                        // belongsTo declares a navigation property (e.g. `Run`)
                        // and an implicit foreign-key column (e.g. `run_id`).
                        // The loop above installs a setter for `Run`. Also
                        // install one on the FK column name so user code can
                        // do `step.run_id = 'xyz'` instead of being forced
                        // into `step.Run = 'xyz'`.
                        //
                        // Both paths must produce identical state: push the
                        // *navigation* name to `__dirtyFields` and store the
                        // value at `_<navName>`. The engine INSERT/UPDATE
                        // builders detect belongsTo by looking up that name
                        // in `__entity`; if we pushed the FK column name
                        // instead, the builder would crash on
                        // `__entity['run_id']` (no such key) when computing
                        // the SQL column type.
                        if (fieldDef && fieldDef.relationshipType === 'belongsTo' && fieldDef.foreignKey) {
                            const fkName = fieldDef.foreignKey;
                            const navName = fname;
                            // Don't clobber an explicit column declaration:
                            // some entities declare `run_id(db) { db.string() }`
                            // alongside `Run(db) { db.belongsTo('Run') }`. If
                            // that's the case, the explicit setter has already
                            // been installed by this loop on its own iteration.
                            if (!Object.prototype.hasOwnProperty.call(newEntity, fkName)) {
                                Object.defineProperty(newEntity, fkName, {
                                    enumerable: true,
                                    configurable: true,
                                    set: function(value) {
                                        this.__proto__["_" + navName] = value;
                                        if (!this.__dirtyFields.includes(navName)) {
                                            this.__dirtyFields.push(navName);
                                        }
                                        if (this.__state === 'track') {
                                            this.__state = 'modified';
                                        }
                                        if (this.__context && typeof this.__context.__track === 'function') {
                                            this.__context.__track(this);
                                        }
                                    },
                                    get: function() {
                                        // Prefer the nav-property backing
                                        // (most recently assigned). Fall back
                                        // to the FK-column backing populated
                                        // by DB hydration in
                                        // entityTrackerModel.build().
                                        const navVal = this.__proto__["_" + navName];
                                        return navVal !== undefined
                                            ? navVal
                                            : this.__proto__["_" + fkName];
                                    }
                                });
                            }
                        }
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

        // Convert entity to plain JavaScript object
        newEntity.toObject = function(options = {}) {
            const includeRelationships = options.includeRelationships !== false;
            const depth = options.depth || 1;
            const visited = options._visited || new WeakSet();

            // Prevent circular reference infinite loops
            if (visited.has(this)) {
                return { __circular: true, __entityName: this.__name, id: this[this.__primaryKey] };
            }
            visited.add(this);

            const plain = {};

            // Iterate through entity definition
            for (const fieldName in this.__entity) {
                if (fieldName.startsWith('__')) continue;

                const fieldDef = this.__entity[fieldName];
                const isRelationship = fieldDef?.type === 'hasMany' ||
                                       fieldDef?.type === 'hasOne' ||
                                       fieldDef?.relationshipType === 'belongsTo';

                // Skip relationships in this pass
                if (!isRelationship) {
                    try {
                        plain[fieldName] = this[fieldName];
                    } catch (e) {
                        // Skip fields that throw errors when accessed
                    }
                }
            }

            // Handle relationships recursively with depth limit and cycle detection
            if (includeRelationships && depth > 0) {
                for (const fieldName in this.__entity) {
                    const fieldDef = this.__entity[fieldName];
                    const isRelationship = fieldDef?.type === 'hasMany' ||
                                           fieldDef?.type === 'hasOne' ||
                                           fieldDef?.relationshipType === 'belongsTo';

                    if (isRelationship) {
                        try {
                            const value = this[fieldName];

                            if (Array.isArray(value)) {
                                plain[fieldName] = value.map(item => {
                                    if (item?.toObject && typeof item.toObject === 'function') {
                                        return item.toObject({
                                            depth: depth - 1,
                                            _visited: visited
                                        });
                                    }
                                    return item;
                                });
                            } else if (value?.toObject && typeof value.toObject === 'function') {
                                plain[fieldName] = value.toObject({
                                    depth: depth - 1,
                                    _visited: visited
                                });
                            }
                        } catch (e) {
                            // Skip relationships that throw errors when accessed
                        }
                    }
                }
            }

            return plain;
        };

        // JSON.stringify compatibility
        newEntity.toJSON = function() {
            return this.toObject({ includeRelationships: false });
        };

        // Delete entity from database
        newEntity.delete = async function() {
            if (!this.__context) {
                throw new Error('Cannot delete: entity is not attached to a context');
            }

            // Mark entity for deletion
            this.__state = 'delete';

            // Ensure entity is tracked
            if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
                this.__context.__track(this);
            }

            // Execute delete via saveChanges
            return await this.__context.saveChanges();
        };

        // Reload entity from database
        newEntity.reload = async function() {
            if (!this.__context) {
                throw new Error('Cannot reload: entity is not attached to a context');
            }

            // Get primary key
            let primaryKey = null;
            for (const fieldName in this.__entity) {
                if (this.__entity[fieldName]?.primary === true) {
                    primaryKey = fieldName;
                    break;
                }
            }

            const primaryKeyValue = this[primaryKey];

            if (!primaryKeyValue) {
                throw new Error('Cannot reload: entity has no primary key value');
            }

            // Fetch fresh from database
            const EntityClass = this.__context[this.__name];
            const fresh = await EntityClass.findById(primaryKeyValue);
            if (!fresh) {
                throw new Error(
                    `Cannot reload: ${this.__name} with ${primaryKey}=${primaryKeyValue} not found`
                );
            }

            // Copy all field values from fresh entity to this entity
            for (const fieldName in this.__entity) {
                if (fieldName.startsWith('__')) continue;

                const fieldDef = this.__entity[fieldName];
                const isRelationship = fieldDef?.type === 'hasMany' ||
                                       fieldDef?.type === 'hasOne' ||
                                       fieldDef?.relationshipType === 'belongsTo';

                // Only reload scalar fields
                if (!isRelationship) {
                    this.__proto__["_" + fieldName] = fresh.__proto__["_" + fieldName];
                }
            }

            // Reset dirty fields and state
            this.__dirtyFields = [];
            this.__state = 'track';

            return this;
        };

        // Clone entity for duplication
        newEntity.clone = function() {
            if (!this.__context) {
                throw new Error('Cannot clone: entity is not attached to a context');
            }

            const EntityClass = this.__context[this.__name];
            const cloned = EntityClass.new();

            // Get primary key (to skip it)
            let primaryKey = null;
            for (const fieldName in this.__entity) {
                if (this.__entity[fieldName]?.primary === true) {
                    primaryKey = fieldName;
                    break;
                }
            }

            // Copy all non-primary key fields
            for (const fieldName in this.__entity) {
                if (fieldName.startsWith('__')) continue;
                if (fieldName === primaryKey) continue;

                const fieldDef = this.__entity[fieldName];
                const isRelationship = fieldDef?.type === 'hasMany' ||
                                       fieldDef?.type === 'hasOne' ||
                                       fieldDef?.relationshipType === 'belongsTo';

                if (!isRelationship) {
                    cloned[fieldName] = this[fieldName];
                }
            }

            return cloned;
        };

        // Track the entity
        this.__context.__track(newEntity);

        // Copy lifecycle hooks from entity definition to entity instance
        for (const fieldName in this.__entity) {
            const fieldDef = this.__entity[fieldName];
            if (fieldDef && fieldDef.lifecycle === true && fieldDef.method) {
                // Bind the lifecycle hook method directly to this entity instance
                newEntity[fieldName] = fieldDef.method.bind(newEntity);
            }
        }

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

export default queryMethods;

