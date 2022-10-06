
// verison 0.0.2
class migrationSQLiteQuery {

    tempTableName = "_temp_alter_column_update"
        
    alterColumn(fullTable, table){
        if(table){
            table.newName = this.tempTableName;
            return {
                1 : this.renameTable(table),
                2 : this.createTable(table.tableName, fullTable),
                3 : this.insertInto(table.tableName, fullTable),
                4 : this.dropTable(this.tempTableName)
            }
        }
        else{
            console.log("table information is null")
        }
    }


    addColum(table){
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

    insertInto(name, table){
        return `INSERT INTO ${name} (${this.getTableColumns(table)})
        SELECT ${this.getTableColumns(table)} FROM ${this.tempTableName}`;
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

    columnMapping(table){
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
        var type = this.typeManager(table.type);

        return `${table.name} ${type}${nullName}${unique}${primaryKey}${auto}`;
    }

    getTableColumns(table){
        var columnList = [];
        for (var key in table) {
            if(typeof table[key] === "object"){
                columnList.push(table[key].name);
            }
        }
        return columnList.join(',');;
    }

    createTable(name, table){
        var queryVar = "";
        for (var key in table) {
            if(typeof table[key] === "object"){
                queryVar += `${this.columnMapping(table[key])}, `;
            }
        }
     
        return `CREATE TABLE ${name} (${queryVar.replace(/,\s*$/, "")});`;

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

    dropIndex(){

    }

    renameTable(table){
        return `ALTER TABLE ${table.tableName} RENAME TO ${table.newName}`;
    }

    renameColumn(table){
        return `ALTER TABLE ${table.tableName} RENAME COLUMN ${table.name} TO ${table.newName}`
    }

    typeManager(type){
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