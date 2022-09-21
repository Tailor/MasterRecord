#!/usr/bin/env node
  // https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
const program = require('commander');
let fs = require('fs');
let path = require('path');
var Migration = require('./migrations');
var globSearch = require("glob");

const [,, ...args] = process.argv



program
  .version('0.0.2')
  .option('-v, --version', '0.0.2') 
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

  // Instructions : to run command you must go to main project folder is located and run the command using the  context file name.
  program
  .command('enable-migrations <contextFileName>')
  .alias('em')
  .description('Enables the migration in your project by creating a configuration class called ContextSnapShot.json')
  .action(function(contextFileName){
        var migration = new Migration();
        // location of folder where command is being executed..
        var executedLocation = process.cwd();
        // find context file from main folder location
        var search = `${executedLocation}/**/*${contextFileName}.js`

        var files = globSearch.sync(search, executedLocation);
        var contextInstance = require(file);
        
        var snap = {
          file : files[0],
          executedLocation : executedLocation,
          context : new contextInstance(),
          contextFileName: contextFileName.toLowerCase()
        }

        migration.createSnapShot(snap);


  });

  // Instructions : to run command you must go to folder where migration file is located.
  program
  .command('add-migration <name> <contextFileName>')
  .alias('am')
  .description('Creates a new migration class')
  .action(function(name, contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();

      try{
         // find context file from main folder location
         var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`

         var files = globSearch.sync(search, executedLocation);
        var contextSnapshot = require(files[0]);
        var migration = new Migration();
        var context = require(contextSnapshot.contextLocation);
        var newEntity = migration.buildMigrationTemplate(name, contextSnapshot.schema, context.__entities);
        var migrationDate = Date.now();
        var file = `${contextSnapshot.migrationFolder}/${migrationDate}_${name}.js`
        fs.writeFile(file, newEntity, 'utf8', function (err) {
          if (err) return console.log("--- Error running cammand, rlease run command add-migration ---- ", err);
        });
      }catch (e){
        console.log("Cannot read or find file ", e);
      }

      console.log(`${name} migration file created`);
  });

 program
  .command('update-database <contextFileName>')
  .alias('ud')
  .description('Apply pending migrations to database')
  .action(function(contextFileName){

    //TODO
    // find the snapshot file using the migration name
    // find the the newest migration file using the context name 
    // require that file and build
    // call the up function in the 
      var dir = process.cwd();
      console.log("starting server");
      require(dir + '/server.js');
    //return "node c:\node\server.js"
  });

 // we will find the migration folder inside the nearest app folder if no migration folder is location is added
  program
  .command('remove-migration <name> <migrationFolderLocation>')
  .alias('rm')
  .description('Removes the last migration that has not been applied')
  .action(function(name){
    // find migration file using name and delete it.
  });


 // we will find the migration folder inside the nearest app folder if no migration folder is location is added
  program
  .command('revert-migration <name> <migrationFolderLocation>')
  .alias('rm')
  .description('Reverts back to the last migration with given name')
  .action(function(cmd){
      var dir = process.cwd();
      console.log("starting server");
      require(dir + '/server.js');
    //return "node c:\node\server.js"
  });

program.parse(process.argv);