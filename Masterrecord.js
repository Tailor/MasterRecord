
//const db = new Database(null, { Promise: promise });
var context  = require('./Context');
var SQLEngine  = require('./SQLEngine');

// https://github.com/kriasoft/node-sqlite

class MasterRecord {
    constructor() {
        this.Context = context;
    }

    init(env){
        switch(env.type) {
            case "better-sqlite3":
                this.__SQLiteInit(env, env.type);
            break;
        }
    }

    async __SQLiteInit(env, name){
        const sqlite3 = require(name);
        let DBAddress = env.connection + ".sqlite3";
        var db = new sqlite3(DBAddress, env);
        db.__name = name;
        SQLEngine.setDB(db);
    }

}

module.exports = new MasterRecord();