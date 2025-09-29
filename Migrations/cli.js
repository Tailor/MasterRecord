#!/usr/bin/env node

// version 0.0.7
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
      var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
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
      var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
      migrationFiles = (migrationFiles || []).map(f => path.resolve(contextSnapshot.migrationFolder, f));
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
        var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
        var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
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

        // Resolve relative paths from the snapshot directory (portable snapshots)
        const snapDir = path.dirname(file);
        const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
        const migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');

        let ContextCtor;
        try{
          ContextCtor = require(contextAbs);
        }catch(_){
          console.log(`Error - Cannot load Context file at '${contextAbs}'.`);
          return;
        }
        let contextInstance;
        try{
          contextInstance = new ContextCtor();
        }catch(_){
          console.log(`Error - Failed to construct Context from '${contextAbs}'.`);
          return;
        }
        var cleanEntities = migration.cleanEntities(contextInstance.__entities);

        // Skip if no changes between snapshot schema and current entities
        const has = migration.hasChanges(contextSnapshot.schema || [], cleanEntities || []);
        if(!has){
          console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
          return;
        }

        var newEntity = migration.template(name, contextSnapshot.schema, cleanEntities);
        if(!fs.existsSync(migBase)){
          try{ fs.mkdirSync(migBase, { recursive: true }); }catch(_){ /* ignore */ }
        }
        var migrationDate = Date.now();
        var outputFile = `${migBase}/${migrationDate}_${name}_migration.js`
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
         // find context snapshot (cwd-based glob)
         var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
         var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
         if(file){
          var contextSnapshot = require(file);
          var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
          migrationFiles = (migrationFiles || []).map(f => path.resolve(contextSnapshot.migrationFolder, f));
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
       var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
       var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
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
       var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
       migrationFiles = (migrationFiles || []).map(f => path.resolve(contextSnapshot.migrationFolder, f));
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
         // find context snapshot (cwd-based glob)
         var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
         var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
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
         var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
         migrationFiles = (migrationFiles || []).map(f => path.resolve(contextSnapshot.migrationFolder, f));
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
      var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
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
      var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
      if(!(migrationFiles && migrationFiles.length)){
        console.log("No migration files found.");
        return;
      }
      var sorted = migrationFiles.slice().sort((a,b) => __getMigrationTimestamp(path.resolve(contextSnapshot.migrationFolder, a)) - __getMigrationTimestamp(path.resolve(contextSnapshot.migrationFolder, b)));
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
      var targetMatches = globSearch.sync(`**/${targetName}`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true });
      if(!(targetMatches && targetMatches.length)){
        console.log(`Error - Cannot read or find migration file '${targetName}' in '${executedLocation}'.`);
        return;
      }
      var targetFilePath = path.resolve(executedLocation, targetMatches[0]);
      var migrationFolder = path.dirname(targetFilePath);

      // Find the context snapshot within the same migrations folder
      var snapshotMatches = globSearch.sync(`**/*_contextSnapShot.json`, { cwd: migrationFolder, dot: true, windowsPathsNoEscape: true });
      var snapshotFile = snapshotMatches && snapshotMatches[0] ? path.resolve(migrationFolder, snapshotMatches[0]) : null;
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
      var allMigrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: migrationFolder, dot: true, windowsPathsNoEscape: true });
      if(!(allMigrationFiles && allMigrationFiles.length)){
        console.log("Error - Cannot read or find migration file");
        return;
      }

      // Sort chronologically
      var sorted = allMigrationFiles.slice().sort(function(a, b){
        return __getMigrationTimestamp(path.resolve(migrationFolder, a)) - __getMigrationTimestamp(path.resolve(migrationFolder, b));
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
        var migFile = path.resolve(migrationFolder, sorted[i]);
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


  program
  .command('add-migration-all <name>')
  .alias('ama')
  .description('Create a migration with the given name for all detected contexts')
  .action(function(name){
    var executedLocation = process.cwd();
    try{
      var snapshotFiles = globSearch.sync('**/*_contextSnapShot.json', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      if(!(snapshotFiles && snapshotFiles.length)){
        console.log('No context snapshots found. Run enable-migrations-all first.');
        return;
      }
      var created = 0;
      for(const snapRel of snapshotFiles){
        try{
          const snapFile = path.resolve(executedLocation, snapRel);
          let cs;
          try{ cs = require(snapFile); }catch(_){ continue; }
          const snapDir = path.dirname(snapFile);
          const contextAbs = path.resolve(snapDir, cs.contextLocation || '');
          const migBase = path.resolve(snapDir, cs.migrationFolder || '.');
          // Load context
          let ContextCtor;
          try{ ContextCtor = require(contextAbs); }catch(_){
            console.log(`Skipping: cannot load Context at '${contextAbs}'.`);
            continue;
          }
          let contextInstance;
          try{ contextInstance = new ContextCtor(); }catch(_){
            console.log(`Skipping: failed to construct Context from '${contextAbs}'.`);
            continue;
          }
          var migration = new Migration();
          var cleanEntities = migration.cleanEntities(contextInstance.__entities);
          // If no changes, skip with message
          const has = migration.hasChanges(cs.schema || [], cleanEntities || []);
          if(!has){
            console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
            continue;
          }
          var newEntity = migration.template(name, cs.schema, cleanEntities);
          if(!fs.existsSync(migBase)){
            try{ fs.mkdirSync(migBase, { recursive: true }); }catch(_){ /* ignore */ }
          }
          var migrationDate = Date.now();
          var outputFile = path.join(migBase, `${migrationDate}_${name}_migration.js`);
          fs.writeFileSync(outputFile, newEntity, 'utf8');
          console.log(`Created migration '${path.basename(outputFile)}' for ${path.basename(contextAbs)}`);
          created++;
        }catch(err){
          console.log('Skipping snapshot due to error: ', err);
        }
      }
      if(created === 0){
        console.log('No migrations created.');
      }
    }catch(e){
      console.log('Error - Cannot create migrations for all contexts ', e);
    }
  });

  program
  .command('update-database-all')
  .alias('uda')
  .description('Scan the project for *Context.js files and run update-database on each')
  .action(function(){
    var executedLocation = process.cwd();
    try{
      // Find all context snapshots and run update per snapshot (avoids unrelated framework contexts)
      var snapshotFiles = globSearch.sync('**/*_contextSnapShot.json', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      if(!(snapshotFiles && snapshotFiles.length)){
        console.log('No context snapshots found. Run enable-migrations for each context first.');
        return;
      }
      // Group snapshots by context name (case-insensitive) and pick best per group
      var groups = {};
      for(const snapRel of snapshotFiles){
        const snapFile = path.resolve(executedLocation, snapRel);
        let cs;
        try{ cs = require(snapFile); }catch(_){ continue; }
        const snapDir = path.dirname(snapFile);
        const contextAbs = path.resolve(snapDir, cs.contextLocation || '');
        let migBase = path.resolve(snapDir, cs.migrationFolder || '.');
        const nameFromPath = path.basename(snapFile).replace(/_contextSnapShot\.json$/i, '').toLowerCase();
        const ctxName = contextAbs ? path.basename(contextAbs).replace(/\.js$/i, '').toLowerCase() : nameFromPath;
        // Find migrations in snapshot's migrationFolder; fallback to <ContextDir>/db/migrations
        let migRel = globSearch.sync('**/*_migration.js', { cwd: migBase, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
        if(!(migRel && migRel.length)){
          const defaultFolder = path.join(path.dirname(contextAbs || snapFile), 'db', 'migrations');
          migRel = globSearch.sync('**/*_migration.js', { cwd: defaultFolder, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
          if(migRel && migRel.length){ migBase = defaultFolder; }
        }
        const migs = migRel.map(f => path.resolve(migBase, f));
        if(!groups[ctxName]) groups[ctxName] = [];
        groups[ctxName].push({ snapFile, snapDir, cs, ctxName, migs, contextAbs, migBase });
      }

      var migration = new Migration();
      var ctxNames = Object.keys(groups);
      for(const name of ctxNames){
        try{
          var list = groups[name];
          // Prefer entries that actually have migration files
          var withMigs = list.filter(e => e.migs && e.migs.length > 0);
          var entry = withMigs.length ? withMigs[withMigs.length - 1] : list[0];
          if(!(entry.migs && entry.migs.length)){
            console.log(`Skipping ${entry.ctxName}: no migration files found.`);
            continue;
          }
          var mFiles = entry.migs.slice().sort(function(a, b){
            return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
          });
          var mFile = mFiles[mFiles.length - 1];

          var ContextCtor;
          try{ ContextCtor = require(entry.contextAbs); }catch(_){
            console.log(`Skipping ${entry.ctxName}: cannot load Context at '${entry.contextAbs}'.`);
            continue;
          }
          var contextInstance;
          try{ contextInstance = new ContextCtor(); }catch(_){
            console.log(`Skipping ${entry.ctxName}: failed to construct Context.`);
            continue;
          }
          var migrationProjectFile = require(mFile);
          var newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
          var cleanEntities = migration.cleanEntities(contextInstance.__entities);
          var tableObj = migration.buildUpObject(entry.cs.schema, cleanEntities);
          newMigrationProjectInstance.up(tableObj);
          var snap = {
            file : entry.contextAbs,
            executedLocation : executedLocation,
            context : contextInstance,
            contextEntities : cleanEntities,
            contextFileName: entry.ctxName
          }
          migration.createSnapShot(snap);
          console.log(`database updated for ${entry.ctxName}`);
        }catch(errCtx){
          console.log('Error updating context: ', errCtx);
        }
      }
    }catch(e){
      console.log('Error - Cannot read or find file ', e);
    }
  });

  program
  .command('enable-migrations-all')
  .alias('ema')
  .description('Enable migrations for all detected MasterRecord Context files')
  .action(function(){
    var executedLocation = process.cwd();
    try{
      // Find candidate Context files
      var candidates = globSearch.sync('**/*Context.js', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
      if(!(candidates && candidates.length)){
        console.log('No Context files found.');
        return;
      }
      var seen = new Set();
      var enabled = 0;
      var migration = new Migration();
      for(const rel of candidates){
        try{
          const abs = path.resolve(executedLocation, rel);
          // Skip node_modules
          if(abs.indexOf('node_modules') !== -1){ continue; }
          // Heuristic filter: file must look like a MasterRecord context
          let text = '';
          try{ text = fs.readFileSync(abs, 'utf8'); }catch(_){ continue; }
          const looksLikeContext = /extends\s+masterrecord\.context/i.test(text) || /require\(['"]masterrecord['"]\)/i.test(text);
          if(!looksLikeContext){ continue; }
          const ctxName = path.basename(abs).replace(/\.js$/i,'');
          const key = ctxName.toLowerCase();
          if(seen.has(key)){ continue; }
          seen.add(key);
          // Create snapshot relative to the context file directory
          var snap = {
            file : abs,
            executedLocation : executedLocation,
            contextEntities : [],
            contextFileName: key
          };
          migration.createSnapShot(snap);
          console.log(`migrations enabled for ${ctxName}`);
          enabled++;
        }catch(err){
          console.log('Skipping candidate due to error: ', err);
        }
      }
      if(enabled === 0){
        console.log('No eligible MasterRecord Contexts detected.');
      }
    }catch(e){
      console.log('Error - Failed to enable migrations for all contexts ', e);
    }
  });


program.parse(process.argv);

// Handle manual '-V' alias
const opts = program.opts();
if (opts && opts.V) {
  console.log(pkg.version);
}