// version 1
var fs = require('fs');

class Schema{
    
    constructor(settings){
        this.settings = settings;
    }
    
    // create obj to convert into create sql
    addColumn(tableName, columnName, ){

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