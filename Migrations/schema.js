// version 0.0.4
class schema{

    constructor(context){
        this.context = new context();
    }


    init(table){
        if(table){
            this.fullTable = table.___table;
        }
    }
    
    // create obj to convert into create sql
    addColumn(table){
        // todo need to work on add column for mysql
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var queryObj = queryBuilder.alterColumn(this.fullTable.new, table);
                for (var key in queryObj) {
                    var query = queryObj[key];
                    this.context._execute(query);
                }
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                table.realDataType = queryBuilder.typeManager(table.type);
                var query = queryBuilder.addColum(table);
                this.context._execute(query);
            }
        }

        // add column to database
    }

    dropColumn(table){
        if(table){
            if(this.fullTable){
                // drop column 
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.dropColumn(table);
                    this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.dropColumn(table);
                    this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }
    
    createTable(table){

        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createTable(table);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.createTable(table);
                this.context._execute(query);
            }
        }else{
            console.log("Table that your trying to create is undefined. PLease check if there are any changes that need to be made");
        }
    }


    dropTable(table){
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropTable(table.__name);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropTable(table.__name);
                this.context._execute(query);
            }
        }
    }


   //"dbo.People", "Location"
    alterColumn(table){
        if(table){
            if(this.fullTable){
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var queryObj = queryBuilder.alterColumn(this.fullTable.new, table);
                    for (var key in queryObj) {
                        var query = queryObj[key];
                        this.context._execute(query);
                    }
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.alterColumn(table);
                    this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }

    renameColumn(){
        // TODO
    }

    seed(){
        // TODO
    }
    
}


module.exports = schema;