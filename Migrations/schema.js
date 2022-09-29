// version 0.0.1
var fs = require('fs');

class schema{
    // TODO : check what database we are using
    // based on the database you can make the call to update the database.


    constructor(context){
        this.context = new context();
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

    createTable(table){

    }

    dropColumn(table){
        // drop column 
        if(this.context.isSQite){
            var sqlite = require("./migrationSQLiteQuery");
            var queryBuilder = new sqlite();
            var query = queryBuilder.dropColumn(table);
            this.context._execute(query);
        }
    }

    dropTable(table){

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

module.exports = schema;