// version 0.0.5
class schema{

    constructor(context){
        this.context = new context();
    }


    init(table){
        if(table){
            this.fullTable = table.___table;
        }
    }
    
    // create obj to convert into create sql
    addColumn(table){
        // todo need to work on add column for mysql
        if(table){
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
                table.realDataType = queryBuilder.typeManager(table.type);
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

            }else{
                console.log("Must call the addTable function.");
            }
        }
    }
    
    createTable(table){

        if(table){
            // If table exists, run sync instead of blind create
            const tableName = table.__name;
            if(this.context._SQLEngine.tableExists && this.context._SQLEngine.tableExists(tableName)){
                this.syncTable(table);
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
            }
        }else{
            console.log("Table that your trying to create is undefined. PLease check if there are any changes that need to be made");
        }
    }

    // Compute diffs and apply minimal changes
    syncTable(table){
        const engine = this.context._SQLEngine;
        const tableName = table.__name;
        const existing = engine.getTableInfo ? engine.getTableInfo(tableName) : [];
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
            const oldInfo = engine.getTableInfo(tableName.replace(/.*/, '_temp_alter_column_update')) || engine.getTableInfo("_temp_alter_column_update");
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
        }
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
        }
    }

    seed(tableName, rows){
        if(!tableName || !rows){ return; }
        const items = Array.isArray(rows) ? rows : [rows];
        for(const row of items){
            const cols = Object.keys(row);
            if(cols.length === 0){ continue; }
            const colList = cols.map(c => this.context.isSQLite ? `[${c}]` : `${c}`).join(", ");
            const vals = cols.map(k => {
                const v = row[k];
                if(v === null || v === undefined){ return 'NULL'; }
                if(typeof v === 'boolean'){
                    return this.context.isSQLite ? (v ? 1 : 0) : (v ? 1 : 0);
                }
                if(typeof v === 'number'){
                    return String(v);
                }
                const esc = String(v).replace(/'/g, "''");
                return `'${esc}'`;
            }).join(", ");
            const sql = `INSERT INTO ${tableName} (${colList}) VALUES (${vals})`;
            this.context._execute(sql);
        }
    }
    
}


module.exports = schema;