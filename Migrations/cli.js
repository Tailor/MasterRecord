#!/usr/bin/env node

// version 0.0.6
// https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
// how to add environment variables on cli call example - master=development masterrecord add-migration auth authContext

const { program } = require('commander');
let fs = require('fs');
let path = require('path');
const Module = require('module');
// Alias require('masterrecord') to this global package so project files don't need a local install
const __MASTERRECORD_ROOT__ = path.join(__dirname, '..');
const __ORIGINAL_REQUIRE__ = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'masterrecord') {
    return __ORIGINAL_REQUIRE__.call(this, __MASTERRECORD_ROOT__);
  }
  return __ORIGINAL_REQUIRE__.call(this, request);
};
var Migration = require('./migrations');
var globSearch = require("glob");
const pkg = require(path.join(__dirname, '..', 'package.json'));

// Extract numeric timestamp from migration filename (e.g., 1737999999999_name_migration.js)
function __getMigrationTimestamp(file){
  try{
    const base = path.basename(file);
    const match = /^([0-9]{10,})_/i.exec(base);
    if(match){ return Number(match[1]); }
    const stat = fs.statSync(file);
    return stat.mtimeMs || 0;
  }catch(_){
    return 0;
  }
}


const [,, ...args] = process.argv



program
  .version(pkg.version, '-v, --version')
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

// Support legacy '-V' as an alias to print version
program.option('-V', 'output the version');

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
        if(!contextInstance){
          console.log(`Error - Cannot read or find Context file '${contextFileName}.js' in '${executedLocation}'.`);
          return;
        }
        var snap = {
          file : contextInstance.fileLocation,
          executedLocation : executedLocation,
          contextEntities : [],
          contextFileName: contextFileName.toLowerCase()
        }

        migration.createSnapShot(snap);
        console.log("Migration enabled")

  });

  program
  .command('ensure-database <contextFileName>')
  .alias('ed')
  .description('Ensure the target database exists for the given context (MySQL)')
  .action(function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    try{
      var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
      var files = globSearch.sync(search, executedLocation);
      var file = files && files[0];
      if(!file){
        console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
        return;
      }
      var contextSnapshot;
      try{
        contextSnapshot = require(file);
      }catch(_){
        console.log(`Error - Cannot read context snapshot at '${file}'.`);
        return;
      }
      // Find latest migration file (so we can use its class which extends schema)
      var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
      var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
      if(!(migrationFiles && migrationFiles.length)){
        console.log("Error - Cannot read or find migration file");
        return;
      }
      var mFiles = migrationFiles.slice().sort(function(a, b){
        return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
      });
      var mFile = mFiles[mFiles.length -1];

      let ContextCtor;
      try{
        ContextCtor = require(contextSnapshot.contextLocation);
      }catch(_){
        console.log(`Error - Cannot load Context file at '${contextSnapshot.contextLocation}'.`);
        return;
      }

      // Use the migration class (extends schema) so createdatabase is available
      var MigrationCtor = require(mFile);
      var mig = new MigrationCtor(ContextCtor);
      if(typeof mig.createdatabase === 'function'){
        try{ mig.createdatabase(); }catch(_){ /* best-effort */ }
        console.log('database ensured');
      } else if(typeof mig.createDatabase === 'function'){
        try{ mig.createDatabase(); }catch(_){ }
        console.log('database ensured');
      } else {
        console.log('Error - Migration class missing createDatabase method');
      }
    }catch(e){
      console.log('Error - Cannot read or find file ', e);
    }
  });

  // program
  // .command('create-database <contextFileName> <dbName>')
  // .alias('cd')
  // .description('allows you to create a database')
  // .action(function(contextFileName, dbName){
  //     var executedLocation = process.cwd();
  //     contextFileName = contextFileName.toLowerCase();
          
  //     try{
  //        // find context file from main folder location
  //        // find context file from main folder location
  //        var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
  //        var files = globSearch.sync(search, executedLocation);
  //        var file = files[0];

  //        if(file){
  //           var contextSnapshot = require(file);
  //           var context = require(contextSnapshot.contextLocation);
  //           var newSchema = new schema(context);
  //           newSchema.createDatabase(dbName);
  //        }
  //        else{
  //          console.log("Error - Cannot read or find Context file");
  //         }


  //       }catch (e){
  //         console.log("Error - Cannot read or find file ", e);
  //       }
  //       console.log("Database Created");

  // });


  // Instructions : to run command you must go to folder where migration file is located.
  program
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
        var file = files && files[0];
        if(!file){
          console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'. Run 'masterrecord enable-migrations ${contextFileName}'.`);
          return;
        }
        var contextSnapshot = null;
        try{
          contextSnapshot = require(file);
        }catch(_){
          console.log(`Error - Cannot read context snapshot at '${file}'.`);
          return;
        }

        let ContextCtor;
        try{
          ContextCtor = require(contextSnapshot.contextLocation);
        }catch(_){
          console.log(`Error - Cannot load Context file at '${contextSnapshot.contextLocation}'.`);
          return;
        }
        let contextInstance;
        try{
          contextInstance = new ContextCtor();
        }catch(_){
          console.log(`Error - Failed to construct Context from '${contextSnapshot.contextLocation}'.`);
          return;
        }
        var cleanEntities = migration.cleanEntities(contextInstance.__entities);
        var newEntity = migration.template(name, contextSnapshot.schema, cleanEntities);
        var migrationDate = Date.now();
        var outputFile = `${contextSnapshot.migrationFolder}/${migrationDate}_${name}_migration.js`
        fs.writeFile(outputFile, newEntity, 'utf8', function (err) {
          if (err) return console.log("--- Error running cammand, re-run command add-migration ---- ", err);
        });
        console.log(`${name} migration file created`);
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
          if( migrationFiles && migrationFiles.length){
            // sort by timestamp prefix or file mtime as fallback
            var mFiles = migrationFiles.slice().sort(function(a, b){
              return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
            });
            var mFile = mFiles[mFiles.length -1];

             var migrationProjectFile = require(mFile);
             var context = require(contextSnapshot.contextLocation);
             var contextInstance = new context();
             var newMigrationProjectInstance = new migrationProjectFile(context);

            var cleanEntities = migration.cleanEntities(contextInstance.__entities);
            var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);
             newMigrationProjectInstance.up(tableObj);
            
             var snap = {
               file : contextSnapshot.contextLocation,
               executedLocation : executedLocation,
               context : contextInstance,
               contextEntities : cleanEntities,
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
  .command('update-database-down <contextFileName>')
  .alias('udd')
  .description('Run the latest migration down method for the given context')
  .action(function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    try{
       var search = `${executedLocation}/**/*${contextFileName}_contextSnapShot.json`;
       var files = globSearch.sync(search, executedLocation);
       var file = files && files[0];
       if(!file){
         console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
         return;
       }
       var contextSnapshot;
       try{
         contextSnapshot = require(file);
       }catch(_){
         console.log(`Error - Cannot read context snapshot at '${file}'.`);
         return;
       }
       var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
       var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
       if(!(migrationFiles && migrationFiles.length)){
         console.log("Error - Cannot read or find migration file");
         return;
       }
       // Sort and select latest
       var mFiles = migrationFiles.slice().sort(function(a, b){
         return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
       });
       var latestFile = mFiles[mFiles.length - 1];

       // Prepare context and table object
       let ContextCtor;
       try{
         ContextCtor = require(contextSnapshot.contextLocation);
       }catch(_){
         console.log(`Error - Cannot load Context file at '${contextSnapshot.contextLocation}'.`);
         return;
       }
       var contextInstance;
       try{
         contextInstance = new ContextCtor();
       }catch(_){
         console.log(`Error - Failed to construct Context from '${contextSnapshot.contextLocation}'.`);
         return;
       }
       var cleanEntities = migration.cleanEntities(contextInstance.__entities);
       var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

       var MigCtor = require(latestFile);
       var migInstance = new MigCtor(ContextCtor);
       if(typeof migInstance.down === 'function'){
         migInstance.down(tableObj);
       }else{
         console.log(`Warning - Migration '${path.basename(latestFile)}' has no down method; skipping.`);
       }

       // Update snapshot
       var snap = {
         file : contextSnapshot.contextLocation,
         executedLocation : executedLocation,
         context : contextInstance,
         contextEntities : cleanEntities,
         contextFileName: contextFileName
       }
       migration.createSnapShot(snap);
       console.log("database updated");

    }catch (e){
      console.log("Error - Cannot read or find file ", e);
    }
  });


  program
  .command('update-database-restart <contextFileName>')
  .alias('udr')
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
         if(!file){
           console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
           return;
         }
         var contextSnapshot;
         try{
           contextSnapshot = require(file);
         }catch(_){
           console.log(`Error - Cannot read context snapshot at '${file}'.`);
           return;
         }
         var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
         var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
         if(!(migrationFiles && migrationFiles.length)){
           console.log("Error - Cannot read or find migration file");
           return;
         }
         // organize by time using filename timestamp or file mtime
         var mFiles = migrationFiles.slice().sort(function(a, b){
           return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
         });
         let ContextCtor;
         try{
           ContextCtor = require(contextSnapshot.contextLocation);
         }catch(_){
           console.log(`Error - Cannot load Context file at '${contextSnapshot.contextLocation}'.`);
           return;
         }
         var contextInstance;
         try{
           contextInstance = new ContextCtor();
         }catch(_){
           console.log(`Error - Failed to construct Context from '${contextSnapshot.contextLocation}'.`);
           return;
         }
         var cleanEntities = migration.cleanEntities(contextInstance.__entities);
         for (let i = 0; i < mFiles.length; i++) {
            var migFile = mFiles[i];
            var migrationProjectFile = require(migFile);
            var newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
            var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);
            newMigrationProjectInstance.up(tableObj);
         }
         var snap = {
               file : contextSnapshot.contextLocation,
               executedLocation : executedLocation,
               context : contextInstance,
               contextEntities : cleanEntities,
               contextFileName: contextFileName
             }
 
         migration.createSnapShot(snap);
         console.log("database updated");
 
        }
        catch (e){
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
      if(!file){
        console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
        return;
      }
      var contextSnapshot;
      try{
        contextSnapshot = require(file);
      }catch(_){
        console.log(`Error - Cannot read context snapshot at '${file}'.`);
        return;
      }
      var searchMigration = `${contextSnapshot.migrationFolder}/**/*_migration.js`;
      var migrationFiles = globSearch.sync(searchMigration, contextSnapshot.migrationFolder);
      if(!(migrationFiles && migrationFiles.length)){
        console.log("No migration files found.");
        return;
      }
      var sorted = migrationFiles.slice().sort((a,b) => __getMigrationTimestamp(a) - __getMigrationTimestamp(b));
      // Print relative names for readability
      for(const f of sorted){
        console.log(path.basename(f));
      }
 });

  // we will find the migration folder inside the nearest app folder if no migration folder is location is added
  program
  .command('update-database-target <migrationFileName>')
  .alias('udt')
  .description('Apply pending migrations to database - down method call')
  .action(function(migrationFileName){
  // this will call all the down methods until it gets to the one your looking for. First it needs to validate that there is such a file.
    var executedLocation = process.cwd();
    var migration = new Migration();
    try{
      // Accept either a bare filename or a path; normalize to basename
      var targetName = path.basename(migrationFileName);

      // Locate the target migration file anywhere under the current folder
      var searchTarget = `${executedLocation}/**/${targetName}`;
      var targetMatches = globSearch.sync(searchTarget, executedLocation);
      if(!(targetMatches && targetMatches.length)){
        console.log(`Error - Cannot read or find migration file '${targetName}' in '${executedLocation}'.`);
        return;
      }
      var targetFilePath = targetMatches[0];
      var migrationFolder = path.dirname(targetFilePath);

      // Find the context snapshot within the same migrations folder
      var snapshotMatches = globSearch.sync(`${migrationFolder}/**/*_contextSnapShot.json`, migrationFolder);
      var snapshotFile = snapshotMatches && snapshotMatches[0];
      if(!snapshotFile){
        console.log("Error - Cannot read or find Context snapshot in migration folder.");
        return;
      }

      var contextSnapshot;
      try{
        contextSnapshot = require(snapshotFile);
      }catch(_){
        console.log(`Error - Cannot read context snapshot at '${snapshotFile}'.`);
        return;
      }

      // Get all migration files in this folder
      var allMigrationFiles = globSearch.sync(`${migrationFolder}/**/*_migration.js`, migrationFolder);
      if(!(allMigrationFiles && allMigrationFiles.length)){
        console.log("Error - Cannot read or find migration file");
        return;
      }

      // Sort chronologically
      var sorted = allMigrationFiles.slice().sort(function(a, b){
        return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
      });

      // Find target index by basename match
      var targetIndex = sorted.findIndex(function(f){ return path.basename(f) === targetName; });
      if(targetIndex === -1){
        console.log(`Error - Target migration '${targetName}' not found.`);
        return;
      }

      // Prepare context and table object
      let ContextCtor;
      try{
        ContextCtor = require(contextSnapshot.contextLocation);
      }catch(_){
        console.log(`Error - Cannot load Context file at '${contextSnapshot.contextLocation}'.`);
        return;
      }
      var contextInstance;
      try{
        contextInstance = new ContextCtor();
      }catch(_){
        console.log(`Error - Failed to construct Context from '${contextSnapshot.contextLocation}'.`);
        return;
      }
      var cleanEntities = migration.cleanEntities(contextInstance.__entities);
      var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

      // Roll back (down) all migrations newer than the target (i.e., strictly after targetIndex)
      for (var i = sorted.length - 1; i > targetIndex; i--) {
        var migFile = sorted[i];
        var MigCtor = require(migFile);
        var migInstance = new MigCtor(ContextCtor);
        if(typeof migInstance.down === 'function'){
          migInstance.down(tableObj);
        } else {
          console.log(`Warning - Migration '${path.basename(migFile)}' has no down method; skipping.`);
        }
      }

      // Update snapshot
      var snap = {
        file : contextSnapshot.contextLocation,
        executedLocation : executedLocation,
        context : contextInstance,
        contextEntities : cleanEntities,
        contextFileName: path.basename(snapshotFile).replace('_contextSnapShot.json','')
      }
      migration.createSnapShot(snap);
      console.log("database updated");

    }catch (e){
      console.log("Error - Cannot read or find file ", e);
    }
  });


program.parse(process.argv);

// Handle manual '-V' alias
const opts = program.opts();
if (opts && opts.V) {
  console.log(pkg.version);
}