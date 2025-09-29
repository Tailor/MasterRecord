// Version 0.0.15

var modelBuilder  = require('./Entity/entityModelBuilder');
var query = require('masterrecord/QueryLanguage/queryMethods');
var tools =  require('./Tools');
var SQLLiteEngine = require('masterrecord/SQLLiteEngine');
var MYSQLEngine = require('masterrecord/mySQLEngine');
var insertManager = require('./insertManager');
var deleteManager = require('./deleteManager');
var globSearch = require("glob");
var fs = require('fs');
var path = require('path');
const appRoot = require('app-root-path');
const MySQLClient = require('masterrecord/mySQLSyncConnect');

class context {
    _isModelValid = {
        isValid: true,
        errors: []
    };
    __entities = [];
    __builderEntities = [];
    __trackedEntities = [];
    __relationshipModels = [];
    __environment = "";
    __name = "";
    isSQLite = false;
    isMySQL = false;
    isPostgres = false;

    constructor(){
        this. __environment = process.env.master;
        this.__name = this.constructor.name;
        this._SQLEngine = "";
    }

        /* 
        SQLite expected model 
        {
            "type": "better-sqlite3",
            "connection" : "/db/",
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
                    file = { file: picked, rootFolder: path.dirname(path.dirname(picked)) };
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
                this.isMySQL = true; this.isSQLite = false;
                this.db = this.__mysqlInit(options, 'mysql2');
                this._SQLEngine.setDB(this.db, 'mysql');
                return this;
            }

            throw new Error(`Unsupported database type '${options.type}'. Expected 'sqlite' or 'mysql'.`);
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
        validModel.__name = name === undefined ? model.name : name;
        this.__entities.push(validModel); // model object
        var buildMod = tools.createNewInstance(validModel, query, this);
        this.__builderEntities.push(buildMod); // query builder entites
        this[validModel.__name] = buildMod;
    }

    modelState(){
        return this._isModelValid;
    }

    saveChanges(){
        try{
            var tracked = this.__trackedEntities;

            if(tracked.length > 0){
                // start transaction
                if(this.isSQLite){
                    this._SQLEngine.startTransaction();
                    for (var model in tracked) {
                        var currentModel = tracked[model];
                            switch(currentModel.__state) {
                                case "insert": 
                                    var insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
                                    insert.init(currentModel);
                                    
                                break;
                                case "modified":
                                    if(currentModel.__dirtyFields.length > 0){
                                        var cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity); 
                                        // build columns equal to value string 
                                        var argu = this._SQLEngine._buildSQLEqualTo(cleanCurrentModel);
                                        if(argu !== -1 ){
                                            var primaryKey  = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                                            var sqlUpdate = {tableName: cleanCurrentModel.__entity.__name, arg: argu, primaryKey : primaryKey, primaryKeyValue : cleanCurrentModel[primaryKey] };
                                            this._SQLEngine.update(sqlUpdate);
                                        }
                                        else{
                                            console.log("Nothing has been tracked, modified, created or added");
                                        }
                                        
                                    }
                                    else{
                                        console.log("Tracked entity modified with no values being changed");
                                    }

                                // code block
                                break;
                                case "delete":
                                    var deleteObject = new deleteManager(this._SQLEngine, this.__entities);
                                    deleteObject.init(currentModel);
                                    
                                break;
                            } 
                    }
                    this.__clearErrorHandler();
                    this._SQLEngine.endTransaction();
                }
                if(this.isMySQL){
                    //this._SQLEngine.startTransaction();
                    for (var model in tracked) {
                        var currentModel = tracked[model];
                            switch(currentModel.__state) {
                                case "insert": 
                                    var insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
                                    insert.init(currentModel);
                                    
                                break;
                                case "modified":
                                    if(currentModel.__dirtyFields.length > 0){
                                        var cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity);
                                        // build columns equal to value string 
                                        var argu = this._SQLEngine._buildSQLEqualTo(cleanCurrentModel);
                                        if(argu !== -1 ){
                                            var primaryKey  = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                                            var sqlUpdate = {tableName: cleanCurrentModel.__entity.__name, arg: argu, primaryKey : primaryKey, primaryKeyValue : cleanCurrentModel[primaryKey] };
                                            this._SQLEngine.update(sqlUpdate);
                                        }
                                        else{
                                            console.log("Nothing has been tracked, modified, created or added");
                                        }
                                       
                                    }
                                    else{
                                        console.log("Tracked entity modified with no values being changed");
                                    }

                                // code block
                                break;
                                case "delete":
                                    var deleteObject = new deleteManager(this._SQLEngine, this.__entities);
                                    deleteObject.init(currentModel);
                                    
                                break;
                            } 
                    }
                    this.__clearErrorHandler();
                    //this._SQLEngine.endTransaction();
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

    // __track(model){
    //     this.__trackedEntities.push(model);
    //     return model;
    // }

    __track(model){
        var add = true;
        for (var mod in this.__trackedEntities) {
            var id = this.__trackedEntities[mod].__ID;
            if(id === undefined){
                id = Math.floor((Math.random() * 100000) + 1);
            }
            if(id === model.__ID){
                add = false;
            }
        }
        if(this.__trackedEntities.length === 0){
            this.__trackedEntities.push(model);
        }
        else{
            if(add){
                this.__trackedEntities.push(model);
            }
        }

        return model;
    }

    __findTracked(id){
        if(id){
            for (var model in this.__trackedEntities) {
                if(this.__trackedEntities[model].__ID === id){
                    return this.__trackedEntities[model];
                }
            }
        }
        return null;
    }

    __clearTracked(){
        this.__trackedEntities = [];
    }
}


module.exports = context;