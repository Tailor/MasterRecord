
// version 0.0.16
import entityTrackerModel from '../Entity/entityTrackerModel.js';
import tools from '../Tools.js';
import queryScript from './queryScript.js';
import FieldTransformer from '../Entity/fieldTransformer.js';

// Security: `.take()`/`.skip()` values are interpolated directly into
// LIMIT/OFFSET (these clauses cannot be parameterized on SQLite/MySQL/Postgres).
// Pagination values are the single most common place an application forwards
// raw user input (e.g. `?page=`, `?limit=`), so a non-numeric value here is a
// direct SQL-injection vector. Coerce to a safe, non-negative integer and throw
// loudly on anything else rather than letting it reach the SQL string.
function validateRowCount(value, method){
    if(value === null || value === undefined){
        return 0; // treated as "not set"
    }
    const n = typeof value === 'number' ? value : Number(value);
    if(!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)){
        throw new Error(`.${method}() requires a non-negative integer, received: ${JSON.stringify(value)}`);
    }
    return n;
}

class queryMethods{

    constructor(entity, context) {
        this.__entity = entity;
        this.__context = context;
        this.__queryObject = new queryScript();
        this.__useCache = false;  // Disable caching by default (opt-in with .cache())
        // Tracking follows the context's default (EF's QueryTrackingBehavior);
        // override per query with .asNoTracking() / .asTracking().
        this.__noTracking = (context && context.__queryTrackingBehavior === 'no-track');
        // Global query filters: applied once per execution unless ignored.
        this.__ignoredFilters = null;   // null = apply all; true = ignore all; Set = ignore these names
        this.__filtersApplied = false;
    }

    /**
     * Skip this entity's global query filters for this query (EF Core
     * IgnoreQueryFilters). With no argument ALL filters are ignored; pass an
     * array of names to ignore only those (EF 10 named filters).
     * @example db.Blog.ignoreQueryFilters().toList();              // include soft-deleted rows
     * @example db.Blog.ignoreQueryFilters(['softDelete']).toList(); // keep the tenant filter
     */
    ignoreQueryFilters(names){
        if (names === undefined || names === null || names === true) { this.__ignoredFilters = true; return this; }
        const list = Array.isArray(names) ? names : [names];
        this.__ignoredFilters = new Set(list.map(String));
        return this;
    }

    /** Append the entity's active global query filters to the WHERE (once). */
    __applyQueryFilters(){
        if (this.__filtersApplied || this.__ignoredFilters === true) return;
        this.__filtersApplied = true;
        const ctx = this.__context;
        if (!ctx || typeof ctx._queryFiltersFor !== 'function') return;
        const filters = ctx._queryFiltersFor(this.__entity.__name);
        for (const f of filters) {
            if (this.__ignoredFilters instanceof Set && this.__ignoredFilters.has(f.name)) continue;
            // Function args are resolved at query time with the context
            // (e.g. the current tenant id held on the context instance).
            const args = (f.args || []).map(a => (typeof a === 'function' ? a(ctx) : a));
            const hasWhere = !!(this.__queryObject.script && this.__queryObject.script.where);
            if (hasWhere) this.and(f.expr, ...args);
            else this.where(f.expr, ...args);
        }
    }

    /**
     * Read-only query: do NOT enter results into the change tracker (like EF
     * Core's AsNoTracking). Nothing is retained, so a read-heavy endpoint that
     * `.toList()`s a large table no longer grows the tracked set. Mutations on
     * the returned entities are not persisted (they are detached), matching EF.
     *
     * @example db.Users.asNoTracking().toList();
     */
    asNoTracking(){
        this.__noTracking = true;
        return this;
    }

    /**
     * Track this query's results even when the context defaults to no-tracking
     * (EF Core's AsTracking). Use it on the queries whose entities you intend to
     * modify and save, after setting the context to `setQueryTrackingBehavior('no-track')`.
     *
     * @example db.Users.asTracking().where(...).single();  // then edit + saveChanges()
     */
    asTracking(){
        this.__noTracking = false;
        return this;
    }

    // ---- EF Core query ergonomics: Find, Any, aggregates, ThenBy, Distinct ----

    /**
     * Find by primary key, checking the context's identity map FIRST (EF Core
     * Find/FindAsync): a tracked instance is returned without a query; otherwise
     * the row is loaded (and tracked). Returns null if not found.
     */
    async find(id){
        const pk = tools.getPrimaryKeyObject(this.__entity);
        if (!pk) throw new Error(`masterrecord: find() — no primary key defined on entity '${this.__entity.__name}'`);
        const ctx = this.__context;
        const table = this.__entity.__name;
        for (const e of ctx.__trackedEntitiesMap.values()) {
            if (e && e.__entity && e.__entity.__name === table && e.__state !== 'delete' && String(e[pk]) === String(id)) {
                this.__reset();
                return e;
            }
        }
        return this.findById(id);
    }

    /**
     * EF Any(): true if at least one row matches (optionally with a predicate).
     * `any('u => u.email == $$', email)` ≡ `where(...).exists()`.
     */
    async any(predicate, ...args){
        if (predicate !== undefined && predicate !== null) this.where(predicate, ...args);
        return this.exists();
    }

    /** EF Sum(): 0 for no rows. */
    async sum(field){ return this.__aggregate('SUM', field, 0); }
    /** EF Average(): null for no rows. */
    async avg(field){ return this.__aggregate('AVG', field, null); }
    /** EF Min(): null for no rows. */
    async min(field){ return this.__aggregate('MIN', field, null); }
    /** EF Max(): null for no rows. */
    async max(field){ return this.__aggregate('MAX', field, null); }

    async __aggregate(fn, field, emptyValue){
        if (!field || typeof field !== 'string') throw new TypeError(`masterrecord: ${fn.toLowerCase()}(field) requires a column name.`);
        const def = this.__entity[field];
        if (!def || typeof def !== 'object' || def.type === 'hasOne' || def.type === 'hasMany' || def.type === 'hasManyThrough') {
            throw new Error(`masterrecord: ${fn.toLowerCase()}('${field}') — '${field}' is not a column of ${this.__entity.__name}.`);
        }
        const column = (def.relationshipType === 'belongsTo' && def.foreignKey) ? def.foreignKey : (def.name || field);
        this.__applyQueryFilters();
        if (this.__queryObject.script.entityMap.length === 0) this.__queryObject.skipClause(this.__entity.__name);
        const ctx = this.__context;
        await ctx._ensureReady();
        try {
            const v = await ctx._execWithRetry(() => ctx._SQLEngine.getAggregate(this.__queryObject, this.__entity, fn, column));
            if (v === null || v === undefined) return emptyValue;
            const n = Number(v);
            return Number.isNaN(n) ? v : n;
        } finally {
            this.__reset();
        }
    }

    /** EF Distinct(): SELECT DISTINCT over the projected columns. */
    distinct(){
        this.__queryObject.script.distinct = true;
        return this;
    }

    /**
     * EF ThenBy / ThenByDescending: secondary sort keys after orderBy().
     * Accepts a lambda (`'u => u.name'`) or a bare column name.
     */
    thenBy(fieldOrLambda){ return this.__thenBy(fieldOrLambda, 'ASC'); }
    thenByDescending(fieldOrLambda){ return this.__thenBy(fieldOrLambda, 'DESC'); }
    __thenBy(fieldOrLambda, dir){
        const text = String(typeof fieldOrLambda === 'function' ? fieldOrLambda.toString() : fieldOrLambda).trim();
        const m = text.match(/=>\s*\w+\.(\w+)\s*;?\s*$/) || (/^\w+$/.test(text) ? [null, text] : null);
        if (!m) throw new TypeError(`masterrecord: thenBy expects a column lambda like 'u => u.name' or a column name, got ${JSON.stringify(fieldOrLambda)}`);
        const field = m[1];
        if (!this.__entity[field] || typeof this.__entity[field] !== 'object') {
            throw new Error(`masterrecord: thenBy — '${field}' is not a column of ${this.__entity.__name}.`);
        }
        const s = this.__queryObject.script;
        (s.thenBy ||= []).push({ field, dir });
        return this;
    }

    /**
     * Materialize rows as plain objects (DTO-style projection). Results are
     * not tracked. `options` are passed to entity.toObject().
     */
    async toObjectList(options){
        const rows = await this.asNoTracking().toList();
        return rows.map(r => (typeof r.toObject === 'function' ? r.toObject(options) : r));
    }

    // ---- Set-based writes (EF Core ExecuteUpdate / ExecuteDelete) ----------
    // One SQL statement over the rows the query selects. They bypass the
    // change tracker entirely (tracked instances are NOT refreshed — don't mix
    // them with pending tracked edits to the same rows), execute immediately,
    // and return the number of rows affected. Inside ctx.transaction() they
    // join the open transaction; otherwise each is its own autocommit statement.

    /**
     * UPDATE every row the query selects.
     * @param {Object} setters - { column: value } — values are parameterized
     *   (and run through the column's transformer); use `sql\`col + 1\`` (from
     *   `masterrecord.sql` / 'masterrecord/sql') to reference existing values
     *   (EF's SetProperty(b => b.X, b => b.X + 1)).
     * @returns {Promise<number>} rows affected
     * @example await db.Blog.where('b => b.rating < $$', 3).executeUpdate({ hidden: true, views: sql`views + 1` });
     */
    async executeUpdate(setters){
        if (!setters || typeof setters !== 'object' || Array.isArray(setters) || Object.keys(setters).length === 0) {
            throw new TypeError('masterrecord: executeUpdate(setters) expects a non-empty object of { column: value | sql`...` }.');
        }
        this.__guardExecuteQuery('executeUpdate');
        const def = this.__entity;
        const list = [];
        for (const [col, val] of Object.entries(setters)) {
            const f = def[col];
            if (!f || typeof f !== 'object' || f.type === 'hasOne' || f.type === 'hasMany' || f.type === 'hasManyThrough') {
                throw new Error(`masterrecord: executeUpdate — '${col}' is not a column of ${def.__name}.`);
            }
            if (f.primary) throw new Error(`masterrecord: executeUpdate — cannot update the primary key '${col}'.`);
            const column = (f.relationshipType === 'belongsTo' && f.foreignKey) ? f.foreignKey : (f.name || col);
            if (val && typeof val === 'object' && typeof val.__rawSql === 'string') {
                list.push({ column, raw: val.__rawSql });
            } else {
                let v = val;
                if (FieldTransformer.hasTransformer(f)) v = FieldTransformer.toDatabase(v, f, def.__name, col);
                if (typeof v === 'boolean' && !this.__context.isPostgres) v = v ? 1 : 0;
                list.push({ column, value: v });
            }
        }
        return this.__runExecute(eng => eng.executeUpdate(this.__queryObject.script, this.__entity, list));
    }

    /**
     * DELETE every row the query selects (one statement, no loading, no tracker).
     * @returns {Promise<number>} rows affected
     * @example await db.Session.where('s => s.expiresAt < $$', now).executeDelete();
     */
    async executeDelete(){
        this.__guardExecuteQuery('executeDelete');
        return this.__runExecute(eng => eng.executeDelete(this.__queryObject.script, this.__entity));
    }

    __guardExecuteQuery(name){
        const s = this.__queryObject.script;
        if (s.raw) throw new Error(`masterrecord: ${name}() cannot be combined with raw().`);
        if (s.include && s.include.length) throw new Error(`masterrecord: ${name}() does not support include() — filter on the table's own columns.`);
        // Global query filters apply to set-based writes too (EF applies them to
        // ExecuteUpdate/ExecuteDelete): a soft-delete filter keeps deleted rows
        // out of a bulk update; a tenant filter scopes a bulk delete.
        this.__applyQueryFilters();
        // Bootstrap the alias/entityMap when no clause was chained (same as count()).
        if (s.entityMap.length === 0) this.__queryObject.skipClause(this.__entity.__name);
    }

    async __runExecute(fn){
        const ctx = this.__context;
        await ctx._ensureReady();
        const run = async () => {
            const affected = await fn(ctx._SQLEngine);
            ctx._queryCache.invalidateTable(this.__entity.__name);
            return affected;
        };
        try {
            // Inside a user transaction this context already holds the engine
            // lock; otherwise serialize with other units of work on the shared
            // connection.
            return (ctx.__engineLockDepth > 0) ? await run() : await ctx._withEngineLock(() => ctx._execWithRetry(run));
        } finally {
            this.__reset();
        }
    }

    // build a single entity
    __singleEntityBuilder(dataModel){
        const $that = this;
        if(dataModel){
            const ent = new entityTrackerModel();
            const mod = ent.build(dataModel, $that.__entity, $that.__context);
            mod.__state = "track";
            if ($that.__noTracking) {
                // AsNoTracking: flag it so a later mutation won't enqueue a write
                // (__markDirty ignores no-tracking entities) and never track it.
                mod.__noTracking = true;
            } else {
                $that.__context.__track(mod);
            }
            return mod;
        }else{
            return null;
        }
    }

    // build multiple entities
    __multipleEntityBuilder(entityValue){
        const $that = this;
        const listArray = [];
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
        this.__filtersApplied = false;
        this.__ignoredFilters = null;
    }


    // do join on two tables = inner join
    // These operators are not implemented yet. They used to be empty bodies
    // returning undefined, so chaining off them threw a bare TypeError far
    // from the call site. Fail loudly and explain the alternative instead.
    join(){
        throw new Error('masterrecord: join() is not supported yet. Use include() for eager-loaded relationships, or ctx.query()/ctx.execute() for a hand-written JOIN.');
    }

    groupBy(){
        throw new Error('masterrecord: groupBy() is not supported yet. Use count()/sum()/avg()/min()/max() with a where() for single-group aggregates, or ctx.query() for GROUP BY SQL.');
    }

    leftJoin(){
        throw new Error('masterrecord: leftJoin() is not supported yet. Use include() (compiles to a LEFT JOIN) or ctx.query() for a hand-written JOIN.');
    }

    ______orderByCount(query,  ...args){
        let str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderByCount');
        this.__queryObject.orderByCount(str, this.__entity.__name);
        return this;
    }

    ______orderByCountDescending(query,  ...args){
        let str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderByCountDescending');
        this.__queryObject.orderByCountDesc(str, this.__entity.__name);
        return this;
    }

    orderBy(query,  ...args){
        let str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'orderBy');
        this.__queryObject.orderBy(str, this.__entity.__name);
        return this;
    }

    orderByDescending(query,  ...args){
        let str = query.toString();
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
        let str = query.toString();
        // Transform .includes() syntax to .any() syntax
        const transformResult = this.__transformIncludes(str, args);
        str = transformResult.query;
        args = transformResult.args;
        str = this.__validateAndCollectParameters(str, args, 'and');
        this.__queryObject.and(str, this.__entity.__name);
        return this;
    }

    where(query,  ...args){
        let str = query.toString();
        // Transform .includes() syntax to .any() syntax
        const transformResult = this.__transformIncludes(str, args);
        str = transformResult.query;
        args = transformResult.args;
        str = this.__validateAndCollectParameters(str, args, 'where');
        this.__queryObject.where(str, this.__entity.__name);
        return this;
    }

    // when you dont want to use lazy loading and want it called at that moment
    //Eagerly loading
    include(query,  ...args){
        let str = query.toString();
        str = this.__validateAndCollectParameters(str, args, 'include');
        this.__queryObject.include(str, this.__entity.__name);
        return this;
    }

    // only takes a array of selected items
    select(query,  ...args){
        let str = query.toString();
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
        this.__queryObject.script.take = validateRowCount(number, 'take');
        return this;
    }

    skip(number){
        this.__queryObject.script.skip = validateRowCount(number, 'skip');
        return this;
    }

    
    // ------------------------------- FUNCTIONS THAT MAKE THE SQL CALL START FROM HERE ON -----------------------------------------------------
    // ---------------------------------------------------------------------------------------------------------------------------------------

    async count(query,  ...args){
        if(query){
            let str = query.toString();
            str = this.__validateAndCollectParameters(str, args, 'count');
            this.__queryObject.count(str, this.__entity.__name);
        }

        // Global query filters (soft delete / tenant) apply to counts too.
        this.__applyQueryFilters();

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
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context));
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        else if(this.__context.isMySQL){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context));
            var val = entityValue[Object.keys(entityValue)[0]];
            this.__reset();
            return val;
        }
        else if(this.__context.isPostgres){
            // trying to match string select and relace with select Count(*);
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.getCount(this.__queryObject, this.__entity, this.__context));
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

        // SQL projection (SELECT <field> only) with no tracking — pluck is a
        // read of one column, not a full-entity load.
        const rows = await this.asNoTracking().select(`r => r.${fieldName}`).toList();
        return rows.map(entity => entity[fieldName]);
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
            for(const argument in args){
                const item = args[argument];
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
        this.__applyQueryFilters();   // global query filters (soft delete / tenant)
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
            // `await` so an async cache (RedisQueryCache) works: without it a
            // Promise is always truthy and `.cache()` queries returned a
            // Promise-of-entity instead of the entity.
            const cached = await this.__context._queryCache.get(cacheKey);
            if (cached) {
                this.__reset();
                // Cached entities already have methods - return directly
                return cached;
            }
        }

        // Cache miss - execute query
        await this.__context._ensureReady();
        let result = null;
        if(this.__context.isSQLite){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context));
            result = this.__singleEntityBuilder(entityValue);
        }
        else if(this.__context.isMySQL){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context));
            result = this.__singleEntityBuilder(entityValue);
        }
        else if(this.__context.isPostgres){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.get(this.__queryObject.script, this.__entity, this.__context));
            result = this.__singleEntityBuilder(entityValue);
        }
        else {
            this.__reset();
            throw new Error('No database type configured. Ensure context.env() or context.useMySql()/useSqlite() has been called and awaited.');
        }

        // Store in cache — but never cache a "not found" (null) result. A
        // negative result is poisoned the instant any concurrent writer inserts
        // the matching row: a reader that filled the cache with the pre-commit
        // empty would keep serving it (the writer's invalidateTable ran before
        // this set, or on a different context instance's cache entirely). This
        // is the "claimed idempotency key reads back empty" bug — re-run the
        // cheap lookup against the database instead of trusting a cached miss.
        if (this.__useCache && result) {
            this.__context._queryCache.set(cacheKey, result, tableName);
        }

        this.__reset();
        return result;
    }

    async toList(){
        this.__applyQueryFilters();   // global query filters (soft delete / tenant)
        if(this.__queryObject.script.entityMap.length === 0){
            this.__queryObject.skipClause( this.__entity.__name);
        }

        // Generate cache key
        const tableName = this.__entity.__name;
        const queryString = JSON.stringify(this.__queryObject.script);
        const params = this.__queryObject.script.parameters ? this.__queryObject.script.parameters.getParams() : [];
        const cacheKey = this.__context._queryCache.generateKey(queryString, params, tableName);

        // Check cache first (if enabled for this query)
        if (this.__useCache) {
            // `await` so an async cache (RedisQueryCache) works: without it a
            // Promise is always truthy and `.cache()` queries returned a
            // Promise-of-entity instead of the entity.
            const cached = await this.__context._queryCache.get(cacheKey);
            if (cached) {
                this.__reset();
                // Cached entities already have methods - return array directly
                return cached;
            }
        }

        // Cache miss - execute query
        await this.__context._ensureReady();
        let result = [];
        if(this.__context.isSQLite){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context));
            result = this.__multipleEntityBuilder(entityValue);
        }
        else if(this.__context.isMySQL){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context));
            result = this.__multipleEntityBuilder(entityValue);
        }
        else if(this.__context.isPostgres){
            var entityValue = await this.__context._execWithRetry(() => this.__context._SQLEngine.all(this.__queryObject.script, this.__entity, this.__context));
            result = this.__multipleEntityBuilder(entityValue);
        }
        else {
            this.__reset();
            throw new Error('No database type configured. Ensure context.env() or context.useMySql()/useSqlite() has been called and awaited.');
        }

        // Store in cache — but NOT an empty result set. An empty array is
        // truthy, so the old `&& result` guard cached `[]`, which is negative
        // caching: the moment a concurrent writer inserts a matching row the
        // cached `[]` is stale, yet a reader that filled it just before the
        // writer's commit (or on a different context instance, whose cache the
        // writer's invalidateTable never touches) keeps serving empty. Skipping
        // empty sets means a "no rows yet" lookup always re-checks the database.
        if (this.__useCache && result && result.length > 0) {
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
        const newEntity = {
            __ID : null,   // assigned sequentially by context.__track (collision-free; a random id here could collide in the identity map)
            __dirtyFields : [],
            __state : "insert",
            __entity : this.__entity,
            __context : this.__context,
            __name : this.__entity.__name,
            __proto__ : {}
        };

        // Set up property setters for all entity fields
        for (const fieldName in this.__entity) {
            if(!fieldName.startsWith("__")){
                const field = this.__entity[fieldName];
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
                                        const errorMsg = validator.message;

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
                                if (this.__context && typeof this.__context.__markDirty === 'function') {
                                    this.__context.__markDirty(this);
                                } else if (this.__context && typeof this.__context.__track === 'function') {
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
                                        if (this.__context && typeof this.__context.__markDirty === 'function') {
                                            this.__context.__markDirty(this);
                                        } else if (this.__context && typeof this.__context.__track === 'function') {
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
                                        if (navVal && typeof navVal === 'object' && navVal.__entity) {
                                            // An assigned parent ENTITY: the FK column reads its key.
                                            const def = navVal.__entity;
                                            const pk = Object.keys(def).find(k => def[k] && typeof def[k] === 'object' && def[k].primary === true);
                                            return pk ? navVal[pk] : undefined;
                                        }
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
                    } catch (_e) {
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
                        } catch (_e) {
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

            // Mark entity for deletion — dirty, so register it in the dirty index.
            this.__state = 'delete';
            if (typeof this.__context.__markDirty === 'function') {
                this.__context.__markDirty(this);
            } else if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
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
            // Reload resets ORIGINAL values to the database state (EF Reload())
            // so the next concurrency check compares against the current row.
            if (typeof this.__context._refreshOriginalValues === 'function') {
                this.__context._refreshOriginalValues(this);
            }
            // Drop the duplicate instance findById tracked (one copy per row).
            if (typeof this.__context.__untrack === 'function') {
                this.__context.__untrack([fresh]);
            }

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

        // Make internal metadata (`__*`) and helper/hook methods
        // non-enumerable so that `{ ...entity }` / `Object.assign` copy only
        // column values — see the matching note in entityTrackerModel.build().
        // Without this, the copied `toJSON` silently drops caller-added keys
        // on serialize and `__context` leaks (circular JSON).
        for (const key of Object.keys(newEntity)) {
            const desc = Object.getOwnPropertyDescriptor(newEntity, key);
            // Only DATA properties (internals + methods); skip accessor
            // (column) getters, which are non-configurable.
            if (!desc || !('value' in desc)) continue;
            if (key.startsWith('__') || typeof desc.value === 'function') {
                Object.defineProperty(newEntity, key, { enumerable: false });
            }
        }

        return newEntity;
    }

    add(entityValue){
        entityValue.__state = "insert";
        entityValue.__entity = this.__entity;
        entityValue.__context = this.__context;
        entityValue.__name = this.__entity.__name;
        // An UNSET declared field still resolves to its definition method on the
        // class prototype (e.g. `apiKey(db){...}`) — a truthy function — so
        // `!entity.apiKey` never fires. Blank those so an added entity reads
        // cleanly even before save. (This is a plain own-property write, not the
        // full accessor install, which the insert path can't take pre-save; full
        // change-tracking accessors are attached after INSERT.) Relationship
        // navigation properties are left alone.
        for (const f in this.__entity) {
            const def = this.__entity[f];
            const isRel = def && (def.type === 'hasOne' || def.type === 'hasMany'
                || def.type === 'hasManyThrough' || def.relationshipType === 'belongsTo');
            if (!isRel && typeof entityValue[f] === 'function') {
                entityValue[f] = undefined;
            }
        }
        this.__context.__markDirty(entityValue);   // insert is dirty
    }

    remove(entityValue){
        entityValue.__state = "delete";
        entityValue.__entity = this.__entity;
        entityValue.__context = this.__context;
        this.__context.__markDirty(entityValue);   // delete is dirty
    }

    removeRange(entityValues){
        for (const property in entityValues) {
            const entityValue = entityValues[property];
            entityValue.__state = "delete";
            entityValue.__entity = this.__entity;
            entityValue.__context = this.__context;
            this.__context.__markDirty(entityValue);   // delete is dirty
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

