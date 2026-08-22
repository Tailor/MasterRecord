// version 0.0.6
import pg from 'pg';
import MySQLAsyncClient from '../mySQLConnect.js';
import MySQLEngine from '../mySQLEngine.js';
import PostgresClient from '../postgresSyncConnect.js';
import sqliteQuery from './migrationSQLiteQuery.js';
import sqlquery from './migrationMySQLQuery.js';
import postgresQuery from './migrationPostgresQuery.js';
import { _poolKey } from '../context.js';

const { Pool } = pg;

class schema{

    constructor(context){
        this.context = new context();
        this._dbEnsured = false;
    }

    /**
     * Wait for async database initialization (MySQL/PostgreSQL) to complete.
     * The context constructor fires off an async pool init that may not have
     * finished by the time migration methods run. This must be awaited before
     * accessing this.context._SQLEngine or this.context.db.
     *
     * For MySQL: if the init fails because the database doesn't exist yet,
     * create the database first, then retry the connection.
     */
    async _ensureReady(){
        if(this._ready){ return; }
        if(this.context && this.context._initPromise){
            try{
                await this.context._initPromise;
            }catch(err){
                const msg = err && (err.message || (err.context && err.context.originalError) || '');
                const msgStr = typeof msg === 'string' ? msg : '';
                // MySQL: "Unknown database 'X'"
                if(this.context.isMySQL && msgStr.includes('Unknown database')){
                    await this._createDatabaseFromConfig();
                    await this._retryMySQLInit();
                // PostgreSQL: 'database "X" does not exist'
                }else if(this.context.isPostgres && msgStr.includes('does not exist')){
                    await this._createPostgresDatabaseFromConfig();
                    await this._retryPostgresInit();
                }else{
                    throw err;
                }
            }
        }
        this._ready = true;
    }

    /**
     * Create MySQL database using stored config (no existing connection needed).
     * Used when the initial connection fails because the database doesn't exist.
     */
    async _createDatabaseFromConfig(){
        try{
            const config = this.context._dbConfig;
            if(!config || !config.database){ return; }
            const dbName = config.database;
            // Validate database name
            if(!/^[a-zA-Z0-9_-]+$/.test(dbName)){
                throw new Error(`Invalid database name: ${dbName}. Only alphanumeric characters, underscores, and hyphens are allowed.`);
            }
            // Connect without specifying database
            const adminConfig = { ...config };
            delete adminConfig.database;
            delete adminConfig.type;
            const admin = new MySQLAsyncClient(adminConfig);
            await admin.connect();
            const pool = admin.getPool();
            if(!pool){ return; }
            // Check and create
            const [rows] = await pool.execute(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [dbName]);
            const exists = Array.isArray(rows) && rows.length > 0;
            if(!exists){
                await pool.execute(`CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
                console.log(`[MySQL] Created database '${dbName}'`);
            }
            await admin.close();
            this._dbEnsured = true;
        }catch(err){
            console.error('[MySQL] Failed to create database:', err.message);
        }
    }

    /**
     * Retry MySQL init after database creation.
     * Re-runs __mysqlInit and stores the new promise.
     */
    async _retryMySQLInit(){
        const config = this.context._dbConfig;
        if(!config){ throw new Error('No MySQL config available for retry'); }

        // Check global pool cache first -- another context may have already retried
        const _pools = global.__MR_POOLS__;
        const key = _poolKey('mysql', config);

        if (_pools.has(key)) {
            const cached = _pools.get(key);
            cached.refCount++;
            if (cached.promise) {
                const result = await cached.promise;
                this.context._SQLEngine = result.engine;
                this.context.db = result.client;
            } else {
                this.context._SQLEngine = cached.engine;
                this.context.db = cached.client;
            }
            console.log('[MySQL] Reusing existing pool after database creation');
            return;
        }

        console.log('[MySQL] Retrying connection after database creation...');
        const client = new MySQLAsyncClient(config);
        await client.connect();
        const pool = client.getPool();
        this.context._SQLEngine = new MySQLEngine();
        this.context._SQLEngine.setDB(pool);
        this.context._SQLEngine.__name = 'mysql2';
        this.context.db = client;

        // Register in global pool cache so other contexts can reuse
        _pools.set(key, { client, engine: this.context._SQLEngine, refCount: 1, dbType: 'mysql' });
        console.log('[MySQL] Connection pool ready');
    }

    /**
     * Create PostgreSQL database using stored config (no existing connection needed).
     * Used when the initial connection fails because the database doesn't exist.
     */
    async _createPostgresDatabaseFromConfig(){
        try{
            const config = this.context._dbConfig;
            if(!config || !config.database){ return; }
            const dbName = config.database;
            // Validate database name
            if(!/^[a-zA-Z0-9_-]+$/.test(dbName)){
                throw new Error(`Invalid database name: ${dbName}. Only alphanumeric characters, underscores, and hyphens are allowed.`);
            }
            // Connect to default 'postgres' database to run CREATE DATABASE
            const adminConfig = {
                host: config.host || 'localhost',
                port: config.port || 5432,
                user: config.user,
                password: config.password,
                database: 'postgres',
                ssl: config.ssl || false
            };
            const adminPool = new Pool(adminConfig);
            // Check if database exists
            const result = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
            if(result.rows.length === 0){
                // CREATE DATABASE cannot use parameterized queries, but name is validated above
                await adminPool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8'`);
                console.log(`[PostgreSQL] Created database '${dbName}'`);
            }
            await adminPool.end();
            this._dbEnsured = true;
        }catch(err){
            console.error('[PostgreSQL] Failed to create database:', err.message);
        }
    }

    /**
     * Retry PostgreSQL init after database creation.
     */
    async _retryPostgresInit(){
        const config = this.context._dbConfig;
        if(!config){ throw new Error('No PostgreSQL config available for retry'); }

        // Check global pool cache first -- another context may have already retried
        const _pools = global.__MR_POOLS__;
        const key = _poolKey('postgres', config);

        if (_pools.has(key)) {
            const cached = _pools.get(key);
            cached.refCount++;
            if (cached.promise) {
                const result = await cached.promise;
                this.context._SQLEngine = result.engine;
                this.context._SQLEngine.__name = 'pg';
                this.context.db = result.pool;
            } else {
                this.context._SQLEngine = cached.engine;
                this.context._SQLEngine.__name = 'pg';
                this.context.db = cached.pool;
            }
            console.log('[PostgreSQL] Reusing existing pool after database creation');
            return;
        }

        console.log('[PostgreSQL] Retrying connection after database creation...');
        const connection = new PostgresClient();
        await connection.connect(config);
        this.context._SQLEngine = connection.getEngine();
        this.context._SQLEngine.__name = 'pg';
        const pool = connection.getPool();
        this.context.db = pool;

        // Register in global pool cache so other contexts can reuse
        _pools.set(key, { pool, engine: this.context._SQLEngine, client: connection, refCount: 1, dbType: 'postgres' });
        console.log('[PostgreSQL] Connection pool ready');
    }

    async init(table){
        // Wait for async DB init (MySQL/PostgreSQL) before any operations
        await this._ensureReady();
        if(table){
            this.fullTable = table.___table;
            this._tableObj = table;
        }
    }
    
    // create obj to convert into create sql
    async addColumn(table){
        // Ensure the async DB init (MySQL/Postgres) has completed before we
        // read dialect flags / run DDL — matches createTable(), which always
        // did this. (addColumn/dropColumn previously skipped it.)
        await this._ensureReady();

        // FAIL LOUDLY instead of silently skipping. An older generated
        // migration re-derives its column from a live diff (`table.<col>`) at
        // apply time; when the committed snapshot is already AHEAD of THIS
        // database the diff is empty and `table` is undefined — which used to
        // hit a silent `if(table){…}` guard, mark the migration applied, and
        // never add the column. (Newer migrations bake the full spec inline,
        // so this only guards legacy/edge cases.)
        if(!table || !table.tableName || !table.name || !table.type){
            throw new Error(
                `masterrecord: addColumn received an incomplete column definition (${JSON.stringify(table)}). ` +
                `This usually means the committed snapshot is already ahead of this database, so the migration ` +
                `could not re-derive the column from the diff. Regenerate the migration (it now bakes the full ` +
                `column spec inline) or apply it against a database whose snapshot matches.`
            );
        }
        if(!this.context.isSQLite && !this.context.isMySQL && !this.context.isPostgres){
            throw new Error('masterrecord: addColumn — no database dialect is active (context not initialized).');
        }

        // Idempotency: skip if the column already exists — symmetric with
        // dropColumn's skip-if-gone and createTable's IF NOT EXISTS. None of
        // SQLite/MySQL support `ADD COLUMN IF NOT EXISTS`, so probe the live
        // schema instead. getTableInfo throws on a real introspection error
        // (1.2.0), so a genuine failure still aborts loudly; only a clean
        // "column already present" result short-circuits. This makes
        // re-running a migration safe and reduces the per-migration guards to
        // belt-and-suspenders.
        const _engine = this.context._SQLEngine;
        if (_engine && typeof _engine.getTableInfo === 'function') {
            const dbColumn = (table.relationshipType === 'belongsTo' && table.foreignKey) ? table.foreignKey : table.name;
            const existingCols = await _engine.getTableInfo(table.tableName);
            const alreadyExists = Array.isArray(existingCols) && existingCols.some(c => c && c.name === dbColumn);
            if (alreadyExists) {
                if (process.env.MR_SILENT_MIGRATIONS !== 'true') {
                    console.log(`[masterrecord:migration] addColumn skipped — ${table.tableName}.${dbColumn} already exists`);
                }
                return;
            }
        }

        // A new belongsTo column gets a FOREIGN KEY constraint (unless the
        // relationship is excluded from migrations). SQLite: inline REFERENCES
        // on ADD COLUMN (SQLite requires the new column to default to NULL when
        // foreign keys are enforced, so an inline FK is only emitted for a
        // nullable/defaulted column). MySQL/Postgres: ADD CONSTRAINT after the
        // column, now or deferred to finalize().
        const fkRef = this._fkRefFor(table, table.tableName);
        if (fkRef && this.context.isSQLite && (table.nullable === true || (table.default !== undefined && table.default !== null))) {
            Object.defineProperty(table, '__fkRef', { value: fkRef, enumerable: false, writable: true, configurable: true });
        }

        if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }

        if (fkRef && !this.context.isSQLite) {
            await this._addForeignKeyNowOrDefer(fkRef);
        }
        // add column to database
    }

    async dropColumn(table){
        await this._ensureReady();
        // Fail loudly rather than silently skipping (see addColumn) — a drift
        // between the committed snapshot and this database can leave the
        // migration's re-derived `table.<col>` undefined.
        if(!table || !table.tableName || !table.name){
            throw new Error(
                `masterrecord: dropColumn received an incomplete column definition (${JSON.stringify(table)}). ` +
                `The committed snapshot may be ahead of this database. Regenerate the migration (it now bakes the ` +
                `full column spec inline) or apply it against a database whose snapshot matches.`
            );
        }
        if(table){
            if(this.fullTable){
                // Neither SQLite nor MySQL supports `IF EXISTS` on DROP COLUMN
                // (MySQL never has — that is MariaDB syntax), so emulate it for
                // both: probe the live schema and bail out if the column is
                // already gone. Only Postgres emits the clause in its DDL.
                if(this.context.isSQLite || this.context.isMySQL){
                    if (typeof this.context._SQLEngine.getTableInfo === 'function') {
                        const cols = await this.context._SQLEngine.getTableInfo(table.tableName);
                        const exists = Array.isArray(cols) && cols.some(c => c && (c.name === table.name || c.COLUMN_NAME === table.name));
                        if (!exists) {
                            return;
                        }
                    }
                }

                if(this.context.isSQLite){
                    var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.dropColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.dropColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var queryBuilder = new postgresQuery();
                    var query = queryBuilder.dropColumn(table);
                    await this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }
    
    async createTable(table){
        // Ensure async DB init is complete (safety net for older migrations
        // that call this.init(table) without await)
        await this._ensureReady();

        if(table){
            // If table exists, run sync instead of blind create
            const tableName = table.__name;
            if(this.context._SQLEngine.tableExists && await this.context._SQLEngine.tableExists(tableName)){
                await this.syncTable(table);
            } else {
                // Resolve FOREIGN KEY constraints for this table's belongsTo
                // columns (EF always creates FK constraints for relationships).
                // SQLite: emitted inline in CREATE TABLE (it cannot ADD
                // CONSTRAINT later). MySQL/Postgres: added AFTER the table via
                // ALTER TABLE ... ADD CONSTRAINT — immediately if the referenced
                // table already exists, otherwise deferred to finalize() (run at
                // the end of the migration) so table creation order and cycles
                // never matter.
                const foreignKeys = this._foreignKeysFor(table);
                Object.defineProperty(table, '__foreignKeys', { value: foreignKeys, enumerable: false, writable: true, configurable: true });

                if(this.context.isSQLite){
                                        var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
                }

                if(this.context.isMySQL){
                                        var queryBuilder = new sqlquery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                                        var queryBuilder = new postgresQuery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
                }

                if(!this.context.isSQLite){
                    for(const fk of foreignKeys){
                        await this._addForeignKeyNowOrDefer(fk);
                    }
                }
                // EF creates an index on every FK column. MySQL does this
                // automatically for FK constraints; SQLite/Postgres do not.
                if(!this.context.isMySQL){
                    for(const fk of foreignKeys){
                        try {
                            await this.createIndex({ tableName, columnName: fk.column, indexName: `ix_${tableName}_${fk.column}` });
                        } catch (e) {
                            if(process.env.MR_SILENT_MIGRATIONS !== 'true'){
                                console.log(`[masterrecord:migration] could not create FK index on ${tableName}.${fk.column}: ${e.message}`);
                            }
                        }
                    }
                }

                // Create indexes for columns that have .index() defined
                for(const key of Object.keys(table)){
                    if(typeof table[key] === "object" && table[key].indexes && !key.startsWith('__')){
                        const columnName = table[key].name;
                        for(const indexName of table[key].indexes){
                            const indexInfo = {
                                tableName: tableName,
                                columnName: columnName,
                                indexName: indexName
                            };
                            await this.createIndex(indexInfo);
                        }
                    }
                }

                // Create composite indexes
                if (table.__compositeIndexes) {
                    for(const compositeIdx of table.__compositeIndexes){
                        const indexInfo = {
                            tableName: tableName,
                            columns: compositeIdx.columns,
                            indexName: compositeIdx.name,
                            unique: compositeIdx.unique
                        };
                        await this.createCompositeIndex(indexInfo);
                    }
                }
            }
        }else{
            console.log("Table that you're trying to create is undefined. Please check if there are any changes that need to be made");
        }
    }

    // Compute diffs and apply minimal changes
    async syncTable(table){
        const engine = this.context._SQLEngine;
        const tableName = table.__name;
        const existing = engine.getTableInfo ? await engine.getTableInfo(tableName) : [];
        // Build a set of existing columns (sqlite: name, mysql: name)
        const existingNames = new Set((existing || []).map(c => (c.name || c.COLUMN_NAME))); // both engines map to name
        // Add missing columns only (safe path)
        let sqliteForceRebuild = false;
        for (var key in table) {
            // Skip metadata properties (indexes, __compositeIndexes, __name, etc.)
            if(key === 'indexes' || key.startsWith('__')) continue;
            if(typeof table[key] === 'object' && !Array.isArray(table[key])){
                const col = table[key];
                // Skip if missing name/type (not a valid column definition)
                if(!col.name || !col.type) continue;
                // Skip relationships
                if(col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough') continue;
                const colName = (col.relationshipType === 'belongsTo' && col.foreignKey) ? col.foreignKey : col.name;
                if(!existingNames.has(colName)){
                    // add column — carry the WHOLE definition, not just the
                    // name/type. Dropping `nullable`/`unique`/`default` here
                    // made every synced column NOT NULL (columnMapping treats a
                    // missing `nullable` as false), so a later insert that left
                    // the column empty failed against a column the entity had
                    // declared optional.
                    const newCol = {
                        ...col,
                        tableName: tableName,
                        name: colName
                    };
                    // MySQL path uses addColum with realDataType
                    if(this.context.isSQLite){
                        // A generated (computed) column cannot be ADDed as STORED in
                        // SQLite — rebuild the table from the definition instead
                        // (EF's SQLite provider rebuilds for unsupported ALTERs).
                        if (col.computedSql) { sqliteForceRebuild = true; continue; }
                                                var queryBuilder = new sqliteQuery();
                        // Build a conservative column add (no NOT NULL without default)
                        const add = queryBuilder.addColum({ tableName, name: colName });
                        await this.context._execute(add);
                    }
                    if(this.context.isMySQL){
                                                var queryBuilder = new sqlquery();
                        newCol.realDataType = queryBuilder.typeManager(col.type);
                        const query = queryBuilder.addColum(newCol);
                        await this.context._execute(query);
                    }
                    if(this.context.isPostgres){
                                                var queryBuilder = new postgresQuery();
                        newCol.realDataType = queryBuilder.typeManager(col.type);
                        const query = queryBuilder.addColum(newCol);
                        await this.context._execute(query);
                    }
                }
            }
        }
        // Detect modifications (nullable/default/type)
        const desiredCols = [];
        for (var key in table) {
            if(key === 'indexes' || key.startsWith('__')) continue;
            if(typeof table[key] === 'object' && !Array.isArray(table[key])){
                const col = table[key];
                if(!col.name || !col.type) continue;
                if(col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough') continue;
                const colName = (col.relationshipType === 'belongsTo' && col.foreignKey) ? col.foreignKey : col.name;
                desiredCols.push({ name: colName, col });
            }
        }

        const needRebuildSQLite = () => {
            if(!this.context.isSQLite) return false;
            if(sqliteForceRebuild) return true;
            const sqliteBuilder = new sqliteQuery();
            const byName = {};
            for(const row of existing){ byName[row.name] = row; }
            for(const d of desiredCols){
                const row = byName[d.name];
                if(!row) continue;
                const notnull = row.notnull === 1;
                const desiredNotNull = d.col.nullable === false;
                // compare default (normalize quotes)
                const exDefRaw = row.dflt_value == null ? null : String(row.dflt_value);
                let exDef = exDefRaw;
                if(typeof exDef === 'string' && exDef.length >= 2 && exDef.startsWith("'") && exDef.endsWith("'")){
                    exDef = exDef.slice(1, -1);
                }
                // defaultSql() is an expression: compare it to the stored
                // expression text (SQLite keeps it verbatim, possibly parenthesized).
                const normExpr = (s) => s == null ? null : String(s).trim().replace(/^\((.*)\)$/s, '$1').trim().toUpperCase();
                const hasDefaultSql = d.col.default == null && d.col.defaultSql != null;
                const dsDef = hasDefaultSql ? normExpr(d.col.defaultSql) : (d.col.default == null ? null : String(d.col.default));
                const exCmp = hasDefaultSql ? normExpr(exDefRaw) : exDef;
                if(desiredNotNull !== notnull) return true;
                if(exCmp !== dsDef) return true;
                // Type change at SQLite's AFFINITY level. Compare the resolved
                // SQLite type of the desired column to the existing column's
                // declared type. This catches ANY real change (integer->text,
                // float->text, …) — the previous hardcoded boolean/string/
                // integer checks missed most — while treating same-affinity
                // changes (string->text, both TEXT; int->bigint, both INTEGER)
                // as a no-op so we don't rebuild unnecessarily.
                const desiredResolved = sqliteBuilder.resolveColumnType(d.col.type).toUpperCase();
                const existingResolved = String(row.type || '').toUpperCase();
                if(existingResolved && desiredResolved !== existingResolved){
                    return true;
                }
            }
            return false;
        };

        if(this.context.isMySQL){
            // Apply MODIFY for defaults/nullability
                        var queryBuilder = new sqlquery();
            const byName = {};
            for(const row of existing){ byName[row.name || row.COLUMN_NAME] = row; }
            for(const d of desiredCols){
                const row = byName[d.name];
                if(!row) continue;
                const desiredNotNull = d.col.nullable === false;
                const existingNullable = (row.is_nullable || row.IS_NULLABLE || '').toString().toUpperCase() === 'YES';
                // default normalize
                const dsDef = d.col.default;
                let exDef2 = row.dflt_value || row.COLUMN_DEFAULT;
                if(typeof exDef2 === 'string' && exDef2.length >= 2 && exDef2.startsWith("'") && exDef2.endsWith("'")){
                    exDef2 = exDef2.slice(1, -1);
                }
                const differsNull = (desiredNotNull === true && existingNullable === true) || (desiredNotNull !== true && existingNullable === false);
                const differsDef = (dsDef ?? null) !== (exDef2 ?? null);
                if(differsNull || differsDef){
                    const type = queryBuilder.typeManager(d.col.type);
                    const nullPart = desiredNotNull ? 'NOT NULL' : 'NULL';
                    let defPart = '';
                    if(dsDef !== undefined && dsDef !== null){
                        if(d.col.type === 'boolean'){
                            defPart = ` DEFAULT ${queryBuilder.boolType(dsDef)}`;
                        } else if(d.col.type === 'integer' || d.col.type === 'float' || d.col.type === 'decimal'){
                            defPart = ` DEFAULT ${dsDef}`;
                        } else {
                            const esc = String(dsDef).replace(/'/g, "''");
                            defPart = ` DEFAULT '${esc}'`;
                        }
                    } else {
                        defPart = ' DEFAULT NULL';
                    }
                    // Backtick-quote the identifiers so a reserved word (e.g. a
                    // column named `key`, `order`, `group`) doesn't produce a
                    // syntax error. createTable, addColumn (via the builder) and
                    // the Postgres branch below all quote; this inline MODIFY was
                    // the one path that didn't.
                    const alter = `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${d.name}\` ${type} ${nullPart}${defPart}`;
                    await this.context._execute(alter);
                }
            }
        }

        if(this.context.isPostgres){
            // Reconcile nullability and defaults, the way the MySQL branch
            // above does. Without this a column that was created NOT NULL by
            // an older sync stayed NOT NULL forever, even though the entity
            // declared it optional.
            const byName = {};
            for(const row of existing){ byName[row.name] = row; }
            for(const d of desiredCols){
                const row = byName[d.name];
                if(!row) continue;
                if(d.col.primary) continue;              // never touch the key
                const desiredNotNull = d.col.nullable === false;
                const existingNullable = String(row.is_nullable || '').toUpperCase() === 'YES';
                if(desiredNotNull && existingNullable){
                    // Only safe when no row would violate it; Postgres tells us
                    // by failing, and a failure here must not abort the deploy.
                    try {
                        await this.context._execute(`ALTER TABLE "${tableName}" ALTER COLUMN "${d.name}" SET NOT NULL`);
                    } catch (e) {
                        if(process.env.MR_SILENT_MIGRATIONS !== 'true'){
                            console.log(`[masterrecord:sync] could not set NOT NULL on ${tableName}.${d.name}: ${e.message}`);
                        }
                    }
                } else if(!desiredNotNull && !existingNullable){
                    await this.context._execute(`ALTER TABLE "${tableName}" ALTER COLUMN "${d.name}" DROP NOT NULL`);
                }
            }
        }

        if(needRebuildSQLite()){
            var queryBuilder = new sqliteQuery();
            const TEMP = "_temp_alter_column_update";

            // A rebuild is rename -> create -> copy -> drop. Every step after the
            // rename is a step where the table's contents live only in TEMP, so a
            // failure there used to leave the original renamed away and the new
            // table empty. Anything that goes wrong now puts the original back.
            const leftovers = await engine.getTableInfo(TEMP);
            if(leftovers && leftovers.length){
                // A previous run died mid-rebuild. Its data is the real data.
                await this.context._execute(queryBuilder.dropTable(tableName));
                await this.context._execute(`ALTER TABLE ${TEMP} RENAME TO ${tableName}`);
            }

            // Foreign keys must be off for the duration. The rebuild drops the
            // renamed original, and a child table with ON DELETE CASCADE takes
            // that as its parent disappearing — rebuilding Post silently emptied
            // Kudos, Poll, PollOption, PollVote, PostComment and PostLike.
            // SQLite's own "making other kinds of table schema changes" recipe
            // prescribes exactly this.
            let fkWasOn = false;
            try {
                const fk = await engine.query('PRAGMA foreign_keys');
                fkWasOn = !!(fk && fk[0] && (fk[0].foreign_keys === 1 || fk[0].foreign_keys === true));
            } catch { /* pragma unavailable — treat as off */ }
            if(fkWasOn) await this.context._execute('PRAGMA foreign_keys = OFF');

            await this.context._execute(queryBuilder.renameTable({ tableName, newName: TEMP }));
            try {
                // The rebuilt table must keep its FOREIGN KEY constraints.
                Object.defineProperty(table, '__foreignKeys', { value: this._foreignKeysFor(table), enumerable: false, writable: true, configurable: true });
                await this.context._execute(queryBuilder.createTable(table));

                const oldInfo = await engine.getTableInfo(TEMP);
                const oldNames = new Set((oldInfo || existing).map(r => r.name));
                const common = desiredCols.filter(d => oldNames.has(d.name));
                if(common.length > 0){
                    // A column that is NOT NULL now may hold NULLs in rows written
                    // before it was required. Copying those verbatim fails the
                    // constraint and costs the whole table, so they take the
                    // column's default — or a typed zero value when it has none.
                    // Computed (generated) columns cannot be inserted into — the
                    // rebuilt table derives them again.
                    const copyable = common.filter(d => !(d.col && d.col.computedSql));
                    const cols = copyable.map(d => d.name).join(',');
                    const selects = copyable.map(d => {
                        if(d.col.nullable !== false) return d.name;
                        let fallback = d.col.default;
                        if(fallback == null){
                            const t = String(d.col.type || '').toLowerCase();
                            fallback = (t === 'integer' || t === 'float' || t === 'decimal' || t === 'boolean') ? 0 : "''";
                        } else if(typeof fallback === 'string'){
                            fallback = `'${fallback.replace(/'/g, "''")}'`;
                        }
                        return `COALESCE(${d.name}, ${fallback})`;
                    }).join(',');
                    await this.context._execute(`INSERT INTO ${tableName} (${cols}) SELECT ${selects} FROM ${TEMP}`);
                }
                await this.context._execute(queryBuilder.dropTable(TEMP));
            } catch(err) {
                // Put the table back exactly as it was, then report.
                try { await this.context._execute(queryBuilder.dropTable(tableName)); } catch { /* never created */ }
                await this.context._execute(`ALTER TABLE ${TEMP} RENAME TO ${tableName}`);
                throw err;
            } finally {
                if(fkWasOn) await this.context._execute('PRAGMA foreign_keys = ON');
            }
        }
    }


    async dropTable(table){
        if(table){
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropTable(table.__name);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropTable(table.__name);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropTable(table.__name);
                await this.context._execute(query);
            }
        }
    }

    // EnsureCreated equivalent for MySQL: create DB if missing
    // Delegates to _createDatabaseFromConfig which uses stored config
    async createDatabase(){
        return this._createDatabaseFromConfig();
    }

    // Alias for consistency with user expectation
    createdatabase(table){
        return this.createDatabase(table);
    }


   //"dbo.People", "Location"
    async alterColumn(table){
        await this._ensureReady();
        if(table){
            if(this.fullTable){
                if(this.context.isSQLite){
                    // SQLite has no ALTER/MODIFY COLUMN — a type change needs a
                    // full table rebuild (rename → recreate with new schema →
                    // copy common columns → drop old). Reconcile the table to
                    // its entity definition via syncTable, which performs that
                    // rebuild and is a no-op when the type is unchanged at
                    // SQLite's affinity level (e.g. string -> text, both TEXT).
                    // (The previous builder.alterColumn path emitted invalid
                    // SQL — "near )" — when handed an empty/missing schema.)
                    const entity = (this.context.__entities || []).find(e => e && e.__name === table.tableName)
                        || (this._tableObj && this._tableObj[table.tableName])
                        || (this.fullTable && this.fullTable[table.tableName]);
                    if (!entity || !entity.__name) {
                        throw new Error(
                            `masterrecord: alterColumn could not resolve the full schema for table '${table.tableName}' ` +
                            `to rebuild it on SQLite. Ensure the context registers this entity (dbset).`
                        );
                    }
                    await this.syncTable(entity);
                }

                if(this.context.isMySQL){
                                        var queryBuilder = new sqlquery();
                    var query = queryBuilder.alterColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                                        var queryBuilder = new postgresQuery();
                    var query = queryBuilder.alterColumn(table);
                    await this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }

    async renameColumn(table){
        await this._ensureReady();
        if(table){
            if(!table.tableName || !table.name || !table.newName){
                throw new Error(`masterrecord: renameColumn requires { tableName, name, newName }, got ${JSON.stringify(table)}`);
            }
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }
        }
    }

    /** Rename a table: `{ tableName, newName }` (data-preserving). */
    async renameTable(spec){
        await this._ensureReady();
        if(!spec || !spec.tableName || !spec.newName){
            throw new Error(`masterrecord: renameTable requires { tableName, newName }, got ${JSON.stringify(spec)}`);
        }
        const builder = this.context.isSQLite ? new sqliteQuery() : this.context.isMySQL ? new sqlquery() : new postgresQuery();
        await this.context._execute(builder.renameTable(spec));
    }

    // ---- Foreign keys (EF always creates FK constraints for relationships) ----

    /** Primary-key column name of the entity that owns table `name` (default 'id'). */
    _primaryKeyOf(name){
        const ents = (this.context && this.context.__entities) || [];
        const ent = ents.find(e => e && e.__name === name);
        if(ent){
            for(const key of Object.keys(ent)){
                const f = ent[key];
                if(f && typeof f === 'object' && f.primary === true) return f.name || key;
            }
        }
        return 'id';
    }

    /**
     * FK descriptor for ONE belongsTo column (or null): { tableName, column,
     * refTable, refColumn, onDelete, name }. Honors `onDelete(...)`,
     * `stopCascadeOnDelete()` (→ SET NULL if nullable else RESTRICT) and
     * `excludeForeignKeyFromMigrations()`.
     */
    _fkRefFor(col, tableName){
        if(!col || typeof col !== 'object') return null;
        if(col.relationshipType !== 'belongsTo' || !col.foreignTable) return null;
        if(col.fkConstraint === false) return null;
        const column = col.foreignKey || col.name;
        const refTable = col.foreignTable;
        const refColumn = this._primaryKeyOf(refTable);
        let onDelete = col.onDelete;
        if(!onDelete){
            onDelete = (col.cascadeOnDelete === false) ? (col.nullable ? 'SET NULL' : 'RESTRICT') : 'CASCADE';
        }
        return { tableName, column, refTable, refColumn, onDelete, name: `fk_${tableName}_${column}` };
    }

    /** All FK descriptors for a table definition. */
    _foreignKeysFor(table){
        const out = [];
        if(!table) return out;
        for(const key of Object.keys(table)){
            if(key === 'indexes' || key.startsWith('__')) continue;
            const fk = this._fkRefFor(table[key], table.__name);
            if(fk) out.push(fk);
        }
        return out;
    }

    /** ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY (MySQL/Postgres; SQLite needs a rebuild). */
    async addForeignKey(fk){
        await this._ensureReady();
        if(this.context.isSQLite){
            throw new Error('masterrecord: SQLite cannot add a FOREIGN KEY to an existing table (no ADD CONSTRAINT). Declare it on the entity and let createTable/syncTable emit it inline.');
        }
        const builder = this.context.isMySQL ? new sqlquery() : new postgresQuery();
        await this.context._execute(builder.addForeignKey(fk), undefined, { migration: true });
    }

    /** Drop a FOREIGN KEY constraint by name (MySQL/Postgres). */
    async dropForeignKey(fk){
        await this._ensureReady();
        if(this.context.isSQLite){
            throw new Error('masterrecord: SQLite cannot drop a FOREIGN KEY from an existing table (no DROP CONSTRAINT); remove it from the entity and rebuild via syncTable.');
        }
        const builder = this.context.isMySQL ? new sqlquery() : new postgresQuery();
        await this.context._execute(builder.dropForeignKey(fk));
    }

    /** Add the FK now if the referenced table exists, else defer to finalize(). */
    async _addForeignKeyNowOrDefer(fk){
        const eng = this.context._SQLEngine;
        const refExists = eng && typeof eng.tableExists === 'function' ? await eng.tableExists(fk.refTable) : true;
        if(refExists){
            await this.addForeignKey(fk);
        } else {
            this._pendingForeignKeys = this._pendingForeignKeys || [];
            this._pendingForeignKeys.push(fk);
        }
    }

    /**
     * Flush deferred FOREIGN KEY constraints. Called by the CLI after a
     * migration's up()/down() has run, so constraints whose referenced table
     * was created later in the same migration are added once both exist.
     * Throws if a referenced table still does not exist (a real model error).
     */
    async finalize(){
        const pending = this._pendingForeignKeys || [];
        this._pendingForeignKeys = [];
        if(pending.length === 0) return;
        const eng = this.context._SQLEngine;
        const missing = [];
        for(const fk of pending){
            const refExists = eng && typeof eng.tableExists === 'function' ? await eng.tableExists(fk.refTable) : true;
            if(refExists) await this.addForeignKey(fk);
            else missing.push(fk);
        }
        if(missing.length){
            throw new Error(
                `masterrecord: cannot create FOREIGN KEY constraint(s) — referenced table(s) do not exist: ` +
                missing.map(m => `${m.tableName}.${m.column} -> ${m.refTable}(${m.refColumn})`).join(', ') +
                `. Create the referenced table first, or mark the relationship .excludeForeignKeyFromMigrations().`
            );
        }
    }

    async createIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async dropIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async createCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async dropCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    /**
     * Create a full-text search index on a table. The engine determines
     * the underlying implementation:
     *
     *   SQLite   → FTS5 external-content virtual table + sync triggers
     *   Postgres → tsvector column + GIN index + maintenance trigger
     *   MySQL    → FULLTEXT INDEX on the named columns
     *
     * Use the matching runtime API (e.g. `ctx.MemoryDoc.search(...)`) to
     * query the index.
     *
     * @param {object} info
     * @param {string} info.tableName
     * @param {string[]} info.columns - Columns to index, in order.
     * @param {string} [info.indexName] - Optional name override.
     * @param {string} [info.config] - Postgres-only text search config ('english' default).
     *
     * @example
     * await this.createFullTextIndex({
     *     tableName: 'MemoryDoc',
     *     columns: ['title', 'body'],
     * });
     */
    async createFullTextIndex(info){
        if(!info || !info.tableName || !Array.isArray(info.columns) || info.columns.length === 0){
            throw new Error('createFullTextIndex requires { tableName, columns: [...] }');
        }
        let builder;
        if(this.context.isSQLite){ builder = new sqliteQuery(); }
        else if(this.context.isMySQL){ builder = new sqlquery(); }
        else if(this.context.isPostgres){ builder = new postgresQuery(); }
        else { throw new Error('createFullTextIndex: unsupported database engine'); }

        const statements = builder.createFullTextIndex(info);
        for(const stmt of statements){
            await this.context._execute(stmt);
        }
    }

    /**
     * Drop the full-text search index created by createFullTextIndex.
     */
    async dropFullTextIndex(info){
        if(!info || !info.tableName){
            throw new Error('dropFullTextIndex requires { tableName }');
        }
        let builder;
        if(this.context.isSQLite){ builder = new sqliteQuery(); }
        else if(this.context.isMySQL){ builder = new sqlquery(); }
        else if(this.context.isPostgres){ builder = new postgresQuery(); }
        else { throw new Error('dropFullTextIndex: unsupported database engine'); }

        const statements = builder.dropFullTextIndex(info);
        for(const stmt of statements){
            await this.context._execute(stmt);
        }
    }

    async seed(tableName, rows){
        if(!tableName || !rows){ return; }
        const items = Array.isArray(rows) ? rows : [rows];

        // Use query builders for consistent seed data handling
        if(this.context.isSQLite){
                        var queryBuilder = new sqliteQuery();
            for(const row of items){
                // SQLite: Use INSERT OR IGNORE for idempotency
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
                        var queryBuilder = new sqlquery();
            for(const row of items){
                // MySQL: Use INSERT IGNORE for idempotency
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isPostgres){
                        var queryBuilder = new postgresQuery();
            for(const row of items){
                // PostgreSQL: Use INSERT ... ON CONFLICT DO NOTHING for idempotency
                // Note: This requires a unique constraint or primary key
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query + ' ON CONFLICT DO NOTHING';
                await this.context._execute(idempotentQuery);
            }
        }
    }

    /**
     * Bulk seed data insertion (more efficient for multiple rows)
     * @param {string} tableName - Name of the table
     * @param {Array} rows - Array of data objects
     */
    async bulkSeed(tableName, rows){
        if(!tableName || !rows || rows.length === 0){ return; }

        if(this.context.isSQLite){
                        var queryBuilder = new sqliteQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
                        var queryBuilder = new sqlquery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isPostgres){
                        var queryBuilder = new postgresQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query + ' ON CONFLICT DO NOTHING';
                await this.context._execute(idempotentQuery);
            }
        }
    }
    
}


export default schema;