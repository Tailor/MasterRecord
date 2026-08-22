#!/usr/bin/env node

// version 0.1.0 - ESM only
// https://docs.microsoft.com/en-us/ef/ef6/modeling/code-first/migrations/
// how to add environment variables on cli call example - master=development masterrecord add-migration auth authContext

import { program } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import { resolveMigrationsDirectory, toPosixPath } from './pathUtils.js';
import Migration from './migrations.js';
import schema from './schema.js';
import { instantiateReadyContext } from './contextInit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load a user module (context, migration) via dynamic import.
 * Unwraps `export default X` -> X; returns whole namespace if no default.
 *
 * @param {string} filePath - Absolute path to the user file
 * @returns {Promise<*>} The default export (or whole module if no default)
 */
async function __loadUserModule(filePath) {
  try {
    const mod = await import(pathToFileURL(filePath).href);
    return (mod && mod.default !== undefined) ? mod.default : mod;
  } catch (err) {
    // A context/migration file typically does `import masterrecord from
    // 'masterrecord'`. In a checkout without installed dependencies, Node
    // throws a cryptic ERR_MODULE_NOT_FOUND naming the BARE specifier, buried
    // in a stack trace. Translate that into an actionable message.
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      const m = /Cannot find package '([^']+)'|Cannot find module '([^']+)'/.exec(err.message || '');
      const missing = m ? (m[1] || m[2]) : null;
      // A bare specifier (not a relative/absolute path) => a missing dependency,
      // not a bad file path. Point the user at `npm install`.
      if (missing && !missing.startsWith('.') && !path.isAbsolute(missing)) {
        const friendly = new Error(
          `masterrecord: could not load '${path.basename(filePath)}' — its dependency '${missing}' is not installed. ` +
          `Run \`npm install\` in your project root first (node_modules is missing or incomplete).`
        );
        friendly.code = 'ERR_MODULE_NOT_FOUND';
        friendly.cause = err;
        throw friendly;
      }
    }
    throw err;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// Snapshots written on Windows before 1.3.1 can contain backslash-relative
// paths (e.g. "..\\..\\userContext.js"). On POSIX a backslash is a literal
// filename character, so path.resolve() builds a bogus specifier and the
// dynamic import of the context dies with ERR_INVALID_MODULE_SPECIFIER
// before any migration runs. Normalize every path-bearing field on load so
// already-committed snapshots keep working without regeneration.
function __normalizeSnapshotPaths(snapshot){
  if (snapshot && typeof snapshot === 'object') {
    for (const key of ['contextLocation', 'migrationFolder', 'snapShotLocation']) {
      if (typeof snapshot[key] === 'string') snapshot[key] = toPosixPath(snapshot[key]);
    }
  }
  return snapshot;
}

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

// ============================================================================
// Migration tracking — one row per applied migration filename.
// Without this, update-database cannot tell which files are pending, so it
// used to run only the last one and silently skip the rest.
// ============================================================================

const __MIGRATIONS_TABLE__ = '_masterrecord_migrations';

async function __ensureMigrationsTable(ctx){
  if (ctx.isSQLite) {
    await ctx._execute(`CREATE TABLE IF NOT EXISTS [${__MIGRATIONS_TABLE__}] (
      migration_name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
  } else if (ctx.isMySQL) {
    await ctx._execute(`CREATE TABLE IF NOT EXISTS \`${__MIGRATIONS_TABLE__}\` (
      migration_name VARCHAR(255) PRIMARY KEY,
      applied_at VARCHAR(64) NOT NULL
    )`);
  } else if (ctx.isPostgres) {
    await ctx._execute(`CREATE TABLE IF NOT EXISTS "${__MIGRATIONS_TABLE__}" (
      migration_name VARCHAR(255) PRIMARY KEY,
      applied_at VARCHAR(64) NOT NULL
    )`);
  }
}

async function __getAppliedMigrations(ctx){
  const applied = new Set();
  const engine = ctx._SQLEngine;
  let rows;
  try {
    if (ctx.isSQLite) {
      rows = engine.db.prepare(`SELECT migration_name FROM [${__MIGRATIONS_TABLE__}]`).all();
    } else if (ctx.isMySQL) {
      rows = await engine._runWithParams(`SELECT migration_name FROM \`${__MIGRATIONS_TABLE__}\``, []);
    } else if (ctx.isPostgres) {
      const r = await engine._runWithParams(`SELECT migration_name FROM "${__MIGRATIONS_TABLE__}"`, []);
      rows = r && r.rows ? r.rows : [];
    }
  } catch (_) {
    rows = [];
  }
  for (const r of (rows || [])) {
    if (r && r.migration_name) applied.add(r.migration_name);
  }
  return applied;
}

async function __recordMigrationApplied(ctx, migrationName){
  const appliedAt = new Date().toISOString();
  if (ctx.isSQLite) {
    await ctx._execute(`INSERT INTO [${__MIGRATIONS_TABLE__}] (migration_name, applied_at) VALUES (?, ?)`, [migrationName, appliedAt]);
  } else if (ctx.isMySQL) {
    await ctx._execute(`INSERT INTO \`${__MIGRATIONS_TABLE__}\` (migration_name, applied_at) VALUES (?, ?)`, [migrationName, appliedAt]);
  } else if (ctx.isPostgres) {
    await ctx._execute(`INSERT INTO "${__MIGRATIONS_TABLE__}" (migration_name, applied_at) VALUES ($1, $2)`, [migrationName, appliedAt]);
  }
}

async function __removeMigrationApplied(ctx, migrationName){
  if (ctx.isSQLite) {
    await ctx._execute(`DELETE FROM [${__MIGRATIONS_TABLE__}] WHERE migration_name = ?`, [migrationName]);
  } else if (ctx.isMySQL) {
    await ctx._execute(`DELETE FROM \`${__MIGRATIONS_TABLE__}\` WHERE migration_name = ?`, [migrationName]);
  } else if (ctx.isPostgres) {
    await ctx._execute(`DELETE FROM "${__MIGRATIONS_TABLE__}" WHERE migration_name = $1`, [migrationName]);
  }
}

/** Applied migrations with timestamps: [{ migration_name, applied_at }] (EF `migrations list`). */
async function __getAppliedMigrationRows(ctx){
  const engine = ctx._SQLEngine;
  try {
    if (ctx.isSQLite) {
      return engine.db.prepare(`SELECT migration_name, applied_at FROM [${__MIGRATIONS_TABLE__}] ORDER BY applied_at`).all();
    } else if (ctx.isMySQL) {
      return await engine._runWithParams(`SELECT migration_name, applied_at FROM \`${__MIGRATIONS_TABLE__}\` ORDER BY applied_at`, []);
    } else if (ctx.isPostgres) {
      const r = await engine._runWithParams(`SELECT migration_name, applied_at FROM "${__MIGRATIONS_TABLE__}" ORDER BY applied_at`, []);
      return r && r.rows ? r.rows : [];
    }
  } catch (_) { /* table may not exist yet */ }
  return [];
}

/**
 * Apply ONE migration step atomically (EF Core: each migration runs in its own
 * transaction). The migration's DDL/DML and its tracking-table row commit or
 * roll back together, so a failure can never leave a half-applied schema that
 * is (or isn't) recorded.
 *   - PostgreSQL: transactional DDL -> BEGIN ... COMMIT.
 *   - SQLite: transactional DDL too, but `PRAGMA foreign_keys` is a no-op inside
 *     a transaction and the table-rebuild path relies on toggling it, so FK
 *     enforcement is switched off BEFORE the transaction and restored after
 *     (exactly what EF does for SQLite rebuilds).
 *   - MySQL: DDL implicitly commits, so a migration cannot be made atomic there
 *     (EF documents the same limitation); statements run directly.
 * Runs on the migration's own context (it shares the engine/connection with
 * `contextInstance`), so the tracking row is written inside the same transaction.
 */
async function __applyMigrationStep(contextInstance, instance, tableObj, migrationName, direction = 'up'){
  const ctx = (instance && instance.context) ? instance.context : contextInstance;
  const run = async () => {
    if (direction === 'down') await instance.down(tableObj); else await instance.up(tableObj);
    if (typeof instance.finalize === 'function') await instance.finalize();
    if (direction === 'down') await __removeMigrationApplied(ctx, migrationName);
    else await __recordMigrationApplied(ctx, migrationName);
  };
  if (ctx.isMySQL || typeof ctx.transaction !== 'function') { await run(); return 'autocommit'; }

  let fkWasOn = false;
  if (ctx.isSQLite) {
    await ctx._ensureReady();
    try { fkWasOn = ctx._SQLEngine.db.pragma('foreign_keys', { simple: true }) === 1; } catch (_) { /* older driver */ }
    if (fkWasOn) { try { ctx._SQLEngine.db.pragma('foreign_keys = OFF'); } catch (_) { /* ignore */ } }
  }
  try {
    await ctx.transaction(run);
    return 'transaction';
  } finally {
    if (ctx.isSQLite && fkWasOn) { try { ctx._SQLEngine.db.pragma('foreign_keys = ON'); } catch (_) { /* ignore */ } }
  }
}

/** Resolve everything a migration command needs for a context (snapshot, files, constructor). */
async function __resolveMigrationPlan(contextFileName){
  const executedLocation = process.cwd();
  contextFileName = String(contextFileName).toLowerCase();
  const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
  const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
  if (!file) {
    throw new Error(`Cannot find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'. Run 'masterrecord enable-migrations ${contextFileName}' first.`);
  }
  const contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
  const snapDir = path.dirname(file);
  const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
  let migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
  if (!fs.existsSync(migBase)) migBase = snapDir;
  const migrationFiles = globSync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true }) || [];
  const mFiles = migrationFiles.map(f => path.resolve(migBase, f))
    .sort((a, b) => __getMigrationTimestamp(a) - __getMigrationTimestamp(b));
  const ContextCtor = await __loadUserModule(contextAbs);
  return { executedLocation, contextFileName, file, contextSnapshot, contextAbs, migBase, mFiles, ContextCtor };
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


const [,, ..._args] = process.argv



program
  .version(pkg.version, '-v, --version')
  .description('A ORM framework that facilitates the creation and use of business objects whose data requires persistent storage to a database');

// Support legacy '-V' as an alias to print version
program.option('-V', 'output the version');

// EF `--connection`: override the env-file connection for this run with a JSON
// config (optionally keyed by context name), e.g.
//   masterrecord update-database AppContext --connection '{"type":"sqlite","connection":"./tmp/"}'
program.option('--connection <json>', 'JSON connection config that overrides the environment file for this run');
program.hook('preAction', () => {
  const opts = program.opts();
  if (opts.connection) process.env.MASTERRECORD_CONNECTION_OVERRIDE = String(opts.connection);
});

  // Instructions : to run command you must go to main project folder is located and run the command using the context file name.
  program
  .command('enable-migrations <contextFileName>')
  .alias('em')
  .description('Enables the migration in your project by creating a configuration class called ContextSnapShot.json')
  .action(async function(contextFileName){
        try {
          const migration = new Migration();
          // location of folder where command is being executed..
          const executedLocation = process.cwd();
          // find context file from main folder location
          const contextFile = migration.findContextFile(executedLocation, contextFileName);
          if(!contextFile){
            console.error(`\n❌ Error - Cannot read or find Context file '${contextFileName}.js'`);
            console.error(`\nSearched in: ${executedLocation}`);
            console.error(`\nMake sure your Context file exists and is named correctly.`);
            process.exit(1);
          }
          const snap = {
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
    const executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    const _migration = new Migration();
    let contextInstance = null;
    try{
      const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
      if(!file){
        console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
        return;
      }
      let contextSnapshot;
      try{
        contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
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

      // ensure-database's job is to make the database EXIST — that must NOT
      // depend on a migration having been authored yet (otherwise a brand-new
      // context can't be bootstrapped until you've written a migration). When
      // migrations exist we use the latest migration class (it extends schema);
      // otherwise we fall back to the `schema` layer directly, whose
      // createDatabase() is the very method the migration class inherits.
      let migrationFiles = globSync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
      migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));

      let mig;
      if(migrationFiles.length){
        const mFiles = migrationFiles.slice().sort(function(a, b){
          return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
        });
        const mFile = mFiles[mFiles.length -1];
        const MigrationCtor = await __loadUserModule(mFile);
        mig = new MigrationCtor(ContextCtor);
      }else{
        console.log('No migration files found — creating the database directly from the context (no migration required).');
        mig = new schema(ContextCtor);
      }
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
  //       console.log("Database Created");

  // });


  // Instructions : to run command you must go to folder where migration file is located.
  program
  .command('add-migration <name> <contextFileName>')
  .alias('am')
  .action(async function(name, contextFileName){
    const executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    const migration = new Migration();
      try{
          // find context file from main folder location
        const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
        const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
        if(!file){
          console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'. Run 'masterrecord enable-migrations ${contextFileName}'.`);
          return;
        }
        let contextSnapshot = null;
        try{
          contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
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
        const cleanEntities = migration.cleanEntities(contextInstance.__entities);
        const seedData = contextInstance.__contextSeedData || {};
        const seedConfig = contextInstance.__contextSeedConfig || {};

        // Skip if no changes between snapshot schema and current entities
        const has = migration.hasChanges(contextSnapshot.schema || [], cleanEntities || [], seedData);
        if(!has){
          console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
          return;
        }

        const newEntity = migration.template(name, contextSnapshot.schema, cleanEntities, seedData, seedConfig, null);
        if(!fs.existsSync(migBase)){
          try{ fs.mkdirSync(migBase, { recursive: true }); }catch(_){ /* ignore */ }
        }
        const migrationDate = Date.now();
        const outputFile = `${migBase}/${migrationDate}_${name}_migration.js`
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
    const executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    const migration = new Migration();
    let contextInstance = null;
      try{
         console.log(`\n🔍 Searching for context snapshot '${contextFileName}_contextSnapShot.json'...`);
         // find context snapshot (cwd-based glob)
         const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
         const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;

         if(!file){
           console.error(`\n❌ Error - Cannot find Context snapshot file`);
           console.error(`\nSearched for: ${contextFileName}_contextSnapShot.json`);
           console.error(`Searched in: ${executedLocation}`);
           console.error(`\n💡 Solution: Run 'masterrecord enable-migrations ${contextFileName}' first`);
           await __cleanupAndExit(contextInstance, 1);
         }

         console.log(`✓ Found snapshot: ${file}`);

         let contextSnapshot;
         try{
           contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
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
         let migrationFiles = globSync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
         migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));

         if(!(migrationFiles && migrationFiles.length)){
           console.error(`\n❌ Error - No migration files found`);
           console.error(`\nSearched in: ${migBase}`);
           console.error(`\n💡 Solution: Run 'masterrecord add-migration Init ${contextFileName}' to create your first migration`);
           await __cleanupAndExit(contextInstance, 1);
         }

         // Sort by timestamp prefix (filename convention) or file mtime as fallback.
         // Then run EVERY pending migration in order, not just the last one —
         // the old behavior silently skipped earlier pending migrations when a
         // user had stacked multiple add-migration calls before deploying.
         const mFiles = migrationFiles.slice().sort(function(a, b){
           return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
         });
         console.log(`✓ Found ${mFiles.length} migration file(s)`);

         console.log(`\n🔍 Loading Context file from: ${contextAbs}`);
         let ContextCtor;
         try{
           ContextCtor = await __loadUserModule(contextAbs);
         }catch(err){
           console.error(`\n❌ Error - Cannot load Context file`);
           console.error(`\nContext file: ${contextAbs}`);
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
           // Route through the schema layer so a missing MySQL/Postgres
           // database is AUTO-CREATED (and the connection retried) before any
           // migration runs — honoring the message printed just above. Awaiting
           // the raw _initPromise here used to just report "Unknown database"
           // and exit without ever creating it.
           contextInstance = await instantiateReadyContext(ContextCtor);
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
         }else if(contextInstance.isPostgres){
           console.log(`\n📊 Database Type: PostgreSQL`);
         }

         console.log(`\n🔍 Loading entities from context...`);
         const cleanEntities = migration.cleanEntities(contextInstance.__entities);
         console.log(`✓ Found ${cleanEntities.length} entity/entities`);

         if(cleanEntities.length === 0){
           console.error(`\n⚠️  Warning - No entities found in Context`);
           console.error(`\nMake sure your Context file has dbset() calls to register entities`);
           console.error(`Example:`);
           console.error(`  this.dbset(User, 'User');`);
           console.error(`  this.dbset(Post, 'Post');`);
         }

         // Build tableObj once from the current entity state. All pending
         // migrations share this object — the old design assumed a single
         // migration, so there's no historical per-migration tableObj.
         // Idempotent helpers (createTable checks tableExists; addColumn
         // no-ops on undefined `table.col`) make this safe in practice.
         const tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

         // Bootstrap the migrations tracking table, then filter out any
         // migrations already applied so re-running update-database is a
         // no-op. Must run before any migration's `up()`.
         try {
           await __ensureMigrationsTable(contextInstance);
         } catch (err) {
           console.error(`\n❌ Error - Could not create migration tracking table`);
           console.error(`\nDetails: ${err.message}`);
           await __cleanupAndExit(contextInstance, 1);
         }

         const appliedMigrations = await __getAppliedMigrations(contextInstance);
         const pending = mFiles.filter(f => !appliedMigrations.has(path.basename(f)));

         if (pending.length === 0) {
           console.log(`\n✓ All migrations already applied (${appliedMigrations.size} on record). Database is up to date.`);
         } else {
           console.log(`\n🚀 Running ${pending.length} pending migration(s)...`);
         }

         for (const mFile of pending) {
           const migrationName = path.basename(mFile);
           console.log(`\n  → ${migrationName}`);
           try {
             const MigrationCtor = await __loadUserModule(mFile);
             const instance = new MigrationCtor(ContextCtor);
             // Atomic: DDL + tracking row commit/roll back together (EF: one
             // transaction per migration; MySQL DDL autocommits — see helper).
             const mode = await __applyMigrationStep(contextInstance, instance, tableObj, migrationName, 'up');
             console.log(`    ✓ applied${mode === 'transaction' ? ' (transactional)' : ''}`);
           } catch (err) {
             console.error(`\n❌ Error - Migration '${migrationName}' failed during execution`);
             console.error(`\nDetails: ${err.message}`);
             if (err.stack) {
               console.error(`\nStack trace:`);
               console.error(err.stack);
             }
             console.error(`\n💡 Earlier migrations (if any) were already applied and recorded. Fix the failing migration and re-run update-database to resume from this point.`);
             await __cleanupAndExit(contextInstance, 1);
           }
         }

         console.log(`\n💾 Updating snapshot...`);
         const snap = {
           file : contextAbs,
           executedLocation : executedLocation,
           context : contextInstance,
           contextEntities : cleanEntities,
           contextSeedData: contextInstance.__contextSeedData || {},
           contextFileName: contextFileName,
           latestMigration: mFiles.length ? path.basename(mFiles[mFiles.length - 1]) : null
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
    const executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    const migration = new Migration();
    var contextInstance = null;
    try{
       const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
       const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
       if(!file){
         console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
         return;
       }
       let contextSnapshot;
       try{
         contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
       }catch(_){
         console.log(`Error - Cannot read context snapshot at '${file}'.`);
         return;
       }
       const snapDir = path.dirname(file);
       const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
       const migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
       let migrationFiles = globSync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
       migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));
       if(!(migrationFiles && migrationFiles.length)){
         console.log("Error - Cannot read or find migration file");
         return;
       }
       // Sort so we can find the latest APPLIED migration (not just the
       // latest on disk) using the tracking table.
       const mFiles = migrationFiles.slice().sort(function(a, b){
         return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
       });

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
         if (contextInstance && contextInstance._initPromise) {
           await contextInstance._initPromise;
         }
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
       const cleanEntities = migration.cleanEntities(contextInstance.__entities);
       const tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

       // Roll back the most recently APPLIED migration. Falls back to the
       // latest migration file on disk if the tracking table is missing or
       // empty (preserves legacy behavior for users who haven't run
       // update-database under the tracked system yet).
       await __ensureMigrationsTable(contextInstance);
       const applied = await __getAppliedMigrations(contextInstance);
       let rollbackFile;
       let rollbackName;
       if (applied.size > 0) {
         // Pick the applied file with the latest timestamp prefix.
         const appliedFiles = mFiles.filter(f => applied.has(path.basename(f)));
         rollbackFile = appliedFiles[appliedFiles.length - 1];
         rollbackName = path.basename(rollbackFile || mFiles[mFiles.length - 1]);
       } else {
         rollbackFile = mFiles[mFiles.length - 1];
         rollbackName = path.basename(rollbackFile);
         console.log(`⚠️  No applied-migration record found; falling back to latest file on disk: ${rollbackName}`);
       }

       const MigCtor = await __loadUserModule(rollbackFile);
       const migInstance = new MigCtor(ContextCtor);
       if(typeof migInstance.down === 'function'){
         await migInstance.down(tableObj);
         if (typeof migInstance.finalize === 'function') await migInstance.finalize();
         await __removeMigrationApplied(contextInstance, rollbackName);
       }else{
         console.log(`Warning - Migration '${rollbackName}' has no down method; skipping.`);
       }

       // Update snapshot
       const snap = {
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
    const executedLocation = process.cwd();
    contextFileName = contextFileName.toLowerCase();
    const migration = new Migration();
    var contextInstance = null;
      try{
         // find context snapshot (cwd-based glob)
         const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
         const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
         if(!file){
           console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
           return;
         }
      let contextSnapshot;
         try{
           contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
         }catch(_){
           console.log(`Error - Cannot read context snapshot at '${file}'.`);
           return;
         }
      const snapDir = path.dirname(file);
      const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation || '');
      const migBase = path.resolve(snapDir, contextSnapshot.migrationFolder || '.');
      let migrationFiles = globSync(`**/*_migration.js`, { cwd: migBase, dot: true, windowsPathsNoEscape: true });
      migrationFiles = (migrationFiles || []).map(f => path.resolve(migBase, f));
         if(!(migrationFiles && migrationFiles.length)){
           console.log("Error - Cannot read or find migration file");
           return;
         }
         // organize by time using filename timestamp or file mtime
         const mFiles = migrationFiles.slice().sort(function(a, b){
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
           // Auto-create a missing MySQL/Postgres database (and await async
           // init) via the schema layer before applying migrations.
           contextInstance = await instantiateReadyContext(ContextCtor);
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
         const cleanEntities = migration.cleanEntities(contextInstance.__entities);
         for (let i = 0; i < mFiles.length; i++) {
            const migFile = mFiles[i];
            const migrationProjectFile = await __loadUserModule(migFile);
            const newMigrationProjectInstance = new migrationProjectFile(ContextCtor);
            const tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);
            await newMigrationProjectInstance.up(tableObj);
            if (typeof newMigrationProjectInstance.finalize === 'function') await newMigrationProjectInstance.finalize();
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


 // EF `dotnet ef migrations list`: applied (with timestamps) vs pending.
 program
 .command('migrations-status <contextFileName>')
 .alias('ms')
 .description('Show applied and pending migrations for a context against the database')
 .action(async function(contextFileName){
   let contextInstance = null;
   try {
     const plan = await __resolveMigrationPlan(contextFileName);
     contextInstance = await instantiateReadyContext(plan.ContextCtor);
     const rows = await __getAppliedMigrationRows(contextInstance);
     const appliedMap = new Map(rows.map(r => [r.migration_name, r.applied_at]));
     const names = plan.mFiles.map(f => path.basename(f));
     const pending = names.filter(n => !appliedMap.has(n));
     const orphans = [...appliedMap.keys()].filter(n => !names.includes(n));
     console.log(`Context: ${plan.contextFileName}`);
     console.log(`Migrations folder: ${plan.migBase}`);
     console.log(`\nApplied (${appliedMap.size}):`);
     for (const n of names) if (appliedMap.has(n)) console.log(`  ✓ ${n}   ${appliedMap.get(n)}`);
     for (const n of orphans) console.log(`  ✓ ${n}   ${appliedMap.get(n)}   [recorded, file missing]`);
     console.log(`\nPending (${pending.length}):`);
     for (const n of pending) console.log(`  • ${n}`);
     if (plan.contextSnapshot.latestMigration) console.log(`\nSnapshot latest migration: ${plan.contextSnapshot.latestMigration}`);
     await __cleanupAndExit(contextInstance, 0);
   } catch (e) {
     console.error(`❌ migrations-status failed: ${e.message}`);
     await __cleanupAndExit(contextInstance, 1);
   }
 });

 // EF `dotnet ef migrations script`: the SQL for pending migrations, NOT applied.
 program
 .command('script <contextFileName>')
 .option('-o, --output <file>', 'write the SQL to a file instead of stdout')
 .description('Generate the SQL for pending migrations without applying them (for DBA review)')
 .action(async function(contextFileName, cmdOpts){
   let contextInstance = null;
   try {
     const plan = await __resolveMigrationPlan(contextFileName);
     contextInstance = await instantiateReadyContext(plan.ContextCtor);
     const applied = await __getAppliedMigrations(contextInstance);
     const pending = plan.mFiles.filter(f => !applied.has(path.basename(f)));
     const migration = new Migration();
     const cleanEntities = migration.cleanEntities(contextInstance.__entities);
     const tableObj = migration.buildUpObject(plan.contextSnapshot.schema, cleanEntities);
     const lines = [
       `-- masterrecord migration script for '${plan.contextFileName}'`,
       `-- generated ${new Date().toISOString()} — ${pending.length} pending migration(s). This script was NOT applied.`,
       `-- Introspection (table/column checks) ran against the live database; statements below are what update-database would execute.`,
       '',
     ];
     const fmt = (q, p) => {
       const s = String(q).replace(/\s+/g, ' ').trim().replace(/;$/, '');
       return (p && p.length) ? `${s}; -- params: ${JSON.stringify(p)}` : `${s};`;
     };
     for (const mFile of pending) {
       const name = path.basename(mFile);
       const MigrationCtor = await __loadUserModule(mFile);
       const instance = new MigrationCtor(plan.ContextCtor);
       const mctx = instance.context || contextInstance;
       const captured = [];
       // Capture instead of execute: schema.js issues all DDL/DML through
       // context._execute; engine-level introspection (tableExists/getTableInfo)
       // is untouched so the plan reflects the real database state.
       const patch = (c) => {
         const orig = c._execute;
         c._execute = (q, p) => { captured.push(fmt(q, p)); return Promise.resolve({ changes: 0, rowCount: 0, affectedRows: 0 }); };
         return () => { c._execute = orig; };
       };
       const restores = [patch(mctx)];
       if (mctx !== contextInstance) restores.push(patch(contextInstance));
       try {
         await instance.up(tableObj);
         if (typeof instance.finalize === 'function') await instance.finalize();
         await __recordMigrationApplied(mctx, name);   // captured, not executed
       } finally {
         for (const r of restores) r();
       }
       lines.push(`-- Migration: ${name}`);
       lines.push(...captured);
       lines.push('');
       try { if (mctx !== contextInstance && typeof mctx.close === 'function') await mctx.close(); } catch (_) { /* best-effort */ }
     }
     const out = lines.join('\n');
     if (cmdOpts && cmdOpts.output) {
       const target = path.resolve(cmdOpts.output);
       fs.writeFileSync(target, out, 'utf8');
       console.log(`✓ SQL script for ${pending.length} pending migration(s) written to ${target}`);
     } else {
       process.stdout.write(out + '\n');
     }
     await __cleanupAndExit(contextInstance, 0);
   } catch (e) {
     console.error(`❌ script failed: ${e.message}`);
     await __cleanupAndExit(contextInstance, 1);
   }
 });

 program
 .command('get-migrations <contextFileName>')
 .alias('gm')
 .description('Get a list of migration file names using the context')
 .action(function(contextFileName){
      const executedLocation = process.cwd();
      contextFileName = contextFileName.toLowerCase();
      const files = globSync(`**/*${contextFileName}_contextSnapShot.json`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
      if(!file){
        console.log(`Error - Cannot read or find Context snapshot '${contextFileName}_contextSnapShot.json' in '${executedLocation}'.`);
        return;
      }
      let contextSnapshot;
      try{
        contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(file, 'utf8')));
      }catch(_){
        console.log(`Error - Cannot read context snapshot at '${file}'.`);
        return;
      }
      const migrationFiles = globSync(`**/*_migration.js`, { cwd: contextSnapshot.migrationFolder, dot: true, windowsPathsNoEscape: true });
      if(!(migrationFiles && migrationFiles.length)){
        console.log("No migration files found.");
        return;
      }
      const sorted = migrationFiles.slice().sort((a,b) => __getMigrationTimestamp(path.resolve(contextSnapshot.migrationFolder, a)) - __getMigrationTimestamp(path.resolve(contextSnapshot.migrationFolder, b)));
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
    const executedLocation = process.cwd();
    const migration = new Migration();
    var contextInstance = null;
    try{
      // Accept either a bare filename or a path; normalize to basename
      const targetName = path.basename(migrationFileName);

      // Locate the target migration file anywhere under the current folder
      const targetMatches = globSync(`**/${targetName}`, { cwd: executedLocation, dot: true, windowsPathsNoEscape: true });
      if(!(targetMatches && targetMatches.length)){
        console.log(`Error - Cannot read or find migration file '${targetName}' in '${executedLocation}'.`);
        return;
      }
      const targetFilePath = path.resolve(executedLocation, targetMatches[0]);
      const migrationFolder = path.dirname(targetFilePath);

      // Find the context snapshot within the same migrations folder
      const snapshotMatches = globSync(`**/*_contextSnapShot.json`, { cwd: migrationFolder, dot: true, windowsPathsNoEscape: true });
      const snapshotFile = snapshotMatches && snapshotMatches[0] ? path.resolve(migrationFolder, snapshotMatches[0]) : null;
      if(!snapshotFile){
        console.log("Error - Cannot read or find Context snapshot in migration folder.");
        return;
      }

      let contextSnapshot;
      try{
        contextSnapshot = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
      }catch(_){
        console.log(`Error - Cannot read context snapshot at '${snapshotFile}'.`);
        return;
      }

      // Get all migration files in this folder
      const allMigrationFiles = globSync(`**/*_migration.js`, { cwd: migrationFolder, dot: true, windowsPathsNoEscape: true });
      if(!(allMigrationFiles && allMigrationFiles.length)){
        console.log("Error - Cannot read or find migration file");
        return;
      }

      // Sort chronologically
      const sorted = allMigrationFiles.slice().sort(function(a, b){
        return __getMigrationTimestamp(path.resolve(migrationFolder, a)) - __getMigrationTimestamp(path.resolve(migrationFolder, b));
      });

      // Find target index by basename match
      const targetIndex = sorted.findIndex(function(f){ return path.basename(f) === targetName; });
      if(targetIndex === -1){
        console.log(`Error - Target migration '${targetName}' not found.`);
        return;
      }

      // Prepare context and table object.
      // Resolve the Context file path from the snapshot (relative to the
      // snapshot's directory) — this was previously referenced as `contextAbs`
      // without being defined in this handler, throwing ReferenceError on the
      // first use below and breaking the rollback-to-target command.
      const contextAbs = path.resolve(path.dirname(snapshotFile), contextSnapshot.contextLocation || '');
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
      const cleanEntities = migration.cleanEntities(contextInstance.__entities);
      const tableObj = migration.buildUpObject(contextSnapshot.schema, cleanEntities);

      // Roll back (down) all migrations newer than the target (i.e., strictly after targetIndex)
      for (let i = sorted.length - 1; i > targetIndex; i--) {
        const migFile = path.resolve(migrationFolder, sorted[i]);
        const MigCtor = await __loadUserModule(migFile);
        const migInstance = new MigCtor(ContextCtor);
        if(typeof migInstance.down === 'function'){
          await migInstance.down(tableObj);
         if (typeof migInstance.finalize === 'function') await migInstance.finalize();
        } else {
          console.log(`Warning - Migration '${path.basename(migFile)}' has no down method; skipping.`);
        }
      }

      // Update snapshot
      const snap = {
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
    const executedLocation = process.cwd();
    const contextInstances = [];
    try{
      const snapshotFiles = globSync('**/*_contextSnapShot.json', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      if(!(snapshotFiles && snapshotFiles.length)){
        console.log('No context snapshots found. Run enable-migrations-all first.');
        return;
      }
      let created = 0;
      for(const snapRel of snapshotFiles){
        try{
          const snapFile = path.resolve(executedLocation, snapRel);
          let cs;
          try{ cs = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(snapFile, 'utf8'))); }catch(_){ continue; }
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
            // Generating a migration only needs entity metadata, not a live DB.
            // Schema-only mode skips connection/init — matching `add-migration`
            // (without it, add-migration-all needlessly required a reachable
            // database and would hit the missing-DB init path on MySQL/Postgres).
            process.env.MASTERRECORD_SCHEMA_ONLY = '1';
            contextInstance = new ContextCtor();
            delete process.env.MASTERRECORD_SCHEMA_ONLY;
            contextInstances.push(contextInstance);
          }catch(err){
            delete process.env.MASTERRECORD_SCHEMA_ONLY;
            console.error(`⚠️  Skipping ${path.basename(contextAbs)}: failed to construct Context`);
            console.error(`   Details: ${err.message}`);
            continue;
          }
          const migration = new Migration();
          const cleanEntities = migration.cleanEntities(contextInstance.__entities);
          const seedData = contextInstance.__contextSeedData || {};
          const seedConfig = contextInstance.__contextSeedConfig || {};
          // If no changes, skip with message
          const has = migration.hasChanges(cs.schema || [], cleanEntities || [], seedData);
          if(!has){
            console.log(`No changes detected for ${path.basename(contextAbs)}. Skipping.`);
            continue;
          }
          const newEntity = migration.template(name, cs.schema, cleanEntities, seedData, seedConfig, null);
          if(!fs.existsSync(migBase)){
            try{ fs.mkdirSync(migBase, { recursive: true }); }catch(_){ /* ignore */ }
          }
          const migrationDate = Date.now();
          const outputFile = path.join(migBase, `${migrationDate}_${name}_migration.js`);
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
    const executedLocation = process.cwd();
    const contextInstances = [];
    try{
      // Find all context snapshots and run update per snapshot (avoids unrelated framework contexts)
      const snapshotFiles = globSync('**/*_contextSnapShot.json', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true });
      if(!(snapshotFiles && snapshotFiles.length)){
        console.log('No context snapshots found. Run enable-migrations for each context first.');
        return;
      }
      // Group snapshots by context name (case-insensitive) and pick best per group
      const groups = {};
      for(const snapRel of snapshotFiles){
        const snapFile = path.resolve(executedLocation, snapRel);
        let cs;
        try{ cs = __normalizeSnapshotPaths(JSON.parse(fs.readFileSync(snapFile, 'utf8'))); }catch(_){ continue; }
        const snapDir = path.dirname(snapFile);
        const contextAbs = path.resolve(snapDir, cs.contextLocation || '');
        let migBase = path.resolve(snapDir, cs.migrationFolder || '.');
        const nameFromPath = path.basename(snapFile).replace(/_contextSnapShot\.json$/i, '').toLowerCase();
        const ctxName = contextAbs ? path.basename(contextAbs).replace(/\.js$/i, '').toLowerCase() : nameFromPath;
        // Find migrations in snapshot's migrationFolder; fallback to <ContextDir>/db/migrations
        let migRel = globSync('**/*_migration.js', { cwd: migBase, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
        if(!(migRel && migRel.length)){
          // Fallback: find migrations directory using shared utility (prevents duplicate paths)
          const defaultFolder = resolveMigrationsDirectory(contextAbs || snapFile);
          migRel = globSync('**/*_migration.js', { cwd: defaultFolder, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
          if(migRel && migRel.length){ migBase = defaultFolder; }
        }
        const migs = migRel.map(f => path.resolve(migBase, f));
        if(!groups[ctxName]) groups[ctxName] = [];
        groups[ctxName].push({ snapFile, snapDir, cs, ctxName, migs, contextAbs, migBase });
      }

      const migration = new Migration();
      const ctxNames = Object.keys(groups);
      const summary = [];       // { ctxName, status, applied } — one row per context
      let anyFailed = false;

      for(const name of ctxNames){
        let contextInstance;
        try{
          const list = groups[name];
          // Prefer entries that actually have migration files
          const withMigs = list.filter(e => e.migs && e.migs.length > 0);
          const entry = withMigs.length ? withMigs[withMigs.length - 1] : list[0];
          if(!(entry.migs && entry.migs.length)){
            console.log(`⏭️  Skipping ${entry.ctxName}: no migration files found.`);
            summary.push({ ctxName: entry.ctxName, status: 'skipped (no migrations)', applied: 0 });
            continue;
          }
          const mFiles = entry.migs.slice().sort(function(a, b){
            return __getMigrationTimestamp(a) - __getMigrationTimestamp(b);
          });

          var ContextCtor;
          try{
            ContextCtor = await __loadUserModule(entry.contextAbs);
          }catch(err){
            console.error(`⚠️  Skipping ${entry.ctxName}: cannot load Context file`);
            console.error(`   Details: ${err.message}`);
            summary.push({ ctxName: entry.ctxName, status: 'FAILED (context load)', applied: 0 });
            anyFailed = true;
            continue;
          }
          try{
            // Auto-create a missing MySQL/Postgres database (and await async
            // init) via the schema layer before applying migrations.
            contextInstance = await instantiateReadyContext(ContextCtor);
            contextInstances.push(contextInstance);
          }catch(err){
            console.error(`⚠️  Skipping ${entry.ctxName}: failed to construct Context`);
            console.error(`   Details: ${err.message}`);
            summary.push({ ctxName: entry.ctxName, status: 'FAILED (context init)', applied: 0 });
            anyFailed = true;
            continue;
          }

          const cleanEntities = migration.cleanEntities(contextInstance.__entities);
          // Build tableObj once from the current entity state — all pending
          // migrations share it (mirrors the single-context update-database).
          const tableObj = migration.buildUpObject(entry.cs.schema, cleanEntities);

          // Run EVERY pending migration in order and record each in the
          // tracking table — the SAME behavior as the single-context
          // `update-database`. Previously this batch command applied ONLY the
          // latest migration file and never consulted/wrote the tracking table,
          // so earlier pending migrations were silently skipped and nothing was
          // recorded ("schema changes silently stop applying").
          try {
            await __ensureMigrationsTable(contextInstance);
          } catch (err) {
            console.error(`❌ ${entry.ctxName}: could not create migration tracking table — ${err.message}`);
            summary.push({ ctxName: entry.ctxName, status: 'FAILED (tracking table)', applied: 0 });
            anyFailed = true;
            continue;
          }

          const appliedMigrations = await __getAppliedMigrations(contextInstance);
          const pending = mFiles.filter(f => !appliedMigrations.has(path.basename(f)));

          let appliedCount = 0;
          let ctxFailed = false;
          for (const mFile of pending) {
            const migrationName = path.basename(mFile);
            try {
              const MigrationCtor = await __loadUserModule(mFile);
              const inst = new MigrationCtor(ContextCtor);
              await __applyMigrationStep(contextInstance, inst, tableObj, migrationName, 'up');
              appliedCount++;
              // Release the migration's own context (opened by its schema
              // constructor) so connections don't accumulate across the batch.
              try {
                const mc = inst && (inst.context || inst._context);
                if (mc && mc !== contextInstance && typeof mc.close === 'function') { await mc.close(); }
              } catch(_){ /* best-effort teardown */ }
            } catch (err) {
              console.error(`❌ ${entry.ctxName}: migration '${migrationName}' failed — ${err.message}`);
              console.error(`   Earlier migrations (if any) were applied and recorded. Fix and re-run to resume.`);
              ctxFailed = true;
              anyFailed = true;
              break;
            }
          }

          if (ctxFailed) {
            summary.push({ ctxName: entry.ctxName, status: `FAILED (after ${appliedCount} applied)`, applied: appliedCount });
          } else {
            if (appliedCount === 0) {
              console.log(`✓ ${entry.ctxName}: up to date (${appliedMigrations.size} on record)`);
            } else {
              console.log(`✓ ${entry.ctxName}: applied ${appliedCount} migration(s)`);
            }
            // Snapshot only a context that fully applied without error.
            const snap = {
              file : entry.contextAbs,
              executedLocation : executedLocation,
              context : contextInstance,
              contextEntities : cleanEntities,
              contextSeedData: contextInstance.__contextSeedData || {},
              contextSeedConfig: contextInstance.__contextSeedConfig || {},
              contextFileName: entry.ctxName
            }
            migration.createSnapShot(snap);
            summary.push({ ctxName: entry.ctxName, status: appliedCount === 0 ? 'up to date' : `applied ${appliedCount}`, applied: appliedCount });
          }
        }catch(errCtx){
          console.log(`Error updating context '${name}': `, errCtx);
          anyFailed = true;
          summary.push({ ctxName: name, status: 'FAILED (unexpected)', applied: 0 });
        } finally {
          // ISOLATION: release this context's connection(s) before the next.
          // update-database-all runs every context in one process sharing the
          // global connection-pool map; tearing each context down per-iteration
          // makes the batch behave like the safe one-process-per-context run
          // (1.4.6) and prevents one context's connection state bleeding into
          // the next.
          try {
            if (contextInstance && typeof contextInstance.close === 'function') { await contextInstance.close(); }
          }catch(_){ /* best-effort teardown */ }
        }
      }
      // Safety-net cleanup (per-iteration close above already released these;
      // close() is a no-op once the engine is torn down).
      for(const ctx of contextInstances) {
        if (ctx && typeof ctx.close === 'function') {
          await ctx.close();
        }
      }

      // Loud summary so a deploy log makes it obvious what actually happened —
      // "0 applied across all contexts" and per-context failures used to look
      // identical to success.
      const totalApplied = summary.reduce((n, s) => n + (s.applied || 0), 0);
      console.log(`\n── update-database-all summary ──`);
      for (const s of summary) { console.log(`   ${s.ctxName}: ${s.status}`); }
      console.log(`   ────`);
      console.log(`   ${summary.length} context(s), ${totalApplied} migration(s) applied${anyFailed ? ', SOME FAILED' : ''}.`);

      // Exit non-zero if any context failed so CI / deploy pipelines detect it
      // (previously this command always exited 0, hiding failures).
      process.exit(anyFailed ? 1 : 0);
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
    const executedLocation = process.cwd();
    try{
      // Find candidate Context files
      const candidates = globSync('**/*Context.js', { cwd: executedLocation, dot: true, windowsPathsNoEscape: true, nocase: true }) || [];
      if(!(candidates && candidates.length)){
        console.log('No Context files found.');
        return;
      }
      const seen = new Set();
      let enabled = 0;
      const migration = new Migration();
      for(const rel of candidates){
        try{
          const abs = path.resolve(executedLocation, rel);
          // Skip node_modules
          if(abs.indexOf('node_modules') !== -1){ continue; }
          // Heuristic filter: file must look like a MasterRecord context
          let text = '';
          try{ text = fs.readFileSync(abs, 'utf8'); }catch(_){ continue; }
          const looksLikeContext = /extends\s+masterrecord\.context/i.test(text) || /import\s+masterrecord\s+from\s+['"]masterrecord['"]/i.test(text);
          if(!looksLikeContext){ continue; }
          const ctxName = path.basename(abs).replace(/\.js$/i,'');
          const key = ctxName.toLowerCase();
          if(seen.has(key)){ continue; }
          seen.add(key);
          // Create snapshot relative to the context file directory
          const snap = {
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