
// verison 0.0.7
class migrationSQLiteQuery {

    #tempTableName = "_temp_alter_column_update"
    
    #getTableColumns(table){
        var columnList = [];
        for (var key in table) {
            if(typeof table[key] === "object"){
                var col = table[key];
                // Skip relationship-only fields
                if(col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough'){
                    continue;
                }
                // Map belongsTo to its foreignKey name
                var name = (col.relationshipType === 'belongsTo' && col.foreignKey) ? col.foreignKey : col.name;
                columnList.push(name);
            }
        }
        return columnList.join(',');
    }

    #columnMapping(table){
        /*
        var mapping = {
            "name": "id", // if this chnages then call rename column
            "type": "integer", // if this changes then call altercolumn 
            "primary": false, // is primary key 
            "nullable": false, // is nullable 
            "unique": true, // vlaue has to be uniqe
            "auto": true, // sets the value to AUTOINCREMENT
            "cascadeOnDelete": true,
            "lazyLoading": true,
            "isNavigational": false
        
        }
        */
        // name TEXT NOT NULL,

        var auto = table.auto ? " AUTOINCREMENT":"";
        var primaryKey = table.primary ? " PRIMARY KEY" : "";
        var nullName = table.nullable ? "" : " NOT NULL";
        var unique = table.unique ? " UNIQUE" : "";
        var type = this.#typeManager(table.type);
        var colName = table.name;
        if(table.relationshipType === 'belongsTo' && table.foreignKey){
            colName = table.foreignKey;
        }
        // DEFAULT clause
        var defaultClause = "";
        if(table.default !== undefined && table.default !== null){
            let def = table.default;
            if(table.type === 'boolean'){
                def = (def === true || def === 'true') ? 1 : 0;
                defaultClause = ` DEFAULT ${def}`;
            }
            else if(table.type === 'integer' || table.type === 'float' || table.type === 'decimal'){
                defaultClause = ` DEFAULT ${def}`;
            }
            else{
                const esc = String(def).replace(/'/g, "''");
                defaultClause = ` DEFAULT '${esc}'`;
            }
        }

        return `${colName} ${type}${nullName}${defaultClause}${unique}${primaryKey}${auto}`;
    }

    #typeManager(type){
        switch(type) {
            case "string":
                return "TEXT"
              break;
            case "time":
                return "TEXT"
              break;
              case "boolean":
                return "INTEGER"
              break;
              case "integer":
                return "INTEGER"
              break;
          }
          
    }  

    alterColumn(fullTable, table){
        if(table){
            table.newName = this.#tempTableName;
            return {
                1 : this.renameTable(table),
                2 : this.createTable(fullTable),
                3 : this.insertInto(table.tableName, fullTable),
                4 : this.dropTable(this.#tempTableName)
            }
        }
        else{
            console.log("table information is null")
        }
    }


    addColum(table){
        // If a full column spec is provided, map it to a proper SQLite column definition
        if(table.column){
            const def = this.#columnMapping(table.column);
            return `ALTER TABLE ${table.tableName}
        ADD COLUMN ${def}`;
        }
        // Fixed: Support direct column definitions (when table itself IS the column spec)
        // This matches MySQL/PostgreSQL behavior for explicit column definitions
        if(table.type && table.tableName && table.name){
            const def = this.#columnMapping(table);
            return `ALTER TABLE ${table.tableName}
        ADD COLUMN ${def}`;
        }
        // Fallback legacy behavior: raw name provided must include full definition if caller wants type/constraints
        return `ALTER TABLE ${table.tableName}
        ADD COLUMN ${table.name}`;

        /*
            column definations
            NULL
            TEXT. The value is a text string, stored using the database encoding (UTF-8, UTF-16BE or UTF-16LE).
            BLOB. The value is a blob of data, stored exactly as it was input
            INTEGER,
            real
        */
    }

    dropColumn(table){
        /*
        COLUMNS CANNOT BE DROPPED - RULES
        has unique constraint
        is indexed
        appears in a view
        */
        return `ALTER TABLE ${table.tableName} DROP COLUMN ${table.name}`
    }

    insertInto(name, table){
        return `INSERT INTO ${name} (${this.#getTableColumns(table)})
        SELECT ${this.#getTableColumns(table)} FROM ${this.#tempTableName}`;
    }

    createTable(table){
        var queryVar = "";
        for (var key in table) {
            if(typeof table[key] === "object"){
                var col = table[key];
                // Skip relationship-only fields
                if(col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough'){
                    continue;
                }
                queryVar += `${this.#columnMapping(col)}, `;
            }
        }
    
        return `CREATE TABLE IF NOT EXISTS ${table.__name} (${queryVar.replace(/,\s*$/, "")});`;

            /*
                INTEGER PRIMARY KEY AUTOINCREMENT
                    all these are equal to interger
                INT
                INTEGER
                TINYINT
                SMALLINT
                MEDIUMINT
                BIGINT
                UNSIGNED BIG INT
                INT2
                INT8 
            */
    }


    dropTable(name){
        return `DROP TABLE ${name}`
    }

    renameTable(table){
        return `ALTER TABLE ${table.tableName} RENAME TO ${table.newName}`;
    }

    renameColumn(table){
        return `ALTER TABLE ${table.tableName} RENAME COLUMN ${table.name} TO ${table.newName}`
    }

    /**
     * SEED DATA METHODS
     * Support for inserting seed data during migrations
     */

    /**
     * Insert seed data into a table
     * @param {string} tableName - Name of the table
     * @param {Object} data - Data object with column names as keys
     * @returns {string} INSERT query
     */
    insertSeedData(tableName, data){
        const columns = Object.keys(data).filter(k => !k.startsWith('__'));
        const values = columns.map(col => {
            const val = data[col];
            if(val === null || val === undefined){
                return 'NULL';
            }
            if(typeof val === 'boolean'){
                return val ? '1' : '0';  // SQLite INTEGER for boolean
            }
            if(typeof val === 'number'){
                return val;
            }
            // Escape strings
            const escaped = String(val).replace(/'/g, "''");
            return `'${escaped}'`;
        });

        const columnList = columns.join(', ');
        const valueList = values.join(', ');

        return `INSERT INTO ${tableName} (${columnList}) VALUES (${valueList})`;
    }

    /**
     * Insert multiple seed records at once
     * @param {string} tableName - Name of the table
     * @param {Array} dataArray - Array of data objects
     * @returns {string} Bulk INSERT query
     */
    bulkInsertSeedData(tableName, dataArray){
        if(!dataArray || dataArray.length === 0){
            return '';
        }

        const firstRow = dataArray[0];
        const columns = Object.keys(firstRow).filter(k => !k.startsWith('__'));
        const columnList = columns.join(', ');

        const valueRows = dataArray.map(data => {
            const values = columns.map(col => {
                const val = data[col];
                if(val === null || val === undefined){
                    return 'NULL';
                }
                if(typeof val === 'boolean'){
                    return val ? '1' : '0';
                }
                if(typeof val === 'number'){
                    return val;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `'${escaped}'`;
            });
            return `(${values.join(', ')})`;
        });

        return `INSERT INTO ${tableName} (${columnList}) VALUES ${valueRows.join(', ')}`;
    }

    /**
     * Update seed data (useful for down migrations)
     * @param {string} tableName - Name of the table
     * @param {Object} data - Data to update
     * @param {Object} where - WHERE conditions
     * @returns {string} UPDATE query
     */
    updateSeedData(tableName, data, where){
        const setClause = Object.keys(data)
            .filter(k => !k.startsWith('__'))
            .map(col => {
                const val = data[col];
                if(val === null || val === undefined){
                    return `${col} = NULL`;
                }
                if(typeof val === 'boolean'){
                    return `${col} = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `${col} = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `${col} = '${escaped}'`;
            })
            .join(', ');

        const whereClause = Object.keys(where)
            .map(col => {
                const val = where[col];
                if(val === null || val === undefined){
                    return `${col} IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `${col} = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `${col} = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `${col} = '${escaped}'`;
            })
            .join(' AND ');

        return `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
    }

    /**
     * Delete seed data (useful for down migrations)
     * @param {string} tableName - Name of the table
     * @param {Object} where - WHERE conditions
     * @returns {string} DELETE query
     */
    deleteSeedData(tableName, where){
        const whereClause = Object.keys(where)
            .map(col => {
                const val = where[col];
                if(val === null || val === undefined){
                    return `${col} IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `${col} = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `${col} = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `${col} = '${escaped}'`;
            })
            .join(' AND ');

        return `DELETE FROM ${tableName} WHERE ${whereClause}`;
    }


}


module.exports = migrationSQLiteQuery; 


/*
 ADDING NEW COLUMN SQLITE 
     There are some restrictions on the new column:
            The new column cannot have a UNIQUE or PRIMARY KEY constraint.
            If the new column has a NOT NULL constraint, you must specify a default value for the column other than a NULL value.
            The new column cannot have a default of CURRENT_TIMESTAMP, CURRENT_DATE, and CURRENT_TIME, or an expression.
            If the new column is a foreign key and the foreign key constraint check is enabled, the new column must accept a default value NULL.

*/

/*

DROPING A COLUMN SQLITE 
        Possible reasons why the DROP COLUMN command can fail include:

                The column is a PRIMARY KEY or part of one.
                The column has a UNIQUE constraint.
                The column is indexed.
                The column is named in the WHERE clause of a partial index.
                The column is named in a table or column CHECK constraint not associated with the column being dropped.
                The column is used in a foreign key constraint.
                The column is used in the expression of a generated column.
                The column appears in a trigger or view.

*/