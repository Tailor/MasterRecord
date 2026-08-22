import { defaultSqlClause, computedClause, checkClause, assertDdlOptions, compositePrimaryKeyClause } from "./ddlClauses.js";

// verison 0.0.4
class migrationMySQLQuery {

    #tempTableName = "_temp_alter_column_update"
    
    #getTableColumns(table){
        const columnList = [];
        for (const key in table) {
            if(typeof table[key] === "object"){
                const col = table[key];
                // Skip relationship-only fields
                if(col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough'){
                    continue;
                }
                // Map belongsTo to its foreignKey name
                const name = (col.relationshipType === 'belongsTo' && col.foreignKey) ? col.foreignKey : col.name;
                columnList.push(`\`${name}\``);
            }
        }
        return columnList.join(',');
    }

    #columnMapping(table, suppressPk = false){
        /*
        var mapping = {
            "name": "id", // if this changes then call rename column
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

        // suppressPk: part of a composite key -> emitted as a table-level PRIMARY KEY (a, b)
        const auto = (table.auto && !suppressPk) ? " AUTO_INCREMENT":"";
        const primaryKey = (table.primary && !suppressPk) ? " PRIMARY KEY" : "";
        const nullName = (table.nullable && !(table.primary && suppressPk)) ? "" : " NOT NULL";
        const unique = (table.unique && !(table.primary && suppressPk)) ? " UNIQUE" : "";   // primary() implies unique; a composite key is unique as a whole
        const type = this.typeManager(table.type);
        let tableName = table.name;
        if(table.relationshipType === 'belongsTo' && table.foreignKey){
            tableName = table.foreignKey;
        }
        let defaultValue  = "";
        if(table.default !== undefined && table.default !== null){
            let def = table.default;
            if(table.type === 'boolean'){
                def = this.boolType(def);
                defaultValue = ` DEFAULT ${def}`;
            }
            else if(table.type === 'integer' || table.type === 'float' || table.type === 'decimal'){
                defaultValue = ` DEFAULT ${def}`;
            }
            else{
                const esc = String(def).replace(/'/g, "''");
                defaultValue = ` DEFAULT '${esc}'`;
            }
        }

        assertDdlOptions(table);
        const q = (n) => '`' + String(n).replace(/`/g, '``') + '`';
        if (table.computedSql) {
            // DB-generated: no default / PK / autoincrement; the ORM never writes it.
            return `${q(tableName)} ${type}${computedClause(table, 'mysql')}${nullName}${unique}${checkClause(table, q)}`;
        }
        return `${q(tableName)} ${type}${nullName}${defaultValue || defaultSqlClause(table, 'mysql')}${checkClause(table, q)}${unique}${primaryKey}${auto}`;
    }

    boolType(type){
        switch(type) {
            case "true":
            case true:
                return "1";
            case "false":
            case false:
                return "0";
            default:
                return type;
        }
    }

    typeManager(type){
        switch(type) {
            case "string":
                return "VARCHAR(255)"
            case "text":
                return "TEXT"
            case "mediumtext":
                return "MEDIUMTEXT"
            case "longtext":
                return "LONGTEXT"
            case "float":
                return "FLOAT(24)"
            case "decimal":
                return "DECIMAL"
            case "datetime":
            case "timestamp":
            case "date":
            case "time":
                // Match the SQLite and Postgres engines, which store every
                // temporal type as TEXT "for cross-engine portability":
                // masterrecord apps write epoch-millis / ISO strings into these
                // columns (entity get/set hooks like `db.get((v) => v || Date.now())`),
                // which native DATETIME/TIMESTAMP/DATE/TIME columns reject at
                // INSERT (e.g. "Incorrect datetime value" for a bigint). TEXT
                // keeps the engines interchangeable. (Postgres was fixed in
                // 1.4.7; MySQL had the identical bug.)
                return "TEXT"
            case "boolean":
                return "TINYINT"
            case "integer":
            case "int":
                return "INTEGER"
            case "bigint":
                return "BIGINT"
            case "uuid":
                // MySQL has no native UUID type; store as fixed-length string.
                return "VARCHAR(36)"
            case "binary":
            case "blob":
                return "BLOB"
            case "json":
            case "jsonb":
                return "JSON"
            default:
                // Fallback so we never emit `undefined` for an unknown type
                // (matches SQLite's and Postgres's lenient behavior).
                return "TEXT"
        }
    }

    // table is the altered field
    alterColumn( table){
      
        if(table){

            return `ALTER TABLE \`${table.tableName}\` MODIFY COLUMN ${this.#columnMapping(table.table || table)} `;
        }
        else{
            console.log("table information is null");
            return null;
        }
    }

    alterNullable(table){
        // check if has value
        if(typeof table.changes.nullable !== 'undefined'){
            // if it does we want to add that to the alter statment
        }
    }


    addColum(table){
        // Fixed: Use columnMapping to generate full column definition with constraints
        // This includes NOT NULL, DEFAULT, UNIQUE, PRIMARY KEY, AUTO_INCREMENT
        if(table.type && table.tableName && table.name){
            const def = this.#columnMapping(table);
            return `ALTER TABLE \`${table.tableName}\`
        ADD ${def}`;
        }
        // Fallback for legacy behavior with just realDataType
        return `ALTER TABLE \`${table.tableName}\`
        ADD \`${table.name}\` ${table.realDataType}`;

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

        No `IF EXISTS`: MySQL has never supported it on DROP COLUMN (that is
        MariaDB syntax), and emitting it made every drop-column migration fail
        with ER_PARSE_ERROR — silently, when the caller swallowed the error.
        schema.dropColumn() probes the live schema first and skips a column
        that is already gone, so drops stay idempotent without the clause.
        */
        return `ALTER TABLE \`${table.tableName}\` DROP COLUMN \`${table.name}\``;
    }

    insertInto(name, table){
        return `INSERT INTO ${name} (${this.#getTableColumns(table)})
        SELECT ${this.#getTableColumns(table)} FROM ${this.#tempTableName}`;
    }

    createTable(table){

        let queryVar = "";
        const compositePk = compositePrimaryKeyClause(table, (n) => '`' + String(n).replace(/`/g, '``') + '`');
        //console.log("Dsfdsfdsf---------", table)
        for (const key in table) {
            // Skip metadata properties (indexes, __compositeIndexes, __name, etc.)
            if(key === 'indexes' || key.startsWith('__')){
                continue;
            }

            if(typeof table[key] === "object"){
                const col = table[key];

                if(col.type !== "hasOne" && col.type  !== "hasMany" && col.type  !== "hasManyThrough"){
                    // Whitelist: Only process objects that look like column definitions
                    // Valid columns must have 'name' and 'type' properties
                    if(!col.name || !col.type){
                        continue;
                    }

                    queryVar += `${this.#columnMapping(col, !!compositePk)}, `;
                }
            }
        }
        if (compositePk) queryVar += `${compositePk}, `;   // EF HasKey(a, b)

        const completeQuery = `CREATE TABLE IF NOT EXISTS \`${table.__name}\` (${queryVar.replace(/,\s*$/, "")});`;
        return completeQuery;

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
        // IF EXISTS keeps dropTable idempotent — consistent with createTable's
        // `IF NOT EXISTS` and dropColumn's skip-if-gone, and matching the Postgres
        // builder. A migration that DROPs a legacy table which never existed on a
        // fresh install is then a no-op instead of a hard failure.
        return `DROP TABLE IF EXISTS \`${name}\``
    }

    renameTable(table){
        return `ALTER TABLE \`${table.tableName}\` RENAME TO \`${table.newName}\``;
    }

    renameColumn(table){
        return `ALTER TABLE \`${table.tableName}\` RENAME COLUMN \`${table.name}\` TO \`${table.newName}\``
    }

    /** FOREIGN KEY constraint added after both tables exist (MySQL auto-indexes the FK column). */
    addForeignKey(fk){
        return `ALTER TABLE \`${fk.tableName}\` ADD CONSTRAINT \`${fk.name}\` FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\` (\`${fk.refColumn}\`) ON DELETE ${fk.onDelete || 'CASCADE'}`;
    }

    dropForeignKey(fk){
        return `ALTER TABLE \`${fk.tableName}\` DROP FOREIGN KEY \`${fk.name}\``;
    }

    createIndex(indexInfo){
        // MySQL has no partial/filtered indexes — fail loudly rather than
        // silently emit a non-filtered index (which would enforce the wrong
        // constraint). Enforce the invariant in the write path, or use a
        // generated column. Postgres and SQLite support `where` natively.
        if (indexInfo.where) {
            throw new Error(`masterrecord: MySQL does not support partial/filtered indexes (the \`where\` option on index '${indexInfo.indexName}'). Enforce this invariant in the write path (e.g. a transactional clear-then-set), or use a generated column. Postgres and SQLite support partial indexes natively.`);
        }
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;
        const uniqueKeyword = indexInfo.unique ? 'UNIQUE ' : '';
        return `CREATE ${uniqueKeyword}INDEX \`${indexName}\` ON \`${indexInfo.tableName}\`(\`${indexInfo.columnName}\`)`;
    }

    dropIndex(indexInfo){
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;
        return `DROP INDEX \`${indexName}\` ON \`${indexInfo.tableName}\``;
    }

    createCompositeIndex(indexInfo){
        if (indexInfo.where) {
            throw new Error(`masterrecord: MySQL does not support partial/filtered indexes (the \`where\` option on index '${indexInfo.indexName}'). Enforce this invariant in the write path (e.g. a transactional clear-then-set), or use a generated column. Postgres and SQLite support partial indexes natively.`);
        }
        const columns = indexInfo.columns.map(c => `\`${c}\``).join(', ');
        const uniqueKeyword = indexInfo.unique ? 'UNIQUE ' : '';
        return `CREATE ${uniqueKeyword}INDEX \`${indexInfo.indexName}\` ON \`${indexInfo.tableName}\`(${columns})`;
    }

    dropCompositeIndex(indexInfo){
        return `DROP INDEX \`${indexInfo.indexName}\` ON \`${indexInfo.tableName}\``;
    }

    _ftsIndexName(tableName, indexName) {
        return indexName || `idx_${tableName.toLowerCase()}_fts`;
    }

    /**
     * Build the DDL that adds a MySQL FULLTEXT index to a table. MySQL
     * maintains the index automatically — no triggers needed. Requires
     * MySQL 5.6+ (InnoDB) or any MyISAM table.
     *
     * @param {object} info
     * @param {string} info.tableName
     * @param {string[]} info.columns
     * @param {string} [info.indexName]
     * @returns {string[]}
     */
    createFullTextIndex(info){
        const idxName = this._ftsIndexName(info.tableName, info.indexName);
        const cols = info.columns.map(c => `\`${c}\``).join(', ');
        return [
            `ALTER TABLE \`${info.tableName}\` ADD FULLTEXT INDEX \`${idxName}\` (${cols})`,
        ];
    }

    /**
     * Drop the FULLTEXT index created by createFullTextIndex.
     */
    dropFullTextIndex(info){
        const idxName = this._ftsIndexName(info.tableName, info.indexName);
        return [
            `ALTER TABLE \`${info.tableName}\` DROP INDEX \`${idxName}\``,
        ];
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
                return val ? '1' : '0';  // MySQL TINYINT for boolean
            }
            if(typeof val === 'number'){
                return val;
            }
            // Escape strings
            const escaped = String(val).replace(/'/g, "''");
            return `'${escaped}'`;
        });

        const columnList = columns.map(c => `\`${c}\``).join(', ');
        const valueList = values.join(', ');

        return `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${valueList})`;
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
        const columnList = columns.map(c => `\`${c}\``).join(', ');

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

        return `INSERT INTO \`${tableName}\` (${columnList}) VALUES ${valueRows.join(', ')}`;
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
                    return `\`${col}\` = NULL`;
                }
                if(typeof val === 'boolean'){
                    return `\`${col}\` = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `\`${col}\` = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `\`${col}\` = '${escaped}'`;
            })
            .join(', ');

        const whereClause = Object.keys(where)
            .map(col => {
                const val = where[col];
                if(val === null || val === undefined){
                    return `\`${col}\` IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `\`${col}\` = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `\`${col}\` = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `\`${col}\` = '${escaped}'`;
            })
            .join(' AND ');

        return `UPDATE \`${tableName}\` SET ${setClause} WHERE ${whereClause}`;
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
                    return `\`${col}\` IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `\`${col}\` = ${val ? '1' : '0'}`;
                }
                if(typeof val === 'number'){
                    return `\`${col}\` = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `\`${col}\` = '${escaped}'`;
            })
            .join(' AND ');

        return `DELETE FROM \`${tableName}\` WHERE ${whereClause}`;
    }


}


export default migrationMySQLQuery;

/**
 * 
 * 
 * 
 * 
MySQL Data Types NATIVE_DATABASE_TYPES = {
        primary_key: "bigint auto_increment PRIMARY KEY",
        string:      { name: "varchar", limit: 255 },
        text:        { name: "text" },
        integer:     { name: "int", limit: 4 },
        float:       { name: "float", limit: 24 },
        decimal:     { name: "decimal" },
        datetime:    { name: "datetime" },
        timestamp:   { name: "timestamp" },
        time:        { name: "time" },
        date:        { name: "date" },
        binary:      { name: "blob" },
        blob:        { name: "blob" },
        boolean:     { name: "tinyint", limit: 1 },
        json:        { name: "json" },
      }


PostgreSQL Data Types NATIVE_DATABASE_TYPES = {
        primary_key: "bigserial primary key",
        string:      { name: "character varying" },
        text:        { name: "text" },
        integer:     { name: "integer", limit: 4 },
        float:       { name: "float" },
        decimal:     { name: "decimal" },
        datetime:    {}, # set dynamically based on datetime_type
        timestamp:   { name: "timestamp" },
        timestamptz: { name: "timestamptz" },
        time:        { name: "time" },
        date:        { name: "date" },
        daterange:   { name: "daterange" },
        numrange:    { name: "numrange" },
        tsrange:     { name: "tsrange" },
        tstzrange:   { name: "tstzrange" },
        int4range:   { name: "int4range" },
        int8range:   { name: "int8range" },
        binary:      { name: "bytea" },
        boolean:     { name: "boolean" },
        xml:         { name: "xml" },
        tsvector:    { name: "tsvector" },
        hstore:      { name: "hstore" },
        inet:        { name: "inet" },
        cidr:        { name: "cidr" },
        macaddr:     { name: "macaddr" },
        uuid:        { name: "uuid" },
        json:        { name: "json" },
        jsonb:       { name: "jsonb" },
        ltree:       { name: "ltree" },
        citext:      { name: "citext" },
        point:       { name: "point" },
        line:        { name: "line" },
        lseg:        { name: "lseg" },
        box:         { name: "box" },
        path:        { name: "path" },
        polygon:     { name: "polygon" },
        circle:      { name: "circle" },
        bit:         { name: "bit" },
        bit_varying: { name: "bit varying" },
        money:       { name: "money" },
        interval:    { name: "interval" },
        oid:         { name: "oid" },
      }
 */


      /****
       * 
       * 
       * console.log("sdfdsfdsf", this.#tempTableName);
        return `ALTER TABLE ${table.tableName} MODIFY COLUMN NOT NULL`
        TODO -- We need to find a way build the alter query based on the data that is changed
        //ALTER TABLE MyTable MODIFY COLUMN comment BIGINT NOT NULL;
        if(table){
            table.newName = this.#tempTableName;
            //console.log("----------------------", table)
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
       */