#!/usr/bin/env node
  // https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
const program = require('commander');
let fs = require('fs');
let path = require('path');
var Migration = require('./migrations');

const [,, ...args] = process.argv

program
  .version('0.0.1')
  .option('-v, --version', '0.0.1') 
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

  // Instructions : to run command you must go to folder where contaxt file is located and run command with context file name.
  program
  .command('enable-migrations <contextFileName>')
  .alias('am')
  .description('Enables the migration in your project by creating a Configuration class called ContextModelSnapShot.json')
  .action(function(contextFileName){
        // location of folder where command is being executed..
        var executedLocation = process.cwd();
        // go back 1 folder level
        let previousFolder = path.join(executedLocation, '../');
        var migrationsDirectory = `${previousFolder}/Migrations`;
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory);
        }

        var content = {
            contextLocation: `${executedLocation}/${contextFileName}.js`,
            migrationLocation: `${executedLocation}/Migrations`,
            schema : {}
        };
        const jsonContent = JSON.stringify(content, null, 2);
        try{
          // will replace the whole file if it exist
            fs.writeFileSync(`${migrationsDirectory}/ContextSnapShot.json`, jsonContent);
        }catch (e){
            console.log("Cannot write file ", e);
        }
  });

  program
  .command('add-migration <name>')
  .alias('am')
  .description('Creates a new migration class')
  .action(function(name){

      try{
        var contextSnapshot = fs.readFileSync(`./ContextSnapShot.json`, 'utf8');
        var migration = new Migration();
        var contextSnapShotModel = JSON.parse(contextSnapshot);
        var context = require(contextSnapShotModel.contextLocation);
        var snapShotSchema = contextSnapShotModel.schema;
        var newEntity = migration.EDMModelDiffer(snapShotSchema, context);
        if(newEntity !== -1){
            var migrationDate = Date.now();
            migration.migrationCodeGenerator(name, newEntity, migrationDate);
            console.log(`migration ${name}_${migrationDate} created`);
        }
      }catch (e){
          console.log("Cannot read or find file ", e);
      }

  });

 // will use the database settings to call and get the schema_migration table
 // we will get the list of all migrations that have been ran
 // we will compare that list with the folder of migrations to see if we ran everything 
 // the migrations we missed we will call the up method
 // the up method will run the create database functions
// then update the database.js schema

 program
  .command('update-database <databaseSettingLocation> <migrationFolderLocation> ')
  .alias('ud')
  .description('Apply pending migrations to database')
  .action(function(cmd){
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