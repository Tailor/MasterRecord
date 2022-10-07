// version 0.0.3
class schema{

    constructor(context){
        this.context = new context();
    }


    init(table){
        this.fullTable = table.___table;
    }
    
    // create obj to convert into create sql
    addColumn(table){
        if(this.context.isSQite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            var queryObj = queryBuilder.alterColumn(this.fullTable.new, table);
            for (var key in queryObj) {
                var query = queryObj[key];
                this.context._execute(query);
            }
        }
        // add column to database
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
    
    createTable(table){
        if(this.context.isSQite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            var query = queryBuilder.createTable(table);
            this.context._execute(query);
        }
    }


    dropTable(table){
        if(this.context.isSQite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            var query = queryBuilder.dropTable(table.__name);
            this.context._execute(query);
        }
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
    
}


module.exports = schema;