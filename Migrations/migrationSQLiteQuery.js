
// verison 0.0.7
class migrationSQLiteQuery {

    #tempTableName = "_temp_alter_column_update"
    
    #getTableColumns(table){
        var columnList = [];
        for (var key in table) {
            if(typeof table[key] === "object"){
                columnList.push(table[key].name);
            }
        }
        return columnList.join(',');;
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
                queryVar += `${this.#columnMapping(table[key])}, `;
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