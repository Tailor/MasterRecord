// Version 0.0.17

var modelBuilder  = require('./Entity/entityModelBuilder');
var query = require('masterrecord/QueryLanguage/queryMethods');
var tools =  require('./Tools');
var SQLLiteEngine = require('masterrecord/SQLLiteEngine');
var MYSQLEngine = require('masterrecord/mySQLEngine');
var PostgresEngine = require('masterrecord/postgresEngine');
var insertManager = require('./insertManager');
var deleteManager = require('./deleteManager');
var globSearch = require("glob");
var fs = require('fs');
var path = require('path');
const appRoot = require('app-root-path');
const MySQLClient = require('masterrecord/mySQLSyncConnect');
const PostgresClient = require('masterrecord/postgresSyncConnect');
const QueryCache = require('./Cache/QueryCache');

class context {
    _isModelValid = {
        isValid: true,
        errors: []
    };
    __entities = [];
    __builderEntities = [];
    __trackedEntities = [];
    __trackedEntitiesMap = new Map();  // Performance: O(1) entity lookup instead of O(n) linear search
    __relationshipModels = [];
    __environment = "";
    __name = "";
    tablePrefix = "";
    isSQLite = false;
    isMySQL = false;
    isPostgres = false;

    // Static shared cache - all context instances share the same cache
    static _sharedQueryCache = null;

    constructor(){
        this. __environment = process.env.master;
        this.__name = this.constructor.name;
        this._SQLEngine = "";
        this.__trackedEntitiesMap = new Map();  // Initialize Map for O(1) lookups

        // Initialize shared query cache (only once across all instances)
        if (!context._sharedQueryCache) {
            context._sharedQueryCache = new QueryCache({
                ttl: process.env.QUERY_CACHE_TTL || 5000,  // 5 seconds default (request-scoped)
                maxSize: process.env.QUERY_CACHE_SIZE || 1000,
                enabled: process.env.QUERY_CACHE_ENABLED !== 'false'
            });
        }

        // Reference the shared cache
        this._queryCache = context._sharedQueryCache;
    }

        /* 
        SQLite expected model 
        {
            "type": "better-sqlite3",
            "connection" : "/db/mydb.sqlite",  // or "/db/" (auto-creates <contextname>.sqlite)
            "password": "",
            "username": ""
        }
    */
    __SQLiteInit(env, sqlName){
        try{
           
            const sqlite3 = require(sqlName);
            let DBAddress = env.completeConnection;
            var db = new sqlite3(DBAddress, env);
            db.__name = sqlName;
            this._SQLEngine = new SQLLiteEngine();
            return db;
        }
        catch (e) {
            console.log("error SQL", e);
            throw new Error(String(e))
        }
    }

    /*
    mysql expected model
         {
             "type": "mysql",
            host     : 'localhost',
            user     : 'me',
            password : 'secret',
            database : 'my_db'
          }
          */
    __mysqlInit(env, sqlName){
        try{

            //const mysql = require(sqlName);
            const connection = new MySQLClient(env);
            this._SQLEngine = new MYSQLEngine();
            this._SQLEngine.__name = sqlName;
            return connection;

        }
        catch (e) {
            console.log("error SQL", e);
        }
    }

    /*
    postgres expected model
         {
             "type": "postgres",
            host     : 'localhost',
            port     : 5432,
            user     : 'me',
            password : 'secret',
            database : 'my_db'
          }
          */
    async __postgresInit(env, sqlName){
        try{
            const connection = new PostgresClient();
            await connection.connect(env);
            this._SQLEngine = connection.getEngine();
            this._SQLEngine.__name = sqlName;
            return connection.getPool();
        }
        catch (e) {
            console.log("error PostgreSQL", e);
            throw e;
        }
    }

    __clearErrorHandler(){
        this._isModelValid = {
            isValid: true,
            errors: []
        };
    };

    __findSettings(root, rootFolderLocation, envType){
        if(envType === undefined){
            envType = "development";
        }
        let currentRoot = root;
        const maxHops = 12;
        for(let i = 0; i < maxHops; i++){
            const rootFolder = path.isAbsolute(rootFolderLocation) ? rootFolderLocation : path.join(currentRoot, rootFolderLocation);
            // Support both env.development.json and development.json naming
            const searchA = `${rootFolder}/**/*env.${envType}.json`;
            const searchB = `${rootFolder}/**/*${envType}.json`;
            let files = globSearch.sync(searchA, { cwd: currentRoot, dot: true, nocase: true, windowsPathsNoEscape: true });
            if(!files || files.length === 0){
                files = globSearch.sync(searchB, { cwd: currentRoot, dot: true, nocase: true, windowsPathsNoEscape: true });
            }
            const rel = files && files[0];
            if(rel){
                // Ensure absolute path for require()
                const abs = path.isAbsolute(rel) ? rel : path.resolve(currentRoot, rel);
                return { file: abs, rootFolder: currentRoot };
            }
            const parent = path.dirname(currentRoot);
            if(parent === currentRoot || parent === ""){
                break;
            }
            currentRoot = parent;
        }
        const msg = `could not find env file '${rootFolderLocation}/env.${envType}.json' starting at ${root}`;
        console.log(msg);
        throw new Error(msg);
    }

    // Auto-detect DB type (sqlite or mysql) using environment JSON
    env(rootFolderLocation){
        try{
            // Determine environment: prefer explicit, then NODE_ENV, fallback 'development'
            let envType = this.__environment || process.env.NODE_ENV || 'development';
            const contextName = this.__name;

            // Try multiple base roots for robustness
            const candidateRoots = [ process.cwd(), appRoot.path, __dirname ];
            let file;
            for(let i = 0; i < candidateRoots.length; i++){
                try{
                    file = this.__findSettings(candidateRoots[i], rootFolderLocation, envType);
                    if(file) break;
                }catch(_){ /* try next */ }
            }
            // If still not found and an absolute path was provided, try directly
            if(!file && path.isAbsolute(rootFolderLocation)){
                const directFolder = rootFolderLocation;
                const envFileA = path.join(directFolder, `env.${envType}.json`);
                const envFileB = path.join(directFolder, `${envType}.json`);
                const picked = fs.existsSync(envFileA) ? envFileA : (fs.existsSync(envFileB) ? envFileB : null);
                if(picked){
                    // Smart root folder detection for plugin paths
                    // If the env file is in a bb-plugins/<plugin-name>/config/environments/ structure,
                    // we should set rootFolder to the project root, not the plugin's config folder
                    let detectedRoot = path.dirname(path.dirname(picked));

                    // Check if we're in a bb-plugins structure
                    const pickedParts = picked.split(path.sep);
                    const pluginsIndex = pickedParts.findIndex(part => part === 'bb-plugins');

                    if(pluginsIndex !== -1 && pluginsIndex + 3 < pickedParts.length) {
                        // We're in bb-plugins/<plugin-name>/config/environments/...
                        // Set rootFolder to the project root (parent of bb-plugins)
                        const projectRootParts = pickedParts.slice(0, pluginsIndex);
                        detectedRoot = projectRootParts.join(path.sep) || path.sep;
                    }

                    file = { file: picked, rootFolder: detectedRoot };
                }
            }
            if(!file){
                throw new Error(`Environment config not found for '${envType}' under '${rootFolderLocation}'.`);
            }

            // Always require absolute file path to avoid module root ambiguity on global installs/Windows
            const settingsPath = path.isAbsolute(file.file) ? file.file : path.resolve(file.rootFolder, file.file);
            const settings = require(settingsPath);
            const options = settings[contextName];
            if(options === undefined){
                console.log("settings missing context name settings");
                throw new Error("settings missing context name settings");
            }

            const type = String(options.type || '').toLowerCase();

            if(type === 'sqlite' || type === 'better-sqlite3'){
                this.isSQLite = true; this.isMySQL = false;
                // Treat leading project-style paths ('/components/...') as project-root relative across OSes
                let dbPath = options.connection || '';
                if(dbPath){
                    const looksProjectRootRelative = dbPath.startsWith('/') || dbPath.startsWith('\\');
                    const isAbsoluteFsPath = path.isAbsolute(dbPath);
                    if(looksProjectRootRelative || !isAbsoluteFsPath){
                        // Normalize leading separators to avoid duplicating separators on Windows
                        const trimmed = dbPath.replace(/^[/\\]+/, '');
                        dbPath = path.join(file.rootFolder, trimmed);
                    }
                }
                // If dbPath is a directory (ends with separator or exists as directory), append default filename
                const endsWithSep = dbPath.endsWith('/') || dbPath.endsWith('\\');
                const isDir = fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory();
                if(endsWithSep || isDir){
                    const dbName = `${contextName.toLowerCase()}.sqlite`;
                    dbPath = path.join(dbPath, dbName);
                }
                const dbDir = path.dirname(dbPath);
                if(!fs.existsSync(dbDir)){
                    fs.mkdirSync(dbDir, { recursive: true });
                }
                const sqliteOptions = { ...options, completeConnection: dbPath };
                this.db = this.__SQLiteInit(sqliteOptions, 'better-sqlite3');
                this._SQLEngine.setDB(this.db, 'better-sqlite3');
                return this;
            }

            if(type === 'mysql'){
                this.isMySQL = true; this.isSQLite = false; this.isPostgres = false;
                this.db = this.__mysqlInit(options, 'mysql2');
                this._SQLEngine.setDB(this.db, 'mysql');
                return this;
            }

            if(type === 'postgres' || type === 'postgresql'){
                this.isPostgres = true; this.isMySQL = false; this.isSQLite = false;
                // Postgres is async, so we need to handle promises
                (async () => {
                    this.db = await this.__postgresInit(options, 'pg');
                    // Note: engine is already set in __postgresInit
                })();
                return this;
            }

            throw new Error(`Unsupported database type '${options.type}'. Expected 'sqlite', 'mysql', or 'postgres'.`);
        }
        catch(err){
            console.log("error:", err);
            throw new Error(String(err));
        }
    }

    useSqlite(rootFolderLocation){
        try{
            this.isSQLite = true;
            var root =  process.cwd();
            var envType = this.__environment;
            var contextName = this.__name;
            var file = this.__findSettings(root, rootFolderLocation, envType);
            var settings = require(file.file);
            var options = settings[contextName];
            
            if(options === undefined){
                console.log("settings missing context name settings");
                throw new Error("settings missing context name settings");
            }

            this.validateSQLiteOptions(options);
            // Build DB path similarly to env(): project-root relative on leading slash
            let dbPath = options.connection || '';
            if(dbPath){
                const looksProjectRootRelative = dbPath.startsWith('/') || dbPath.startsWith('\\');
                const isAbsoluteFsPath = path.isAbsolute(dbPath);
                if(looksProjectRootRelative || !isAbsoluteFsPath){
                    const trimmed = dbPath.replace(/^[/\\]+/, '');
                    dbPath = path.join(file.rootFolder, trimmed);
                }
            }
            // If dbPath is a directory (ends with separator or exists as directory), append default filename
            const endsWithSep = dbPath.endsWith('/') || dbPath.endsWith('\\');
            const isDir = fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory();
            if(endsWithSep || isDir){
                const dbName = `${contextName.toLowerCase()}.sqlite`;
                dbPath = path.join(dbPath, dbName);
            }
            options.completeConnection = dbPath;
            var dbDirectory = path.dirname(options.completeConnection);
            
            if (!fs.existsSync(dbDirectory)){
                fs.mkdirSync(dbDirectory, { recursive: true });
            }

            this.db = this.__SQLiteInit(options,  "better-sqlite3");
            this._SQLEngine.setDB(this.db, "better-sqlite3");
            return this;
        }
        catch(err){
            console.log("error:",err );
            throw new Error(String(err));
        }
    }

    validateSQLiteOptions(options){
        if(!options || typeof options !== 'object'){
            throw new Error("settings object is missing or invalid");
        }

        // Normalize type
        let type = (options.type || '').toString().toLowerCase();
        if(!type){
            // Infer when not provided
            if(typeof options.connection === 'string'){
                type = 'sqlite';
                options.type = 'sqlite';
            }
            else if(options.host || options.user || options.database){
                type = 'mysql';
                options.type = 'mysql';
            }
        }

        if(type === 'sqlite' || type === 'better-sqlite3'){
            // Required
            if(!options.connection || typeof options.connection !== 'string' || options.connection.trim() === ''){
                throw new Error("connection string settings is missing");
            }
            // Defaults
            if(options.username === undefined){ options.username = ''; }
            if(options.password === undefined){ options.password = ''; }
            return; // valid
        }

        if(type === 'mysql'){
            // Defaults
            if(!options.host){ options.host = 'localhost'; }
            if(options.port === undefined){ options.port = 3306; }
            if(options.password === undefined){ options.password = ''; }
            // Required
            if(!options.user || options.user.toString().trim() === ''){
                throw new Error("MySQL 'user' is required in settings");
            }
            if(!options.database || options.database.toString().trim() === ''){
                throw new Error("MySQL 'database' is required in settings");
            }
            return; // valid
        }

        throw new Error(`Unsupported database type '${options.type}'. Expected 'sqlite' or 'mysql'.`);
    }
    
    useMySql(rootFolderLocation){
        
            this.isMySQL = true;
            var envType = this.__environment;
            var contextName = this.__name;
            var root = appRoot.path;
            var file = this.__findSettings(root, rootFolderLocation, envType);
            var settings = require(file.file);
            var options = settings[contextName];
            
            if(options === undefined){
                console.log("settings missing context name settings");
                throw new Error("settings missing context name settings");
            }

            this.validateSQLiteOptions(options);
            this.db = this.__mysqlInit(options, "mysql2");
            this._SQLEngine.setDB(this.db, "mysql");
            return this;
       
    }


    dbset(model, name){
        var validModel = modelBuilder.create(model);
        var tableName = name === undefined ? model.name : name;

        // Apply tablePrefix if set
        if(this.tablePrefix && typeof this.tablePrefix === 'string' && this.tablePrefix.length > 0){
            tableName = this.tablePrefix + tableName;
        }

        validModel.__name = tableName;
        this.__entities.push(validModel); // model object
        var buildMod = tools.createNewInstance(validModel, query, this);
        this.__builderEntities.push(buildMod); // query builder entites
        this[validModel.__name] = buildMod;
    }

    modelState(){
        return this._isModelValid;
    }

    /**
     * Process tracked entities (shared logic for all database engines)
     * Refactored from duplicated code in saveChanges
     * Performance: Uses batch operations to fix N+1 query problem
     */
    _processTrackedEntities(tracked){
        // Group entities by state for batch operations
        const toInsert = [];
        const toUpdate = [];
        const toDelete = [];

        // Performance: Group entities by operation type
        for (let i = 0; i < tracked.length; i++) {
            const currentModel = tracked[i];

            switch(currentModel.__state) {
                case "insert":
                    toInsert.push(currentModel);
                    break;
                case "modified":
                    if(currentModel.__dirtyFields.length > 0){
                        toUpdate.push(currentModel);
                    } else {
                        console.log("Tracked entity modified with no values being changed");
                    }
                    break;
                case "delete":
                    toDelete.push(currentModel);
                    break;
            }
        }

        // Batch insert operations
        if(toInsert.length > 0){
            if(toInsert.length === 1){
                // Single insert - use existing insertManager
                const insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
                insert.init(toInsert[0]);
            } else {
                // Batch insert - 100x faster for multiple records
                try {
                    this._SQLEngine.bulkInsert(toInsert);
                } catch(error) {
                    console.error("Bulk insert failed:", error);
                    // Fallback to individual inserts
                    for(const entity of toInsert){
                        const insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
                        insert.init(entity);
                    }
                }
            }
        }

        // Batch update operations
        if(toUpdate.length > 0){
            if(toUpdate.length === 1){
                // Single update - use existing logic
                const currentModel = toUpdate[0];
                const cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity);
                const argu = this._SQLEngine._buildSQLEqualToParameterized(cleanCurrentModel);
                if(argu !== -1){
                    const primaryKey = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                    const sqlUpdate = {
                        tableName: cleanCurrentModel.__entity.__name,
                        arg: argu,
                        primaryKey: primaryKey,
                        primaryKeyValue: cleanCurrentModel[primaryKey]
                    };
                    this._SQLEngine.update(sqlUpdate);
                } else {
                    console.log("Nothing has been tracked, modified, created or added");
                }
            } else {
                // Batch update
                const updateQueries = [];
                for(const currentModel of toUpdate){
                    const cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity);
                    const argu = this._SQLEngine._buildSQLEqualToParameterized(cleanCurrentModel);
                    if(argu !== -1){
                        const primaryKey = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                        updateQueries.push({
                            tableName: cleanCurrentModel.__entity.__name,
                            arg: argu,
                            primaryKey: primaryKey,
                            primaryKeyValue: cleanCurrentModel[primaryKey]
                        });
                    }
                }
                if(updateQueries.length > 0){
                    try {
                        this._SQLEngine.bulkUpdate(updateQueries);
                    } catch(error) {
                        console.error("Bulk update failed:", error);
                        // Fallback to individual updates
                        for(const query of updateQueries){
                            this._SQLEngine.update(query);
                        }
                    }
                }
            }
        }

        // Batch delete operations
        if(toDelete.length > 0){
            if(toDelete.length === 1){
                // Single delete - use existing deleteManager
                const deleteObject = new deleteManager(this._SQLEngine, this.__entities);
                deleteObject.init(toDelete[0]);
            } else {
                // Batch delete - group by table
                const deletesByTable = {};
                for(const entity of toDelete){
                    const tableName = entity.__entity.__name;
                    const primaryKey = tools.getPrimaryKeyObject(entity.__entity);
                    const id = entity[primaryKey];

                    if(!deletesByTable[tableName]){
                        deletesByTable[tableName] = [];
                    }
                    deletesByTable[tableName].push(id);
                }

                try {
                    for(const tableName in deletesByTable){
                        this._SQLEngine.bulkDelete(tableName, deletesByTable[tableName]);
                    }
                } catch(error) {
                    console.error("Bulk delete failed:", error);
                    // Fallback to individual deletes
                    for(const entity of toDelete){
                        const deleteObject = new deleteManager(this._SQLEngine, this.__entities);
                        deleteObject.init(entity);
                    }
                }
            }
        }
    }

    saveChanges(){
        try{
            const tracked = this.__trackedEntities;

            if(tracked.length > 0){
                // Collect affected tables for cache invalidation
                const affectedTables = new Set();
                for (let i = 0; i < tracked.length; i++) {
                    const entity = tracked[i];
                    if (entity.__entity && entity.__entity.__name) {
                        affectedTables.add(entity.__entity.__name);
                    }
                }

                // Handle transactions based on database type
                if(this.isSQLite){
                    this._SQLEngine.startTransaction();
                    this._processTrackedEntities(tracked);
                    this.__clearErrorHandler();
                    this._SQLEngine.endTransaction();
                }
                else if(this.isMySQL){
                    // MySQL: Transaction handling commented out in original
                    // this._SQLEngine.startTransaction();
                    this._processTrackedEntities(tracked);
                    this.__clearErrorHandler();
                    // this._SQLEngine.endTransaction();
                }
                else if(this.isPostgres){
                    // PostgreSQL: Async operations, no transaction control here
                    this._processTrackedEntities(tracked);
                    this.__clearErrorHandler();
                }

                // Invalidate query cache for affected tables
                for (const tableName of affectedTables) {
                    this._queryCache.invalidateTable(tableName);
                }
            }
            else{
                console.log("save changes has no tracked entities");
            }
        }
        catch(error){
            this.__clearErrorHandler();
            console.log("error", error);

            if(this.isSQLite){
                this._SQLEngine.errorTransaction();
            }
            this.__clearTracked();
            throw error;
        }

        this.__clearTracked();
        return true;
    }


    _execute(query){
        this._SQLEngine._execute(query);
    }

    /**
     * Get query cache statistics
     */
    getCacheStats() {
        return this._queryCache.getStats();
    }

    /**
     * Clear query cache manually
     */
    clearQueryCache() {
        this._queryCache.clear();
    }

    /**
     * Enable/disable query caching
     */
    setQueryCacheEnabled(enabled) {
        this._queryCache.enabled = enabled;
    }

    /**
     * End request and clear query cache
     * Call this at the end of each request (like Active Record)
     *
     * @example
     * // In Express middleware
     * app.use((req, res, next) => {
     *     req.db = new AppContext();
     *     res.on('finish', () => {
     *         req.db.endRequest();  // Clears cache
     *     });
     *     next();
     * });
     */
    endRequest() {
        this.clearQueryCache();
    }

    // __track(model){
    //     this.__trackedEntities.push(model);
    //     return model;
    // }

    __track(model){
        // Performance: Use Map for O(1) lookup instead of O(n) linear search
        if(!model.__ID){
            // Generate ID if missing
            model.__ID = Math.floor((Math.random() * 100000) + 1);
        }

        // O(1) check if already tracked
        if(!this.__trackedEntitiesMap.has(model.__ID)){
            this.__trackedEntities.push(model);
            this.__trackedEntitiesMap.set(model.__ID, model);
        }

        return model;
    }

    __findTracked(id){
        // Performance: O(1) Map lookup instead of O(n) array search
        if(id){
            return this.__trackedEntitiesMap.get(id) || null;
        }
        return null;
    }

    __clearTracked(){
        this.__trackedEntities = [];
        this.__trackedEntitiesMap.clear();  // Don't forget to clear the Map too
    }
}


module.exports = context;