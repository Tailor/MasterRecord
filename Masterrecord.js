
// https://github.com/kriasoft/node-sqlite
// https://www.learnentityframeworkcore.com/dbset/deleting-data
// version 1.0.14

var modelBuilder  = require('./Entity/EntityModelBuilder');
var query = require('masterrecord/QueryLanguage/queryMethods');
var tools =  require('./Tools');
var SQLLiteEngine = require('masterrecord/SQLLiteEngine');
var MYSQLEngine = require('masterrecord/MYSQLEngine');
var insertManager = require('./InsertManager');
var deleteManager = require('./DeleteManager');

class Context {
    _isModelValid = {
        isValid: true,
        errors: []
    };
    __entities = [];
    __builderEntities = [];
    __trackedEntities = [];
    __relationshipModels = [];

    constructor(){
        // TODO when we build the sql engine it depends on the which type.

        this._SQLEngine = "";
        this.__name = this.constructor.name;
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
            let DBAddress = `${env.completeConnection}${env.env}.sqlite3`;
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
            const mysql = require(sqlName);
            const connection = mysql.createConnection(env);
            connection.connect();
            db.__name = sqlName;
            this._SQLEngine = new MYSQLEngine();
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
    
    setup(options, rootFolderLocation){
        
        if(options !== undefined){
            if(options.type !== undefined){
                switch(options.type) {
                    case "better-sqlite3":
                        options.completeConnection = rootFolderLocation + options.connection;
                        this.db = this.__SQLiteInit(options, options.type);
                        this._SQLEngine.setDB(this.db, "better-sqlite3");
                        return this;
                    break;
                    case "mysql":
                        this.db = this.__mysqlInit(options, options.type);
                        this._SQLEngine.setDB(this.db, "mysql");
                        return this;
                    break;
                }
            }
            else{
                console.log("database type not defined - Master Record");
            }
        }
        else{
            console.log("database information not added - Master Record");
        }
        
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
            // start transaction
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
        
        catch(error){
            this.__clearErrorHandler();
            this._SQLEngine.errorTransaction();
            console.log("error", error);
            this.__clearTracked();
            throw error;
        }
       
        this.__clearTracked();
        return true;
    }

    // TODO: WHY WE HAVE DOUBLE TRACKED OBJECTS - LOOP THROUGH ALL TRACKED OBJECTS
    __track(model){
        this.__trackedEntities.push(model);
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


module.exports = Context;

/*

//Create new standard
var standard = new Standard();
standard.StandardName = "Standard1";

//create three new teachers
var teacher1 = new Teacher();
teacher1.TeacherName = "New Teacher1";

var teacher2 = new Teacher();
teacher2.TeacherName = "New Teacher2";

var teacher3 = new Teacher();
teacher3.TeacherName = "New Teacher3";

//add teachers for new standard
standard.Teachers.Add(teacher1);
standard.Teachers.Add(teacher2);
standard.Teachers.Add(teacher3);

using (var dbCtx = new SchoolDBEntities())
{
    //add standard entity into standards entitySet
    dbCtx.Standards.Add(standard);
    //Save whole entity graph to the database
    dbCtx.SaveChanges();
}
*/