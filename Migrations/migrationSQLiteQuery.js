

class migrationSQLiteQuery {

    addColum(table){
        var buildDefinations = this.buildDefinations(table);
        return `ALTER TABLE ${table.name}
        ADD ${table.column} ${buildDefinations}`;

        /*
            column definations
            NULL
            TEXT. The value is a text string, stored using the database encoding (UTF-8, UTF-16BE or UTF-16LE).
            BLOB. The value is a blob of data, stored exactly as it was input
            INTEGER,
            real
        */
    }

    buildDefinations(definations){
        return "";
    }

    createTable(){
            `CREATE TABLE devices (
                name TEXT NOT NULL,
                model TEXT NOT NULL,
                Serial INTEGER NOT NULL UNIQUE
            );`

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

    }

    dropIndex(){

    }
//"dbo.People", "Location"
    alterColumn(){

    }

    renameColumn(){
        `ALTER TABLE existing_table
        RENAME TO new_table;`
    }

    
}


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