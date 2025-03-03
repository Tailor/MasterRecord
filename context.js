// Version 0.0.7

var modelBuilder  = require('./Entity/entityModelBuilder');
var query = require('masterrecord/QueryLanguage/queryMethods');
var tools =  require('./Tools');
var SQLLiteEngine = require('masterrecord/SQLLiteEngine');
var MYSQLEngine = require('masterrecord/mySQLEngine');
var insertManager = require('./insertManager');
var deleteManager = require('./deleteManager');
var globSearch = require("glob");
var fs = require('fs');
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

        var rootFolder = `${root}/${rootFolderLocation}`;
        var search = `${rootFolder}/**/*env.${envType}.json`;
        var files = globSearch.sync(search, rootFolder);
        var file = files[0];
        if(file === undefined){
            root = tools.removeBackwardSlashSection(root, 1, "/");
            rootFolder = `${root}/${rootFolderLocation}`;
            var search = `${rootFolder}/**/*env.${envType}.json`;
            var files = globSearch.sync(search,rootFolder);
            file = files[0];
            if(file === undefined){
                root = tools.removeBackwardSlashSection(root, 1, "/");
                rootFolder = `${root}/${rootFolderLocation}`;
                var search = `${rootFolder}/**/*env.${envType}.json`;
                var files = globSearch.sync(search,rootFolder);
                file = files[0];
                if(file === undefined){
                    console.log(`could not find file - ${rootFolder}/env.${envType}.json`);
                    throw error(`could not find file - ${rootFolder}/env.${envType}.json`);
                }

            }
        
        }
        
        return {
            file: file,
            rootFolder : root
        };
    }

    useSqlite(rootFolderLocation){
        this.isSQLite = true;
        var root =  process.cwd();
        var envType = this.__environment;
        var contextName = this.__name;
        var file = this.__findSettings(root, rootFolderLocation, envType);
        var settings = require(file.file);
        var options = settings[contextName];
        
        if(options === undefined){
            console.log("settings missing context name settings");
            throw error("settings missing context name settings");
        }

        this.validateSQLiteOptions(options);
        options.completeConnection = `${file.rootFolder}${options.connection}`;
        var dbDirectory = options.completeConnection.substr(0, options.completeConnection.lastIndexOf("\/"));
        
        if (!fs.existsSync(dbDirectory)){
            fs.mkdirSync(dbDirectory);
        }

        this.db = this.__SQLiteInit(options,  "better-sqlite3");
        this._SQLEngine.setDB(this.db, "better-sqlite3");
        return this;
    }

    validateSQLiteOptions(options){
        if(options.hasOwnProperty('connect') === undefined){
            console.log("connnect string settings is missing")
            throw error("connection string settings is missing");
        }

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
                throw error("settings missing context name settings");
            }

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
                                        var primaryKey  = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                                        var sqlUpdate = {tableName: cleanCurrentModel.__entity.__name, arg: argu, primaryKey : primaryKey, primaryKeyValue : cleanCurrentModel[primaryKey] };
                                        this._SQLEngine.update(sqlUpdate);
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
                                        var primaryKey  = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                                        var sqlUpdate = {tableName: cleanCurrentModel.__entity.__name, arg: argu, primaryKey : primaryKey, primaryKeyValue : cleanCurrentModel[primaryKey] };
                                        this._SQLEngine.update(sqlUpdate);
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
            //this._SQLEngine.errorTransaction();
            console.log("error", error);
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