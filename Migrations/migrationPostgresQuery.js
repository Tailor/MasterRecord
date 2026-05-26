// Version 1.0.0 - PostgreSQL migration query builder
class migrationPostgresQuery {

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
                columnList.push(`"${name}"`);
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
            "unique": true, // value has to be unique
            "auto": true, // sets the value to SERIAL/BIGSERIAL
            "cascadeOnDelete": true,
            "lazyLoading": true,
            "isNavigational": false
        }
        */

        // PostgreSQL uses SERIAL for auto-increment, not separate AUTO_INCREMENT keyword
        var auto = "";
        var primaryKey = table.primary ? " PRIMARY KEY" : "";
        var nullName = table.nullable ? "" : " NOT NULL";
        var unique = table.unique ? " UNIQUE" : "";

        // For PostgreSQL, if auto-increment primary key, use SERIAL or BIGSERIAL
        var type;
        if(table.auto && table.primary && (table.type === 'integer' || table.type === 'int')){
            type = "SERIAL";  // Auto-incrementing integer
            auto = "";
            primaryKey = " PRIMARY KEY";
        } else if(table.auto && table.primary && table.type === 'bigint'){
            type = "BIGSERIAL";
            auto = "";
            primaryKey = " PRIMARY KEY";
        } else {
            type = this.typeManager(table.type);
        }

        var tableName = table.name;
        if(table.relationshipType === 'belongsTo' && table.foreignKey){
            tableName = table.foreignKey;
        }

        var defaultValue = "";
        if(table.default !== undefined && table.default !== null){
            let def = table.default;
            if(table.type === 'boolean' || table.type === 'bool'){
                // PostgreSQL uses TRUE/FALSE for booleans
                def = (def === true || def === 'true') ? 'TRUE' : 'FALSE';
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

        return `"${tableName}" ${type}${nullName}${defaultValue}${unique}${primaryKey}${auto}`;
    }

    typeManager(type){
        switch(type) {
            case "string":
                return "VARCHAR(255)"
            case "text":
            case "mediumtext":
            case "longtext":
                // PostgreSQL TEXT is unlimited — MySQL's MEDIUMTEXT/LONGTEXT
                // sizing has no analogue here; collapse to TEXT for portability.
                return "TEXT"
            case "float":
                return "REAL"  // PostgreSQL uses REAL for single-precision
            case "decimal":
                return "DECIMAL"
            case "datetime":
                return "TIMESTAMP"
            case "timestamp":
                return "TIMESTAMP"
            case "date":
                return "DATE"
            case "time":
                return "TIME"
            case "boolean":
            case "bool":
                return "BOOLEAN"  // PostgreSQL native boolean type
            case "integer":
            case "int":
                return "INTEGER"
            case "bigint":
                return "BIGINT"
            case "binary":
                return "BYTEA"  // PostgreSQL binary data type
            case "blob":
                return "BYTEA"
            case "json":
                return "JSON"
            case "jsonb":
                return "JSONB"  // PostgreSQL binary JSON (more efficient)
            case "uuid":
                return "UUID"   // PostgreSQL native UUID type
            default:
                return "TEXT"
        }
    }

    // table is the altered field
    alterColumn(table){
        if(table){
            // PostgreSQL uses different syntax for ALTER COLUMN
            // ALTER TABLE table_name ALTER COLUMN column_name TYPE new_type;
            const colName = table.table.name;
            const tableName = table.tableName;
            const type = this.typeManager(table.table.type);

            // Build ALTER statements - PostgreSQL requires separate statements for different changes
            let statements = [];

            // Change type
            statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" TYPE ${type}`);

            // Change nullability
            if(table.table.nullable === false){
                statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL`);
            } else if(table.table.nullable === true){
                statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" DROP NOT NULL`);
            }

            // Change default
            if(table.table.default !== undefined && table.table.default !== null){
                let def = table.table.default;
                if(table.table.type === 'boolean'){
                    def = (def === true || def === 'true') ? 'TRUE' : 'FALSE';
                    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${def}`);
                } else if(table.table.type === 'integer' || table.table.type === 'float'){
                    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${def}`);
                } else {
                    const esc = String(def).replace(/'/g, "''");
                    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT '${esc}'`);
                }
            }

            // Return array of statements or join them with semicolons
            return statements.join('; ');
        }
        else{
            console.log("table information is null");
            return null;
        }
    }

    addColum(table){
        // Fixed: Use columnMapping to generate full column definition with constraints
        // This includes NOT NULL, DEFAULT, UNIQUE, PRIMARY KEY
        if(table.type && table.tableName && table.name){
            const def = this.#columnMapping(table);
            return `ALTER TABLE "${table.tableName}"
        ADD COLUMN ${def}`;
        }
        // Fallback for legacy behavior with just realDataType
        return `ALTER TABLE "${table.tableName}"
        ADD COLUMN "${table.name}" ${table.realDataType}`;
    }

    dropColumn(table){
        /*
        PostgreSQL DROP COLUMN is more flexible than SQLite
        Can drop columns with constraints if CASCADE is used.
        `IF EXISTS` makes drop-column migrations idempotent: re-running a
        migration after a failed/partial earlier run no longer errors with
        `column "X" does not exist`.
        */
        return `ALTER TABLE "${table.tableName}" DROP COLUMN IF EXISTS "${table.name}"`;
    }

    insertInto(name, table){
        return `INSERT INTO "${name}" (${this.#getTableColumns(table)})
        SELECT ${this.#getTableColumns(table)} FROM "${this.#tempTableName}"`;
    }

    createTable(table){
        var queryVar = "";

        for (var key in table) {
            // Skip metadata properties (indexes, __compositeIndexes, __name, etc.)
            if(key === 'indexes' || key.startsWith('__')){
                continue;
            }

            if(typeof table[key] === "object"){
                var col = table[key];

                if(col.type !== "hasOne" && col.type !== "hasMany" && col.type !== "hasManyThrough"){
                    // Whitelist: Only process objects that look like column definitions
                    // Valid columns must have 'name' and 'type' properties
                    if(!col.name || !col.type){
                        continue;
                    }

                    queryVar += `${this.#columnMapping(col)}, `;
                }
            }
        }

        var completeQuery = `CREATE TABLE IF NOT EXISTS "${table.__name}" (${queryVar.replace(/,\s*$/, "")});`;
        return completeQuery;
    }

    dropTable(name){
        return `DROP TABLE IF EXISTS "${name}"`;
    }

    renameTable(table){
        return `ALTER TABLE "${table.tableName}" RENAME TO "${table.newName}"`;
    }

    renameColumn(table){
        return `ALTER TABLE "${table.tableName}" RENAME COLUMN "${table.name}" TO "${table.newName}"`;
    }

    createIndex(indexInfo){
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;
        return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${indexInfo.tableName}"("${indexInfo.columnName}")`;
    }

    dropIndex(indexInfo){
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;
        return `DROP INDEX IF EXISTS "${indexName}"`;
    }

    createCompositeIndex(indexInfo){
        const columns = indexInfo.columns.map(c => `"${c}"`).join(', ');
        const uniqueKeyword = indexInfo.unique ? 'UNIQUE ' : '';
        return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${indexInfo.indexName}" ON "${indexInfo.tableName}"(${columns})`;
    }

    dropCompositeIndex(indexInfo){
        return `DROP INDEX IF EXISTS "${indexInfo.indexName}"`;
    }

    /**
     * Default name for the tsvector column added by createFullTextIndex.
     */
    _ftsColumnName() { return '__tsv'; }

    /**
     * Default name for the GIN index added by createFullTextIndex.
     */
    _ftsIndexName(tableName, indexName) {
        return indexName || `idx_${tableName.toLowerCase()}_fts`;
    }

    /**
     * Default name for the trigger function maintained by createFullTextIndex.
     */
    _ftsTriggerFunctionName(tableName) {
        return `${tableName.toLowerCase()}_tsv_update`;
    }

    /**
     * Default name for the trigger maintained by createFullTextIndex.
     */
    _ftsTriggerName(tableName) {
        return `${tableName.toLowerCase()}_tsv_trigger`;
    }

    /**
     * Build the DDL statements that create a Postgres tsvector full-text
     * index on a table. The strategy:
     *   1. Add a tsvector column (`__tsv` by default).
     *   2. Backfill it from existing rows using to_tsvector('english', ...).
     *   3. Create a GIN index on the column.
     *   4. Create a BEFORE INSERT/UPDATE trigger that keeps __tsv in sync.
     *
     * @param {object} info
     * @param {string} info.tableName
     * @param {string[]} info.columns - Source columns to concatenate into the tsvector.
     * @param {string} [info.indexName] - Override the GIN index name.
     * @param {string} [info.config='english'] - Postgres text-search config.
     * @returns {string[]} Ordered list of DDL statements.
     */
    createFullTextIndex(info){
        const cfg = info.config || 'english';
        const tsvCol = this._ftsColumnName();
        const idxName = this._ftsIndexName(info.tableName, info.indexName);
        const fnName = this._ftsTriggerFunctionName(info.tableName);
        const trgName = this._ftsTriggerName(info.tableName);

        // Concat for the existing-rows UPDATE (qualified by the column owner row).
        const concatTable = info.columns
            .map(c => `coalesce("${c}", '')`)
            .join(` || ' ' || `);

        // Concat for the trigger body — references NEW.<col>.
        const concatNew = info.columns
            .map(c => `coalesce(NEW."${c}", '')`)
            .join(` || ' ' || `);

        return [
            // 1. Add the tsvector column if it doesn't exist
            `ALTER TABLE "${info.tableName}" ADD COLUMN IF NOT EXISTS "${tsvCol}" tsvector`,
            // 2. Backfill existing rows
            `UPDATE "${info.tableName}" SET "${tsvCol}" = to_tsvector('${cfg}', ${concatTable})`,
            // 3. GIN index for fast @@ matching
            `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${info.tableName}" USING GIN ("${tsvCol}")`,
            // 4. Trigger function — $masterrecord$ dollar-quoted to avoid
            //    collision with any user-supplied content in column defaults.
            `CREATE OR REPLACE FUNCTION "${fnName}"() RETURNS trigger AS $masterrecord$
BEGIN
    NEW."${tsvCol}" := to_tsvector('${cfg}', ${concatNew});
    RETURN NEW;
END
$masterrecord$ LANGUAGE plpgsql`,
            // 5. Trigger — drop and recreate so config changes apply on re-run.
            `DROP TRIGGER IF EXISTS "${trgName}" ON "${info.tableName}"`,
            `CREATE TRIGGER "${trgName}" BEFORE INSERT OR UPDATE ON "${info.tableName}"
                FOR EACH ROW EXECUTE FUNCTION "${fnName}"()`,
        ];
    }

    /**
     * Drop the trigger, function, index, and tsvector column created by
     * createFullTextIndex.
     */
    dropFullTextIndex(info){
        const tsvCol = this._ftsColumnName();
        const idxName = this._ftsIndexName(info.tableName, info.indexName);
        const fnName = this._ftsTriggerFunctionName(info.tableName);
        const trgName = this._ftsTriggerName(info.tableName);

        return [
            `DROP TRIGGER IF EXISTS "${trgName}" ON "${info.tableName}"`,
            `DROP FUNCTION IF EXISTS "${fnName}"()`,
            `DROP INDEX IF EXISTS "${idxName}"`,
            `ALTER TABLE "${info.tableName}" DROP COLUMN IF EXISTS "${tsvCol}"`,
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
                return val ? 'TRUE' : 'FALSE';
            }
            if(typeof val === 'number'){
                return val;
            }
            // Escape strings
            const escaped = String(val).replace(/'/g, "''");
            return `'${escaped}'`;
        });

        const columnList = columns.map(c => `"${c}"`).join(', ');
        const valueList = values.join(', ');

        return `INSERT INTO "${tableName}" (${columnList}) VALUES (${valueList})`;
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
        const columnList = columns.map(c => `"${c}"`).join(', ');

        const valueRows = dataArray.map(data => {
            const values = columns.map(col => {
                const val = data[col];
                if(val === null || val === undefined){
                    return 'NULL';
                }
                if(typeof val === 'boolean'){
                    return val ? 'TRUE' : 'FALSE';
                }
                if(typeof val === 'number'){
                    return val;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `'${escaped}'`;
            });
            return `(${values.join(', ')})`;
        });

        return `INSERT INTO "${tableName}" (${columnList}) VALUES ${valueRows.join(', ')}`;
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
                    return `"${col}" = NULL`;
                }
                if(typeof val === 'boolean'){
                    return `"${col}" = ${val ? 'TRUE' : 'FALSE'}`;
                }
                if(typeof val === 'number'){
                    return `"${col}" = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `"${col}" = '${escaped}'`;
            })
            .join(', ');

        const whereClause = Object.keys(where)
            .map(col => {
                const val = where[col];
                if(val === null || val === undefined){
                    return `"${col}" IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `"${col}" = ${val ? 'TRUE' : 'FALSE'}`;
                }
                if(typeof val === 'number'){
                    return `"${col}" = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `"${col}" = '${escaped}'`;
            })
            .join(' AND ');

        return `UPDATE "${tableName}" SET ${setClause} WHERE ${whereClause}`;
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
                    return `"${col}" IS NULL`;
                }
                if(typeof val === 'boolean'){
                    return `"${col}" = ${val ? 'TRUE' : 'FALSE'}`;
                }
                if(typeof val === 'number'){
                    return `"${col}" = ${val}`;
                }
                const escaped = String(val).replace(/'/g, "''");
                return `"${col}" = '${escaped}'`;
            })
            .join(' AND ');

        return `DELETE FROM "${tableName}" WHERE ${whereClause}`;
    }
}

export default migrationPostgresQuery;

/**
 * PostgreSQL Data Types Reference:
 *
 * NATIVE_DATABASE_TYPES = {
 *   primary_key: "SERIAL PRIMARY KEY" or "BIGSERIAL PRIMARY KEY",
 *   string:      VARCHAR(255),
 *   text:        TEXT,
 *   integer:     INTEGER,
 *   bigint:      BIGINT,
 *   float:       REAL,
 *   decimal:     DECIMAL,
 *   datetime:    TIMESTAMP,
 *   timestamp:   TIMESTAMP,
 *   timestamptz: TIMESTAMPTZ,
 *   time:        TIME,
 *   date:        DATE,
 *   binary:      BYTEA,
 *   boolean:     BOOLEAN,
 *   json:        JSON,
 *   jsonb:       JSONB (recommended over JSON for performance),
 *   uuid:        UUID,
 *   xml:         XML
 * }
 *
 * Key PostgreSQL Differences:
 * 1. AUTO_INCREMENT → SERIAL or BIGSERIAL
 * 2. Backticks (`) → Double quotes (") for identifiers
 * 3. TINYINT → BOOLEAN (true/false instead of 0/1)
 * 4. BLOB → BYTEA
 * 5. Multiple ALTER COLUMN statements (can't combine TYPE and NOT NULL)
 * 6. Native JSON and JSONB support
 * 7. Native UUID support
 * 8. IF EXISTS supported in DROP TABLE
 * 9. More flexible DROP COLUMN (supports CASCADE)
 *
 * Seed Data Methods:
 * - insertSeedData(tableName, data): Insert single record
 * - bulkInsertSeedData(tableName, dataArray): Insert multiple records
 * - updateSeedData(tableName, data, where): Update existing records
 * - deleteSeedData(tableName, where): Delete records
 */
