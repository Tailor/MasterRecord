// version 0.0.6
class schema{

    constructor(context){
        this.context = new context();
        this._dbEnsured = false;
    }


    init(table){
        if(table){
            this.fullTable = table.___table;
        }
        // Ensure backing database exists for MySQL before running any DDL
        if(this.context && this.context.isMySQL && this._dbEnsured !== true){
            try{ this.createDatabase(); }catch(_){ /* best-effort */ }
        }
    }
    
    // create obj to convert into create sql
    addColumn(table){
        // todo need to work on add column for mysql
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                // Fixed: Use addColum (consistent with MySQL/PostgreSQL) instead of alterColumn
                // This allows explicit column definitions to work, not just CLI-generated migrations
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                // Note: No need to set table.realDataType - columnMapping handles type conversion internally
                var query = queryBuilder.addColum(table);
                this.context._execute(query);
            }
        }

        // add column to database
    }

    dropColumn(table){
        if(table){
            if(this.fullTable){
                // drop column
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var query = queryBuilder.dropColumn(table);
                    this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.dropColumn(table);
                    this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
                    var queryBuilder = new postgresQuery();
                    var query = queryBuilder.dropColumn(table);
                    this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }
    
    async createTable(table){

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
                    this.context._execute(query);
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.createTable(table);
                    this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
                    var queryBuilder = new postgresQuery();
                    var query = queryBuilder.createTable(table);
                    this.context._execute(query);
                }

                // Create indexes for columns that have .index() defined
                const self = this;
                Object.keys(table).forEach(function(key){
                    if(typeof table[key] === "object" && table[key].indexes && !key.startsWith('__')){
                        const columnName = table[key].name;
                        table[key].indexes.forEach(function(indexName){
                            const indexInfo = {
                                tableName: tableName,
                                columnName: columnName,
                                indexName: indexName
                            };
                            self.createIndex(indexInfo);
                        });
                    }
                });

                // Create composite indexes
                if (table.__compositeIndexes) {
                    table.__compositeIndexes.forEach(function(compositeIdx) {
                        const indexInfo = {
                            tableName: tableName,
                            columns: compositeIdx.columns,
                            indexName: compositeIdx.name,
                            unique: compositeIdx.unique
                        };
                        self.createCompositeIndex(indexInfo);
                    });
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
            if(typeof table[key] === 'object'){
                const col = table[key];
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
                        this.context._execute(add);
                    }
                    if(this.context.isMySQL){
                        var sqlquery = require("./migrationMySQLQuery");
                        var queryBuilder = new sqlquery();
                        newCol.realDataType = queryBuilder.typeManager(col.type);
                        const query = queryBuilder.addColum(newCol);
                        this.context._execute(query);
                    }
                    if(this.context.isPostgres){
                        var postgresQuery = require("./migrationPostgresQuery");
                        var queryBuilder = new postgresQuery();
                        newCol.realDataType = queryBuilder.typeManager(col.type);
                        const query = queryBuilder.addColum(newCol);
                        this.context._execute(query);
                    }
                }
            }
        }
        // Detect modifications (nullable/default/type)
        const desiredCols = [];
        for (var key in table) {
            if(typeof table[key] === 'object'){
                const col = table[key];
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
                    this.context._execute(alter);
                }
            }
        }

        if(needRebuildSQLite()){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            // rename old table
            const rename = queryBuilder.renameTable({ tableName, newName: "_temp_alter_column_update" });
            this.context._execute(rename);
            // create new with desired schema
            const create = queryBuilder.createTable(table);
            this.context._execute(create);
            // compute common columns
            const oldInfo = await engine.getTableInfo(tableName.replace(/.*/, '_temp_alter_column_update')) || await engine.getTableInfo("_temp_alter_column_update");
            const oldNames = new Set((oldInfo || existing).map(r => r.name));
            const newNames = desiredCols.map(d => d.name);
            const common = newNames.filter(n => oldNames.has(n));
            if(common.length > 0){
                const cols = common.join(',');
                const insert = `INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM _temp_alter_column_update`;
                this.context._execute(insert);
            }
            const drop = queryBuilder.dropTable("_temp_alter_column_update");
            this.context._execute(drop);
        }
    }


    dropTable(table){
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropTable(table.__name);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropTable(table.__name);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropTable(table.__name);
                this.context._execute(query);
            }
        }
    }

    // EnsureCreated equivalent for MySQL: create DB if missing
    async createDatabase(){
        try{
            if(!(this.context && this.context.isMySQL)){ return; }
            const MySQLAsyncClient = require('masterrecord/mySQLAsyncConnect');
            const client = this.context.db; // main client (may not be connected yet)
            if(!client || !client.config || !client.config.database){ return; }
            const dbName = client.config.database;
            // Build server-level connection (no database)
            const baseConfig = { ...client.config };
            delete baseConfig.database;
            const admin = new MySQLAsyncClient(baseConfig);
            await admin.connect();
            const pool = admin.getPool();
            if(!pool){ return; }

            // Use parameterized query for checking database existence
            const [rows] = await pool.execute(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [dbName]);
            const exists = Array.isArray(rows) && rows.length > 0;
            if(!exists){
                // Validate database name (alphanumeric, underscore, hyphen only)
                if(!/^[a-zA-Z0-9_-]+$/.test(dbName)){
                    throw new Error(`Invalid database name: ${dbName}. Only alphanumeric characters, underscores, and hyphens are allowed.`);
                }
                // CREATE DATABASE doesn't support placeholders, but we've validated the name
                await pool.execute(`CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            }
            await admin.close();
            this._dbEnsured = true;
        }catch(err){
            // Non-fatal: migrations may still proceed if DB already exists or permissions blocked
            try{ console.error(err); }catch(_){ }
        }
    }

    // Alias for consistency with user expectation
    createdatabase(table){
        return this.createDatabase(table);
    }


   //"dbo.People", "Location"
    alterColumn(table){
        if(table){
            if(this.fullTable){
                if(this.context.isSQLite){
                    var sqliteQuery = require("./migrationSQLiteQuery");
                    var queryBuilder = new sqliteQuery();
                    var queryObj = queryBuilder.alterColumn(this.fullTable.new, table);
                    for (var key in queryObj) {
                        var query = queryObj[key];
                        this.context._execute(query);
                    }
                }

                if(this.context.isMySQL){
                    var sqlquery = require("./migrationMySQLQuery");
                    var queryBuilder = new sqlquery();
                    var query = queryBuilder.alterColumn(table);
                    this.context._execute(query);
                }

                if(this.context.isPostgres){
                    var postgresQuery = require("./migrationPostgresQuery");
                    var queryBuilder = new postgresQuery();
                    var query = queryBuilder.alterColumn(table);
                    this.context._execute(query);
                }

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }

    renameColumn(table){
        if(table){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.renameColumn(table);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.renameColumn(table);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.renameColumn(table);
                this.context._execute(query);
            }
        }
    }

    createIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.createIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createIndex(indexInfo);
                this.context._execute(query);
            }
        }
    }

    dropIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropIndex(indexInfo);
                this.context._execute(query);
            }
        }
    }

    createCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.createCompositeIndex(indexInfo);
                this.context._execute(query);
            }
        }
    }

    dropCompositeIndex(indexInfo){
        if(indexInfo){
            if(this.context.isSQLite){
                var sqliteQuery = require("./migrationSQLiteQuery");
                var queryBuilder = new sqliteQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isMySQL){
                var sqlquery = require("./migrationMySQLQuery");
                var queryBuilder = new sqlquery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                this.context._execute(query);
            }

            if(this.context.isPostgres){
                var postgresQuery = require("./migrationPostgresQuery");
                var queryBuilder = new postgresQuery();
                var query = queryBuilder.dropCompositeIndex(indexInfo);
                this.context._execute(query);
            }
        }
    }

    seed(tableName, rows){
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
                this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
            var sqlquery = require("./migrationMySQLQuery");
            var queryBuilder = new sqlquery();
            for(const row of items){
                // MySQL: Use INSERT IGNORE for idempotency
                const query = queryBuilder.insertSeedData(tableName, row);
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                this.context._execute(idempotentQuery);
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
                this.context._execute(idempotentQuery);
            }
        }
    }

    /**
     * Bulk seed data insertion (more efficient for multiple rows)
     * @param {string} tableName - Name of the table
     * @param {Array} rows - Array of data objects
     */
    bulkSeed(tableName, rows){
        if(!tableName || !rows || rows.length === 0){ return; }

        if(this.context.isSQLite){
            var sqliteQuery = require("./migrationSQLiteQuery");
            var queryBuilder = new sqliteQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
                this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isMySQL){
            var sqlquery = require("./migrationMySQLQuery");
            var queryBuilder = new sqlquery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query.replace(/^INSERT INTO/, 'INSERT IGNORE INTO');
                this.context._execute(idempotentQuery);
            }
        }

        if(this.context.isPostgres){
            var postgresQuery = require("./migrationPostgresQuery");
            var queryBuilder = new postgresQuery();
            const query = queryBuilder.bulkInsertSeedData(tableName, rows);
            if(query){
                const idempotentQuery = query + ' ON CONFLICT DO NOTHING';
                this.context._execute(idempotentQuery);
            }
        }
    }
    
}


module.exports = schema;