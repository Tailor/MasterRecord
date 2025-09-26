
// verison 0.0.4
class migrationMySQLQuery {

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

        var auto = table.auto ? " AUTO_INCREMENT":"";
        var primaryKey = table.primary ? " PRIMARY KEY" : "";
        var nullName = table.nullable ? "" : " NOT NULL";
        var unique = table.unique ? " UNIQUE" : "";
        var type = this.typeManager(table.type);
        var tableName = table.name;
        if(table.relationshipType === 'belongsTo' && table.foreignKey){
            tableName = table.foreignKey;
        }
        var defaultValue  = "";
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

        return `${tableName} ${type}${nullName}${defaultValue}${unique}${primaryKey}${auto}`;
    }

    boolType(type){
        switch(type) {
            case "true":
                return "1"
              break;
              case "false":
                return "0"
              break;
              case true:
                return "1"
              break;
              case false:
                return "0"
              break;
              default:
                return type;
        }
    }

    typeManager(type){
        switch(type) {
            case "string":
                return "VARCHAR(255)"
              break;
            case "text":
                return "TEXT"
              break;
            case "float":
                return "fLOAT(24)"
              break;
            case "decimal":
                return "DECIMAL"
              break;
            case "datetime":
                return "DATETIME"
              break;
            case "timestamp":
                return "TIMESTAMP"
              break;
            case "date":
                return "DATE"
              break;
            case "time":
                return "TIME"
              break;
            case "boolean":
                return "TINYINT"
              break;
            case "integer":
                return "INTEGER"
              break;
            case "binary":
                return "BLOB"
              break;
            case "blob":
                return "BLOB"
              break;
            case "json":
                return "JSON"
              break;
          }
          // :string, :text, :integer, :float, :decimal, :datetime, :timestamp, :time, :date, :binary, :boolean
    }  

    // table is the altered field
    alterColumn( table){
      
        if(table){

            return `ALTER TABLE ${table.tableName} MODIFY COLUMN ${this.#columnMapping(table.table)} `;
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
        return `ALTER TABLE ${table.tableName}
        ADD ${table.name} ${table.realDataType}`;

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
        return `ALTER TABLE ${table.tableName} DROP COLUMN ${table.name}`;
    }

    insertInto(name, table){
        return `INSERT INTO ${name} (${this.#getTableColumns(table)})
        SELECT ${this.#getTableColumns(table)} FROM ${this.#tempTableName}`;
    }

    createTable(table){

        var queryVar = "";
        //console.log("Dsfdsfdsf---------", table)
        for (var key in table) {
            if(typeof table[key] === "object"){

                if(table[key].type !== "hasOne" && table[key].type  !== "hasMany" && table[key].type  !== "hasManyThrough"){
                    queryVar += `${this.#columnMapping(table[key])}, `;
                }
            }
        }

        var completeQuery = `CREATE TABLE IF NOT EXISTS ${table.__name} (${queryVar.replace(/,\s*$/, "")});`;
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
        return `DROP TABLE ${name}`
    }

    renameTable(table){
        return `ALTER TABLE ${table.tableName} RENAME TO ${table.newName}`;
    }

    renameColumn(table){
        return `ALTER TABLE ${table.tableName} RENAME COLUMN ${table.name} TO ${table.newName}`
    }

    
}


module.exports = migrationMySQLQuery; 

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