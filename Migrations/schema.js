// version 1

class schema{

    constructor(context){
        this.context = new context();
    }


    addTable(table){
        this.fullTable = table.___table;
    }
    
    // create obj to convert into create sql
    addColumn(table){
        console.log("----------addColumn ------");
        if(this.context.isSQite){
            var sqliteQuery = require("./migrationSQLiteQuery");
        }
        // add column to database
    }

    createTable(table){

    }

    dropColumn(table){
        if(this.fullTable){
            // drop column 
            if(this.context.isSQite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropColumn(table);
                this.context._execute(query);
            }
        }else{
            console.log("Must call the addTable function.");
        }
    }

    dropTable(table){

    }

    dropIndex(){

    }
   //"dbo.People", "Location"
    alterColumn(table){
        if(this.fullTable){
            if(this.context.isSQite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var queryObj = queryBuilder.alterColumn(this.fullTable.new, table);
                for (var key in queryObj) {
                    var query = queryObj[key];
                    this.context._execute(query);
                }
            }
        }else{
            console.log("Must call the addTable function.");
        }
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