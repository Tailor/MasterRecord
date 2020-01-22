// version 1
var fs = require('fs');
// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{


    EDMModelDiffer(snapShot, contextModel){
        // do a diff and return only diff fields
        // if table doesnt exist then add a create database object.
    }

    migrationCodeGenerator(name, column, migrationDate){
        // will create migration file with data needed
        // using the migration template

    }


}

module.exports = Migrations;