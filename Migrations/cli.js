#!/usr/bin/env node

// version 0.0.8
// https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
// how to add environment variables on cli call example - master=development masterrecord add-migration auth authContext

const { program } = require('commander');
let fs = require('fs');
let path = require('path');
const { pathToFileURL } = require('node:url');
const Module = require('module');
const { resolveMigrationsDirectory } = require('./pathUtils');

/**
 * Load a user module (context, migration) via dynamic import.
 *
 * Handles both CJS and ESM targets. Required because:
 *  - CJS require() of an ESM file throws on older Node, or returns a Module
 *    namespace on newer Node (22.12+) — neither shape matches the
 *    `new ContextCtor()` pattern downstream.
 *  - await import() works in both directions and is consistent across Node
 *    versions.
 *
 * The returned value is unwrapped: ESM `export default X` -> X;
 * CJS `module.exports = X` -> X; mixed shapes are handled via `.default ?? mod`.
 *
 * @param {string} filePath - Absolute path to the user file
 * @returns {Promise<*>} The default export (or whole module if no default)
 */
async function __loadUserModule(filePath) {
  const mod = await import(pathToFileURL(filePath).href);
  return (mod && mod.default !== undefined) ? mod.default : mod;
}

/**
 * Walk up from a given directory looking for the host project's package.json
 * and return whether it declares ESM (`"type": "module"`) or CJS.
 * Used when generating migration files so the emitted syntax matches the
 * host project's module type. Masterrecord's own package.json is skipped.
 *
 * @param {string} startDir - Directory to walk up from
 * @returns {'esm' | 'cjs'}
 */
function __detectHostModuleType(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'masterrecord') {
          // Skip our own package.json — keep walking up to the host project
        } else {
          return (pkg && pkg.type === 'module') ? 'esm' : 'cjs';
        }
      } catch (_) { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'cjs';
}
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

// Helper to cleanup context and exit
async function __cleanupAndExit(contextInstance, exitCode = 0) {
  try {
    if (contextInstance && typeof contextInstance.close === 'function') {
      await contextInstance.close();
    }
  } catch(err) {
    console.error('Warning: Error during cleanup:', err.message);
  } finally {
    process.exit(exitCode);
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
  .action(async function(contextFileName){
        try {
          var migration = new Migration();
          // location of folder where command is being executed..
          var executedLocation = process.cwd();
          // find context file from main folder location
          var contextFile = migration.findContextFile(executedLocation, contextFileName);
          if(!contextFile){
            console.error(`\n❌ Error - Cannot read or find Context file '${contextFileName}.js'`);
            console.error(`\nSearched in: ${executedLocation}`);
            console.error(`\nMake sure your Context file exists and is named correctly.`);
            process.exit(1);
          }
          var snap = {
            file : contextFile,
            executedLocation : executedLocation,
            contextEntities : [],
            contextFileName: contextFileName.toLowerCase()
          }

          migration.createSnapShot(snap);
          console.log("✓ Migration enabled successfully")
          process.exit(0);
        } catch(err) {
          console.error('Error:', err);
          process.exit(1);
        }
  });

  program
  .command('ensure-database <contextFileName>')
  .alias('ed')
  .description('Ensure the target database exists for the given context (MySQL)')
  .action(async function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    var contextInstance = null;
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
      const snapDir = path.dirname(file);
      const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
      let migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
      if (!fs.existsSync(migBase)) {
        console.warn(`⚠️  Resolved migration path does not exist: ${migBase}`);
        console.warn(`   Falling back to snapshot directory: ${snapDir}`);
        migBase = snapDir;
      }
      // Find latest migration file (so we can use its class which extends schema)
      var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
      migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));
      if(!(migrationFiles && migrationFiles.length)){
        console.log("Error - Cannot read or find migration file");
        process.exit(1);
      }
      var mFiles = migrationFiles.slice().sort(function(a, b){
        return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
      });
      var mFile = mFiles[mFiles.length -1];

      let ContextCtor;
      try{
        ContextCtor = await __loadUserModule(contextAbs);
      }catch(err){
        console.error(`\n❌ Error - Cannot load Context file at '${contextAbs}'`);
        console.error(`\nDetails:`);
        console.error(err.message);
        if(err.stack){
          console.error(`\nStack trace:`);
          console.error(err.stack);
        }
        process.exit(1);
      }

      // Use the migration class (extends schema) so createdatabase is available
      var MigrationCtor = await __loadUserModule(mFile);
      var mig = new MigrationCtor(ContextCtor);
      contextInstance = mig._context || mig.context || null;

      if(typeof mig.createdatabase === 'function'){
        try{
          await mig.createdatabase();
          console.log('✓ Database ensured');
          await __cleanupAndExit(contextInstance, 0);
        }catch(err){
          console.error(`\n❌ Error creating database:`);
          console.error(err.message);
          await __cleanupAndExit(contextInstance, 1);
        }
      } else if(typeof mig.createDatabase === 'function'){
        try{
          await mig.createDatabase();
          console.log('✓ Database ensured');
          await __cleanupAndExit(contextInstance, 0);
        }catch(err){
          console.error(`\n❌ Error creating database:`);
          console.error(err.message);
          await __cleanupAndExit(contextInstance, 1);
        }
      } else {
        console.error('❌ Error - Migration class missing createDatabase method');
        await __cleanupAndExit(contextInstance, 1);
      }
    }catch(e){
      console.log('Error - Cannot read or find file ', e);
      await __cleanupAndExit(contextInstance, 1);
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
  .action(async function(name, contextFileName){
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
        let migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
        if (!fs.existsSync(migBase)) {
          console.warn(`⚠️  Resolved migration path does not exist: ${migBase}`);
          console.warn(`   Falling back to snapshot directory: ${snapDir}`);
          migBase = snapDir;
        }

        let ContextCtor;
        try{
          ContextCtor = await __loadUserModule(contextAbs);
        }catch(err){
          console.error(`\n❌ Error - Cannot load Context file at '${contextAbs}'`);
          console.error(`\nDetails:`);
          console.error(err.message);
          if(err.stack){
            console.error(`\nStack trace:`);
            console.error(err.stack);
          }
          return;
        }
        let contextInstance;
        try{
          process.env.MASTERRECORD_SCHEMA_ONLY = '1';
          contextInstance = new ContextCtor();
          delete process.env.MASTERRECORD_SCHEMA_ONLY;
        }catch(err){
          delete process.env.MASTERRECORD_SCHEMA_ONLY;
          console.error(`\n❌ Error - Failed to construct Context from '${contextAbs}'`);
          console.error(`\nThis usually happens when:`);
          console.error(`  • Environment configuration is missing or invalid`);
          console.error(`  • Database connection settings are incorrect`);
          console.error(`  • Required dependencies are not installed`);
          console.error(`\nDetails:`);
          console.error(err.message);
          if(err.stack){
            console.error(`\nStack trace:`);
            console.error(err.stack);
          }
          return;
        }
        var cleanEntities = migration.cleanEntities(contextInstance.__entities);
        var seedData = contextInstance.__contextSeedData || {};
        var seedConfig = contextInstance.__contextSeedConfig || {};

        // Skip if no changes between snapshot schema and current entities
        const has = migration.hasChanges(contextSnapshot.schema || [], cleanEntities || [], seedData);
        if(!has){
          console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
          return;
        }

        // Emit the migration file in whatever module format the host project uses,
        // so the generated .js file parses correctly when loaded by update-database.
        var moduleType = __detectHostModuleType(path.dirname(contextAbs));
        var newEntity = migration.template(name, contextSnapshot.schema, cleanEntities, seedData, seedConfig, null, moduleType);
        if(!fs.existsSync(migBase)){
          try{ fs.mkdirSync(migBase, { recursive: true }); }catch(_){ /* ignore */ }
        }
        var migrationDate = Date.now();
        var outputFile = `${migBase}/${migrationDate}_${name}_migration.js`
        fs.writeFile(outputFile, newEntity, 'utf8', function (err) {
          if (err) {
            console.log("--- Error running cammand, re-run command add-migration ---- ", err);
            process.exit(1);
          }
          console.log(`✓ Migration '${name}' created successfully at ${outputFile}`);
          process.exit(0);
        });
       }catch (e){
         console.log("Error - Cannot read or find file ", e);
         process.exit(1);
      }
  });

 program
  .command('update-database <contextFileName>')
  .alias('ud')
  .description('Apply pending migrations to database - up method call')
  .action(async function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    var contextInstance = null;
      try{
         console.log(`\n🔍 Searching for context snapshot '${contextFileName}_contextSnapShot.json'...`);
         // find context snapshot (cwd-based glob)
         var files = globSearch.sync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
         var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;

         if(!file){
           console.error(`\n❌ Error - Cannot find Context snapshot file`);
           console.error(`\nSearched for: ${contextFileName}_contextSnapShot.json`);
           console.error(`Searched in: ${executedLocation}`);
           console.error(`\n💡 Solution: Run 'masterrecord enable-migrations ${contextFileName}' first`);
           await __cleanupAndExit(contextInstance, 1);
         }

         console.log(`✓ Found snapshot: ${file}`);

         var contextSnapshot;
         try{
           contextSnapshot = require(file);
         }catch(err){
           console.error(`\n❌ Error - Cannot load context snapshot`);
           console.error(`\nFile: ${file}`);
           console.error(`Details: ${err.message}`);
           await __cleanupAndExit(contextInstance, 1);
         }

         const snapDir = path.dirname(file);
         const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
         let migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
         if (!fs.existsSync(migBase)) {
           console.warn(`⚠️  Resolved migration path does not exist: ${migBase}`);
           console.warn(`   Falling back to snapshot directory: ${snapDir}`);
           migBase = snapDir;
         }

         console.log(`\n🔍 Searching for migration files in: ${migBase}`);
         var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
         migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));

         if(!(migrationFiles && migrationFiles.length)){
           console.error(`\n❌ Error - No migration files found`);
           console.error(`\nSearched in: ${migBase}`);
           console.error(`\n💡 Solution: Run 'masterrecord add-migration Init ${contextFileName}' to create your first migration`);
           await __cleanupAndExit(contextInstance, 1);
         }

         // sort by timestamp prefix or file mtime as fallback
         var mFiles = migrationFiles.slice().sort(function(a, b){
           return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
         });
         var mFile = mFiles[mFiles.length -1];
         console.log(`✓ Found ${mFiles.length} migration file(s), using latest: ${path.basename(mFile)}`);

         console.log(`\n🔍 Loading Context file from: ${contextAbs}`);
         var migrationProjectFile;
         var ContextCtor;
         try{
           migrationProjectFile = await __loadUserModule(mFile);
           ContextCtor = await __loadUserModule(contextAbs);
         }catch(err){
           console.error(`\n❌ Error - Cannot load Context or migration file`);
           console.error(`\nContext file: ${contextAbs}`);
           console.error(`Migration file: ${mFile}`);
           console.error(`\nDetails: ${err.message}`);
           if(err.stack){
             console.error(`\nStack trace:`);
             console.error(err.stack);
           }
           await __cleanupAndExit(contextInstance, 1);
         }

         console.log(`✓ Context file loaded successfully`);
         console.log(`\n🔍 Instantiating Context (this will create the database if it doesn't exist)...`);

         try{
           contextInstance = new ContextCtor();
         }catch(err){
           console.error(`\n❌ Error - Failed to instantiate Context`);
           console.error(`\nContext file: ${contextAbs}`);
           console.error(`\nThis usually happens when:`);
           console.error(`  • Environment configuration file is missing`);
           console.error(`  • Database connection settings are incorrect`);
           console.error(`  • The 'master' environment variable is not set`);
           console.error(`  • Required dependencies are not installed`);
           console.error(`\nDetails: ${err.message}`);
           if(err.stack){
             console.error(`\nStack trace:`);
             console.error(err.stack);
           }
           console.error(`\n💡 Check your environment config file (e.g., config/environments/env.development.json)`);
           console.error(`💡 Make sure you're running: master=development masterrecord update-database ${contextFileName}`);
           await __cleanupAndExit(contextInstance, 1);
         }

         console.log(`✓ Context instantiated successfully`);

         // Log database connection details
         if(contextInstance.isSQLite && contextInstance.db){
           const dbPath = contextInstance.db.name || 'unknown';
           console.log(`\n📊 Database Type: SQLite`);
           console.log(`📁 Database Path: ${dbPath}`);

           // Check if the database file exists
           if(fs.existsSync(dbPath)){
             const stats = fs.statSync(dbPath);
             console.log(`✓ Database file exists (${(stats.size / 1024).toFixed(2)} KB)`);
           }else{
             console.log(`⚠️  Database file does not exist yet (will be created during migration)`);
           }
         }else if(contextInstance.isMySQL){
           console.log(`\n📊 Database Type: MySQL`);
         }

         console.log(`\n🔍 Loading entities from context...`);
         var cleanEntities = migration.cleanEntities(contextInstance.__entities);
         console.log(`✓ Found ${cleanEntities.length} entity/entities`);

         if(cleanEntities.length === 0){
           console.error(`\n⚠️  Warning - No entities found in Context`);
           console.error(`\nMake sure your Context file has dbset() calls to register entities`);
           console.error(`Example:`);
           console.error(`  this.dbset(User, 'User');`);
           console.error(`  this.dbset(Post, 'Post');`);
         }

         console.log(`\n🚀 Running migration...`);
         try{
           var newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
           var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);
           await newMigrationProjectInstance.up(tableObj);
         }catch(err){
           console.error(`\n❌ Error - Migration failed during execution`);
           console.error(`\nMigration file: ${mFile}`);
           console.error(`\nDetails: ${err.message}`);
           if(err.stack){
             console.error(`\nStack trace:`);
             console.error(err.stack);
           }
           await __cleanupAndExit(contextInstance, 1);
         }

         console.log(`\n💾 Updating snapshot...`);
         var snap = {
           file : contextAbs,
           executedLocation : executedLocation,
           context : contextInstance,
           contextEntities : cleanEntities,
           contextSeedData: contextInstance.__contextSeedData || {},
           contextFileName: contextFileName
         }

         migration.createSnapShot(snap);
         console.log(`\n✅ Database updated successfully!`);

         // Final verification for SQLite
         if(contextInstance.isSQLite && contextInstance.db){
           const dbPath = contextInstance.db.name || 'unknown';
           if(fs.existsSync(dbPath)){
             const stats = fs.statSync(dbPath);
             console.log(`\n📁 Database file: ${dbPath}`);
             console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
           }else{
             console.error(`\n⚠️  Warning - Database file was not created at expected path: ${dbPath}`);
           }
         }

         await __cleanupAndExit(contextInstance, 0);
        }catch (e){
          console.error(`\n❌ Unexpected error during update-database`);
          console.error(`\nDetails: ${e.message}`);
          if(e.stack){
            console.error(`\nStack trace:`);
            console.error(e.stack);
          }
          await __cleanupAndExit(contextInstance, 1);
        }
  });


  program
  .command('update-database-down <contextFileName>')
  .alias('udd')
  .description('Run the latest migration down method for the given context')
  .action(async function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    var contextInstance = null;
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
       const snapDir = path.dirname(file);
       const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
       const migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
       var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
       migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));
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
         ContextCtor = await __loadUserModule(contextAbs);
       }catch(err){
         console.error(`\n❌ Error - Cannot load Context file at '${contextAbs}'`);
         console.error(`\nDetails:`);
         console.error(err.message);
         if(err.stack){
           console.error(`\nStack trace:`);
           console.error(err.stack);
         }
         return;
       }
       var contextInstance;
       try{
         contextInstance = new ContextCtor();
       }catch(err){
         console.error(`\n❌ Error - Failed to construct Context from '${contextAbs}'`);
         console.error(`\nThis usually happens when:`);
         console.error(`  • Environment configuration is missing or invalid`);
         console.error(`  • Database connection settings are incorrect`);
         console.error(`  • Required dependencies are not installed`);
         console.error(`\nDetails:`);
         console.error(err.message);
         if(err.stack){
           console.error(`\nStack trace:`);
           console.error(err.stack);
         }
         return;
       }
       var cleanEntities = migration.cleanEntities(contextInstance.__entities);
       var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

       var MigCtor = await __loadUserModule(latestFile);
       var migInstance = new MigCtor(ContextCtor);
       if(typeof migInstance.down === 'function'){
         await migInstance.down(tableObj);
       }else{
         console.log(`Warning - Migration '${path.basename(latestFile)}' has no down method; skipping.`);
       }

       // Update snapshot
       var snap = {
         file : contextAbs,
         executedLocation : executedLocation,
         context : contextInstance,
         contextEntities : cleanEntities,
         contextSeedData: contextInstance.__contextSeedData || {},
         contextSeedConfig: contextInstance.__contextSeedConfig || {},
         contextFileName: contextFileName
       }
       migration.createSnapShot(snap);
       console.log("✓ Database rolled back successfully");
       await __cleanupAndExit(contextInstance, 0);

    }catch (e){
      console.log("Error - Cannot read or find file ", e);
      await __cleanupAndExit(contextInstance, 1);
    }
  });


  program
  .command('update-database-restart <contextFileName>')
  .alias('udr')
  .description('Apply pending migrations to database - up method call')
  .action(async function(contextFileName){
    var executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    var migration = new Migration();
    var contextInstance = null;
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
      const snapDir = path.dirname(file);
      const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
      const migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
      var migrationFiles = globSearch.sync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
      migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));
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
           ContextCtor = await __loadUserModule(contextAbs);
         }catch(err){
           console.error(`\n❌ Error - Cannot load Context file at '${contextAbs}'`);
           console.error(`\nDetails:`);
           console.error(err.message);
           if(err.stack){
             console.error(`\nStack trace:`);
             console.error(err.stack);
           }
           return;
         }
         var contextInstance;
         try{
           contextInstance = new ContextCtor();
         }catch(err){
           console.error(`\n❌ Error - Failed to construct Context from '${contextAbs}'`);
           console.error(`\nThis usually happens when:`);
           console.error(`  • Environment configuration is missing or invalid`);
           console.error(`  • Database connection settings are incorrect`);
           console.error(`  • Required dependencies are not installed`);
           console.error(`\nDetails:`);
           console.error(err.message);
           if(err.stack){
             console.error(`\nStack trace:`);
             console.error(err.stack);
           }
           return;
         }
         var cleanEntities = migration.cleanEntities(contextInstance.__entities);
         for (let i = 0; i < mFiles.length; i++) {
            var migFile = mFiles[i];
            var migrationProjectFile = await __loadUserModule(migFile);
            var newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
            var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);
            await newMigrationProjectInstance.up(tableObj);
         }
         const snap = {
               file : contextAbs,
               executedLocation : executedLocation,
               context : contextInstance,
               contextEntities : cleanEntities,
               contextFileName: contextFileName
             }

         migration.createSnapShot(snap);
         console.log("✓ Database restarted and updated successfully");
         await __cleanupAndExit(contextInstance, 0);

        }
        catch (e){
          console.log("Error - Cannot read or find file ", e);
          await __cleanupAndExit(contextInstance, 1);
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
  .action(async function(migrationFileName){
  // this will call all the down methods until it gets to the one your looking for. First it needs to validate that there is such a file.
    var executedLocation = process.cwd();
    var migration = new Migration();
    var contextInstance = null;
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
        ContextCtor = await __loadUserModule(contextAbs);
      }catch(err){
        console.error(`\n❌ Error - Cannot load Context file at '${contextAbs}'`);
        console.error(`\nDetails:`);
        console.error(err.message);
        if(err.stack){
          console.error(`\nStack trace:`);
          console.error(err.stack);
        }
        return;
      }
      var contextInstance;
      try{
        contextInstance = new ContextCtor();
      }catch(err){
        console.error(`\n❌ Error - Failed to construct Context from '${contextAbs}'`);
        console.error(`\nThis usually happens when:`);
        console.error(`  • Environment configuration is missing or invalid`);
        console.error(`  • Database connection settings are incorrect`);
        console.error(`  • Required dependencies are not installed`);
        console.error(`\nDetails:`);
        console.error(err.message);
        if(err.stack){
          console.error(`\nStack trace:`);
          console.error(err.stack);
        }
        return;
      }
      var cleanEntities = migration.cleanEntities(contextInstance.__entities);
      var tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

      // Roll back (down) all migrations newer than the target (i.e., strictly after targetIndex)
      for (var i = sorted.length - 1; i > targetIndex; i--) {
        var migFile = path.resolve(migrationFolder, sorted[i]);
        var MigCtor = await __loadUserModule(migFile);
        var migInstance = new MigCtor(ContextCtor);
        if(typeof migInstance.down === 'function'){
          await migInstance.down(tableObj);
        } else {
          console.log(`Warning - Migration '${path.basename(migFile)}' has no down method; skipping.`);
        }
      }

      // Update snapshot
      var snap = {
        file : contextAbs,
        executedLocation : executedLocation,
        context : contextInstance,
        contextEntities : cleanEntities,
        contextSeedData: contextInstance.__contextSeedData || {},
        contextSeedConfig: contextInstance.__contextSeedConfig || {},
        contextFileName: path.basename(snapshotFile).replace('_contextSnapShot.json','')
      }
      migration.createSnapShot(snap);
      console.log("✓ Database rolled back to target migration successfully");
      await __cleanupAndExit(contextInstance, 0);

    }catch (e){
      console.log("Error - Cannot read or find file ", e);
      await __cleanupAndExit(contextInstance, 1);
    }
  });


  program
  .command('add-migration-all <name>')
  .alias('ama')
  .description('Create a migration with the given name for all detected contexts')
  .action(async function(name){
    var executedLocation = process.cwd();
    var contextInstances = [];
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
          try{
            ContextCtor = await __loadUserModule(contextAbs);
          }catch(err){
            console.error(`⚠️  Skipping ${path.basename(contextAbs)}: cannot load Context file`);
            console.error(`   Details: ${err.message}`);
            continue;
          }
          let contextInstance;
          try{
            contextInstance = new ContextCtor();
            contextInstances.push(contextInstance);
          }catch(err){
            console.error(`⚠️  Skipping ${path.basename(contextAbs)}: failed to construct Context`);
            console.error(`   Details: ${err.message}`);
            continue;
          }
          var migration = new Migration();
          var cleanEntities = migration.cleanEntities(contextInstance.__entities);
          var seedData = contextInstance.__contextSeedData || {};
          var seedConfig = contextInstance.__contextSeedConfig || {};
          // If no changes, skip with message
          const has = migration.hasChanges(cs.schema || [], cleanEntities || [], seedData);
          if(!has){
            console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
            continue;
          }
          var moduleType = __detectHostModuleType(path.dirname(contextAbs));
          var newEntity = migration.template(name, cs.schema, cleanEntities, seedData, seedConfig, null, moduleType);
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
      // Cleanup all contexts
      for(const ctx of contextInstances) {
        if (ctx && typeof ctx.close === 'function') {
          await ctx.close();
        }
      }
      process.exit(0);
    }catch(e){
      console.log('Error - Cannot create migrations for all contexts ', e);
      // Cleanup all contexts
      for(const ctx of contextInstances) {
        if (ctx && typeof ctx.close === 'function') {
          await ctx.close();
        }
      }
      process.exit(1);
    }
  });

  program
  .command('update-database-all')
  .alias('uda')
  .description('Scan the project for *Context.js files and run update-database on each')
  .action(async function(){
    var executedLocation = process.cwd();
    var contextInstances = [];
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
          // Fallback: find migrations directory using shared utility (prevents duplicate paths)
          const defaultFolder = resolveMigrationsDirectory(contextAbs || snapFile);
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
          try{
            ContextCtor = await __loadUserModule(entry.contextAbs);
          }catch(err){
            console.error(`⚠️  Skipping ${entry.ctxName}: cannot load Context file`);
            console.error(`   Details: ${err.message}`);
            continue;
          }
          var contextInstance;
          try{
            contextInstance = new ContextCtor();
            contextInstances.push(contextInstance);
          }catch(err){
            console.error(`⚠️  Skipping ${entry.ctxName}: failed to construct Context`);
            console.error(`   Details: ${err.message}`);
            continue;
          }
          var migrationProjectFile = await __loadUserModule(mFile);
          var newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
          var cleanEntities = migration.cleanEntities(contextInstance.__entities);
          var tableObj = migration.buildUpObject(entry.cs.schema, cleanEntities);
          await newMigrationProjectInstance.up(tableObj);
          var snap = {
            file : entry.contextAbs,
            executedLocation : executedLocation,
            context : contextInstance,
            contextEntities : cleanEntities,
            contextSeedData: contextInstance.__contextSeedData || {},
            contextSeedConfig: contextInstance.__contextSeedConfig || {},
            contextFileName: entry.ctxName
          }
          migration.createSnapShot(snap);
          console.log(`✓ Database updated successfully for ${entry.ctxName}`);
        }catch(errCtx){
          console.log('Error updating context: ', errCtx);
        }
      }
      // Cleanup all contexts
      for(const ctx of contextInstances) {
        if (ctx && typeof ctx.close === 'function') {
          await ctx.close();
        }
      }
      process.exit(0);
    }catch(e){
      console.log('Error - Cannot read or find file ', e);
      // Cleanup all contexts
      for(const ctx of contextInstances) {
        if (ctx && typeof ctx.close === 'function') {
          await ctx.close();
        }
      }
      process.exit(1);
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
            contextSeedData: {},
            contextSeedConfig: {},
            contextFileName: key
          };
          migration.createSnapShot(snap);
          console.log(`✓ Migrations enabled for ${ctxName}`);
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