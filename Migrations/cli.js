#!/usr/bin/env node

// version 0.0.7
// https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
// how to add environment variables on cli call example - master=development masterrecord add-migration auth authContext

const program = require('commander');
let fs = require('fs');
let path = require('path');
var Migration = require('./migrations');
var globSearch = require("glob");

const [,, ...args] = process.argv



program
  .version('0.0.2')
  .option('-v, --version', '0.0.34') 
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

  // Instructions : to run command you must go to main project folder is located and run the command using the context file name.
  program
  .command('enable-migrations <contextFileName>')
  .alias('em')
  .description('Enables the migration in your project by creating a configuration class called ContextSnapShot.json')
  .action(function(contextFileName){

        var migration = new Migration();
        // location of folder where command is being executed..
        var executedLocation = process.cwd();
        // find context file from main folder location
        var contextInstance = migration.findContext(executedLocation, contextFileName);
       var context =  new contextInstance.context();
        var snap = {
          file : contextInstance.fileLocation,
          executedLocation : executedLocation,
          context : context,
          contextEntities : [],
          contextFileName: contextFileName.toLowerCase()
        }

        migration.createSnapShot(snap);
        console.log("Migration enabled")

  });

  // Instructions : to run command you must go to folder where migration file is located.
  program //// TODO ---- WHY MIGRATION IS CREATING ADD COLUMSN AS WELL AS NEW TABLE
  .command('add-migration <name> <contextFileName>')
  .alias('am')
  .action(function(name, contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
      try{
          // find context file from main folder location
        var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
        var files = globSearch.sync(search, executedLocation);
        var file = files[0];
        if(file){
          var contextSnapshot = require(files[0]);
          var context = require(contextSnapshot.contextLocation);
          var contextInstance = new context();
          var newEntity = migration.template(name, contextSnapshot.schema, contextInstance.__entities);
          var migrationDate = Date.now();
          var file = `${contextSnapshot.migrationFolder}/${migrationDate}_${name}_migration.js`
          fs.writeFile(file, newEntity, 'utf8', function (err) {
            if (err) return console.log("--- Error running cammand, rlease run command add-migration ---- ", err);
          });
          console.log(`${name} migration file created`);
        }
        else{
          console.log("Error - Cannot read or find Context file");
        }
       }catch (e){
         console.log("Error - Cannot read or find file ", e);
      }
  });

 program
  .command('update-database <contextFileName>')
  .alias('ud')
  .description('Apply pending migrations to database - up method call')
  .action(function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
      try{
         // find context file from main folder location
         var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
         var files = globSearch.sync(search, executedLocation);
         var file = files[0];
         if(file){
          var contextSnapshot = require(file);
          var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
          var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
          if( migrationFiles){
            
           // find newest migration file
             var mFiles = migrationFiles.sort(function(x, y){
               return new Date(x.timestamp) < new Date(y.timestamp) ? 1 : -1
             });
 
             var mFile = mFiles[0];
             var migrationProjectFile = require(mFile);
             var context = require(contextSnapshot.contextLocation);
             var contextInstance = new context();
             var newMigrationProjectInstance = new migrationProjectFile(context);
             var tableObj = migration.buildUpObject(contextSnapshot.schema, contextInstance.__entities);
             newMigrationProjectInstance.up(tableObj);
            
             var snap = {
               file : contextSnapshot.contextLocation,
               executedLocation : executedLocation,
               context : contextInstance,
               contextEntities : contextInstance.__entities,
               contextFileName: contextFileName
             }
 
             migration.createSnapShot(snap);
             console.log("database updated");
          }
          else{
           console.log("Error - Cannot read or find migration file");
          }

         }
         else{
           console.log("Error - Cannot read or find Context file");
          }
        }catch (e){
          console.log("Error - Cannot read or find file ", e);
        }
  });


 program
 .command('get-migrations <contextFileName>')
 .alias('gm')
 .description('Get a list of migration file names using the context')
 .action(function(contextFileName){
      var executedLocation = process.cwd();
      contextFileName = contextFileName.toLowerCase();
      var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
      var files = globSearch.sync(search, executedLocation);
      var file = files[0];
      if(file){
          var contextSnapshot = require(file);
          var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
          var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
          if( migrationFiles){
            console.log("MIgration File List", migrationFiles);
            return migrationFiles;
          }
      }
      else{
        console.log("Error - Cannot read or find Context file");
      }
 });

  // we will find the migration folder inside the nearest app folder if no migration folder is location is added
  program
  .command('update-database-target <migrationFileName>')
  .alias('udt')
  .description('Apply pending migrations to database - down method call')
  .action(function(migrationFileName){
  // this will call all the down methods until it gets to the one your looking for. First it needs to validate that there is such a file. 
  });



program.parse(process.argv);