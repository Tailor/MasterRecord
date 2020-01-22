#!/usr/bin/env node
const program = require('commander');
let fs = require('fs');
let path = require('path');
var Migration = require('./migrations');


// npm unlink
// npm link
const [,, ...args] = process.argv

//console.log(`hello ${args}`);


program
  .version('0.0.1')
  .option('-v, --version', '0.0.1') 
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

  // go to folder with contaxt file and run command
  program
  .command('enable-migrations <contextFileName>')
  .alias('am')
  .description('Enables the migration in your project by creating a Configuration class called ContextModelSnapShot.json')
  .action(function(contextFileName){
        // location of folder where command is being executed..
        var executedLocation = process.cwd();
        // go back 1 folder level
        let previousFolder = path.join(executedLocation, '../');
        var migrationsDirectory = `${previousFolder}/migrations`;
        // create js file name configuration.js // https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory);
        }

        var content = {
            contextLocation: `${executedLocation}/${contextFileName}.js`,
            migrationLocation: `${executedLocation}/Migrations`,
            schema : {

            }
        };
        
        const jsonContent = JSON.stringify(content, null, 2);

        try{
          // will replace the whole file if it exist
            fs.writeFileSync(`${migrationsDirectory}/ContextModelSnapShot.json`, jsonContent);
        }catch (e){
            console.log("Cannot write file ", e);
        }
  });

  // must be in the migration folder to run this command
  // todo
    // we find the database.json file
    // we read the json file and get the json data
    // we use that json data to find the context file
    // we run the context file and get all the models
    // we run it through migrations manager

  program
  .command('add-migration <name>')
  .alias('am')
  .description('Creates a new migration class')
  .action(function(name){

      var dbJson = null;
      try{
        dbJson =  fs.readFileSync(`./ContextModelSnapShot.json`, 'utf8');
      }catch (e){
          console.log("Cannot read or find file ", e);
      }

      // TODO: get database.json file
      var migration = new Migration();
      var dbJsonData = JSON.parse(dbJson);
      var context = require(dbJsonData.contextLocation);
      var snapShot = migration.buildMigrationSnapshot(dbJsonData.migrationLocation);
  // loop through each context dbset
  // 
      // var newEntity = migration.EDMModelDiffer(context, snapShot);
      // if(newEntity !== -1){
      //   var migrationDate = Date.now();
      //   migration.migrationCodeGenerator(name, newEntity, migrationDate);
      //   console.log(`migration ${name}_${migrationDate} created`);
      // }
  });

 // will use the database settings to call and get the schema_migration table
 // we will get the list of all migrations that have been ran
 // we will compare that list with the folder of migrations to see if we ran everything 
 // the migrations we missed we will call the up method
 // the up method will run the create database functions 
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