// version 1
var fs = require('fs');
// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    // build current Migration snapShot
    buildMigrationSnapshot(migrationFolderLocation){
        // we will loop through each old migration and rebuild each enitity object so that we can check the diffrence
        // return full snapshot
    }

    EDMModelDiffer(currentModel, migrationSnapShot){
        // calculate required database changes
        // find model changes that have not been implemented in migrations.
    }

    migrationCodeGenerator(name, column, migrationDate){
        // will create migration file with data needed

    }

    // create obj to convert into create sql
    addColumn(tableName, columnName, ){

        // add column to database
    }

    dropColumn(tableName, columnName){
        // drop column 

    }

    createTable(name, columns){

    }

    dropTable(name){

    }
}


/*
    up and down function..
    on commmand line call of run migrations with folder location of context. it will
    load context and all the objects.
    it will then match objects with migration data. 
    if it's a new item it will generate a new migration dependent on what comes from migration. 
    

*/

module.exports = Migrations;