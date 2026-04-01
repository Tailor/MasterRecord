// version 0.0.6
const { _poolKey } = require('masterrecord/context');

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
            const MySQLAsyncClient = require('masterrecord/mySQLConnect');
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
        const MySQLEngine = require('masterrecord/mySQLEngine');
        const MySQLAsyncClient = require('masterrecord/mySQLConnect');

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
            const { Pool } = require('pg');
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
        const PostgresClient = require('masterrecord/postgresSyncConnect');

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
        // todo need to work on add column for mysql
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                // Fixed: Use addColum (consistent with MySQL/PostgreSQL) instead of alterColumn
                // This allows explicit column definitions to work, not just CLI-generated migrations
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                await this.context._execute(query);
            }
        }

        // add column to database
    }

    async dropColumn(table){
        if(table){
            if(this.fullTable){
                // drop column
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.dropColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.dropColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
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
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
                    var queryBuilder = new postgresQuery();
                    var query = queryBuilder.createTable(table);
                    await this.context._execute(query);
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
                    // add column
                    const newCol = {
                        tableName: tableName,
                        name: colName,
                        type: col.type
                    };
                    // MySQL path uses addColum with realDataType
                    if(this.context.isSQLite){
                        var sqliteQuery = require("./migrationSQLiteQuery");
                        var queryBuilder = new sqliteQuery();
                        // Build a conservative column add (no NOT NULL without default)
                        const add = queryBuilder.addColum({ tableName, name: colName });
                        await this.context._execute(add);
                    }
                    if(this.context.isMySQL){
                        var sqlquery = require("./migrationMySQLQuery");
                        var queryBuilder = new sqlquery();
                        newCol.realDataType = queryBuilder.typeManager(col.type);
                        const query = queryBuilder.addColum(newCol);
                        await this.context._execute(query);
                    }
                    if(this.context.isPostgres){
                        var postgresQuery = require("./migrationPostgresQuery");
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
            const byName = {};
            for(const row of existing){ byName[row.name] = row; }
            for(const d of desiredCols){
                const row = byName[d.name];
                if(!row) continue;
                const notnull = row.notnull === 1;
                const desiredNotNull = d.col.nullable === false;
                const desiredType = d.col.type;
                const existingType = (row.type || '').toLowerCase();
                // compare default (normalize quotes)
                const exDefRaw = row.dflt_value == null ? null : String(row.dflt_value);
                let exDef = exDefRaw;
                if(typeof exDef === 'string' && exDef.length >= 2 && exDef.startsWith("'") && exDef.endsWith("'")){
                    exDef = exDef.slice(1, -1);
                }
                const dsDef = d.col.default == null ? null : String(d.col.default);
                if(desiredNotNull !== notnull) return true;
                if(exDef !== dsDef) return true;
                // rough type differences that require rebuild
                if((desiredType === 'boolean' && existingType !== 'integer') ||
                   (desiredType === 'string' && existingType !== 'text') ||
                   (desiredType === 'integer' && existingType !== 'integer')){
                    return true;
                }
            }
            return false;
        };

        if(this.context.isMySQL){
            // Apply MODIFY for defaults/nullability
            var sqlquery = require("./migrationMySQLQuery");
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
                    const alter = `ALTER TABLE ${tableName} MODIFY COLUMN ${d.name} ${type} ${nullPart}${defPart}`;
                    await this.context._execute(alter);
                }
            }
        }

        if(needRebuildSQLite()){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            // rename old table
            const rename = queryBuilder.renameTable({ tableName, newName: "_temp_alter_column_update" });
            await this.context._execute(rename);
            // create new with desired schema
            const create = queryBuilder.createTable(table);
            await this.context._execute(create);
            // compute common columns
            const oldInfo = await engine.getTableInfo(tableName.replace(/.*/, '_temp_alter_column_update')) || await engine.getTableInfo("_temp_alter_column_update");
            const oldNames = new Set((oldInfo || existing).map(r => r.name));
            const newNames = desiredCols.map(d => d.name);
            const common = newNames.filter(n => oldNames.has(n));
            if(common.length > 0){
                const cols = common.join(',');
                const insert = `INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM _temp_alter_column_update`;
                await this.context._execute(insert);
            }
            const drop = queryBuilder.dropTable("_temp_alter_column_update");
            await this.context._execute(drop);
        }
    }


    async dropTable(table){
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropTable(table.__name);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropTable(table.__name);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
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
        if(table){
            if(this.fullTable){
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var tableSchema = (this._tableObj && this._tableObj[table.tableName]) || this.fullTable.new;
                    var queryObj = queryBuilder.alterColumn(tableSchema, table);
                    for (var key in queryObj) {
                        var query = queryObj[key];
                        await this.context._execute(query);
                    }
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.alterColumn(table);
                    await this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
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
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.renameColumn(table);
                await this.context._execute(query);
            }
        }
    }

    async createIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async dropIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async createCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async dropCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                await this.context._execute(query);
            }
        }
    }

    async seed(tableName, rows){
        if(!tableName || !rows){ return; }
        const items = Array.isArray(rows) ? rows : [rows];

        // Use query builders for consistent seed data handling
        if(this.context.isSQLite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            for(const row of items){
                // SQLite: Use INSERT OR IGNORE for idempotency
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
            var sqlquery = require("./migrationMySQLQuery");
            var queryBuilder = new sqlquery();
            for(const row of items){
                // MySQL: Use INSERT IGNORE for idempotency
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isPostgres){
            var postgresQuery = require("./migrationPostgresQuery");
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
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
            var sqlquery = require("./migrationMySQLQuery");
            var queryBuilder = new sqlquery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                await this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isPostgres){
            var postgresQuery = require("./migrationPostgresQuery");
            var queryBuilder = new postgresQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query + ' ON CONFLICT DO NOTHING';
                await this.context._execute(idempotentQuery);
            }
        }
    }
    
}


module.exports = schema;