// version 1
var fs = require('fs');

var table = {
    email : {
        name: "auth", 
        column : "email",
        rules: { 
            "type": "integer",
        "primary": true,
        "nullable": false,
        "unique": true,
        "auto": true,
        "cascadeOnDelete": true,
        "lazyLoading": true,
        "isNavigational": false

    }
   }
}


class schema{
    // TODO : check what database we are using
    // based on the database you can make the call to update the database.


    constructor(context){
        this.context = context;
    }
    
    // create obj to convert into create sql
    addColumn(table){
        if(this.context.isSQite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var query = sqliteQuery.addColumn(table);
            this.context.db.prepare(query).all();
        }
        // add column to database
    }

    createTable(name, columns){

    }

    dropColumn(tableName, columnName){
        // drop column 

    }

    dropTable(name){

    }

    dropIndex(){

    }
//"dbo.People", "Location"
    alterColumn(){

    }

    renameColumn(){

    }

    seed(){

    }

    // will get the data and create the file
    done(){


    }
    
}


/*
    up and down function..
    on commmand line call of run migrations with folder location of context. it will
    load context and all the objects.
    it will then match objects with migration data. 
    if it's a new item it will generate a new migration dependent on what comes from migration. 
    

*/

module.exports = Schema;