// version 0.0.10
// learn more about seeding info -  https://www.pauric.blog/Database-Updates-and-Migrations-with-Entity-Framework/

var fs = require('fs');
var diff = require("deep-object-diff");
var MigrationTemplate = require("./migrationTemplate");
var globSearch = require("glob");
var path = require('path');
var { resolveMigrationsDirectory } = require('./pathUtils');

// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    #organizeSchemaByTables(oldSchema, newSchema){
            var tables = []
            var seenTableNames = new Set();  // Track processed table names to prevent duplicates

            if(oldSchema.length === 0){
                newSchema.forEach(function (item, index) {
                    var tableName = item["__name"];

                    // Skip if we've already processed this table name
                    if(seenTableNames.has(tableName)){
                        console.warn(`Warning: Duplicate table definition detected for "${tableName}" - using first occurrence only`);
                        return;
                    }
                    seenTableNames.add(tableName);

                    var table = {
                        name: tableName,
                        new :item,
                        old : {},
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : [],
                        newIndexes : [],
                        deletedIndexes : [],
                        newCompositeIndexes : [],
                        deletedCompositeIndexes : [],
                        newSeedData : []
                    }
                    tables.push(table);
                });
            }
            else{
                newSchema.forEach(function (item, index) {
                    var tableName = item["__name"];

                    // Skip if we've already processed this table name
                    if(seenTableNames.has(tableName)){
                        console.warn(`Warning: Duplicate table definition detected for "${tableName}" - using first occurrence only`);
                        return;
                    }
                    seenTableNames.add(tableName);

                    var table = {
                        name: tableName,
                        old: {},
                        new :item,
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : [],
                        newIndexes : [],
                        deletedIndexes : [],
                        newCompositeIndexes : [],
                        deletedCompositeIndexes : [],
                        newSeedData : []
                    }

                    oldSchema.forEach(function (oldItem, index) {
                        var oldItemName = oldItem["__name"];
                        if(table.name === oldItemName){
                            table.old = oldItem;
                        }
                    });
                    tables.push(table);

                });
            }

            return tables;
    }

    #findDeletedColumns(tables){
            tables.forEach(function (item, index) {
                var deletedColumn = null;
                if(item.new && item.old){
                    Object.keys(item.old).forEach(function (key) {
                        var value = item.old[key].name;
                        deletedColumn = null;
                        Object.keys(item.new).forEach(function (newKey) {
                            var newValue = item.new[newKey].name;
                            if(value === newValue){
                                deletedColumn = value;
                            }
                        });
                        if(deletedColumn === null){
                            item.deletedColumns.push(value);
                        }
                    });
                }
            });
            return tables;
    }

    #findUpdatedColumns(tables){


        tables.forEach(function (item, index) {
           
            var UD = diff.updatedDiff(item.old, item.new);
            const isEmpty = Object.keys(UD).length === 0;
            if(!isEmpty){
                for (var key in UD) {
                    var tableChanges = {
                        changes : UD[key],
                        table : item.new[key],
                        tableName : item.name
                    };
                    item.updatedColumns.push(tableChanges);
                }
            }
           
        });
        return tables;
    }

    #findNewColumns(tables){
            tables.forEach(function (item, index) {
                if(item.new && item.old){
                    Object.keys(item.new).forEach(function (key) {
                        if(typeof item.new[key] === "object"){
                            var value = item.new[key].name;
                            var columnNotFound = false;
                            Object.keys(item.old).forEach(function (oldKey) {
                                if(typeof item.old[oldKey] === "object"){
                                    var oldValue = item.old[oldKey].name;
                                    if(value === oldValue){
                                        columnNotFound = true;
                                    }
                                }
                            });

                            if(columnNotFound === false){
                                // this means it did not find the column
                                
                                if(item.new[key].type !== "hasOne" && item.new[key].type !== "hasMany" && item.new[key].type !== "hasManyThrough"){
                                    // if you have to create a new table no need to create the columns
                                    if(item.newTables.length === 0){
                                        item.newColumns.push(value);
                                    }
                                
                                }
                            }
                        }
                        
                    });
                }
                else{
                    console.log("Table object has no old or new values");
                }
            });
            return tables;
    }

    #findNewTables(tables){
        // find new tables 
        tables.forEach(function (item, index) {
            if(item.new && item.old){
                    if(Object.keys(item.old).length === 0){
                        item.newTables.push(item);
                    }
            }else{
                console.log("Cannot find NEW or and Old Objects");
            }

        });
        return tables;
    }

    // build table to build new migration snapshot
    #buildMigrationObject(oldSchema, newSchema, newSeedData = {}){

        var tables = this.#organizeSchemaByTables(oldSchema, newSchema);

        tables = this.#findNewTables(tables);
        tables = this.#findNewColumns(tables);
        tables = this.#findDeletedColumns(tables);
        tables = this.#findUpdatedColumns(tables);
        tables = this.#findNewIndexes(tables);
        tables = this.#findDeletedIndexes(tables);
        tables = this.#findNewCompositeIndexes(tables);
        tables = this.#findDeletedCompositeIndexes(tables);
        tables = this.#findNewSeedData(tables, newSeedData);
        return tables;
    }

    #findNewIndexes(tables){
        tables.forEach(function (item, index) {
            // Skip new tables — createTable() in schema.js already creates their indexes
            if(item.newTables && item.newTables.length > 0) return;

            if(item.new && item.old){
                Object.keys(item.new).forEach(function (key) {
                    if(typeof item.new[key] === "object" && item.new[key].indexes){
                        var columnName = item.new[key].name;
                        var newIndexes = item.new[key].indexes;

                        // Check if this column existed before
                        var oldColumn = null;
                        Object.keys(item.old).forEach(function (oldKey) {
                            if(typeof item.old[oldKey] === "object" && item.old[oldKey].name === columnName){
                                oldColumn = item.old[oldKey];
                            }
                        });

                        // If column didn't exist before, or didn't have indexes, all indexes are new
                        if(!oldColumn || !oldColumn.indexes){
                            newIndexes.forEach(function(indexName){
                                item.newIndexes.push({
                                    tableName: item.name,
                                    columnName: columnName,
                                    indexName: indexName
                                });
                            });
                        } else {
                            // Check for new indexes that weren't in the old column
                            newIndexes.forEach(function(indexName){
                                if(!oldColumn.indexes.includes(indexName)){
                                    item.newIndexes.push({
                                        tableName: item.name,
                                        columnName: columnName,
                                        indexName: indexName
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });
        return tables;
    }

    #findDeletedIndexes(tables){
        tables.forEach(function (item, index) {
            if(item.new && item.old){
                Object.keys(item.old).forEach(function (key) {
                    if(typeof item.old[key] === "object" && item.old[key].indexes){
                        var columnName = item.old[key].name;
                        var oldIndexes = item.old[key].indexes;

                        // Check if this column still exists
                        var newColumn = null;
                        Object.keys(item.new).forEach(function (newKey) {
                            if(typeof item.new[newKey] === "object" && item.new[newKey].name === columnName){
                                newColumn = item.new[newKey];
                            }
                        });

                        // If column doesn't exist anymore, or doesn't have indexes, all indexes are deleted
                        if(!newColumn || !newColumn.indexes){
                            oldIndexes.forEach(function(indexName){
                                item.deletedIndexes.push({
                                    tableName: item.name,
                                    columnName: columnName,
                                    indexName: indexName
                                });
                            });
                        } else {
                            // Check for indexes that were removed
                            oldIndexes.forEach(function(indexName){
                                if(!newColumn.indexes.includes(indexName)){
                                    item.deletedIndexes.push({
                                        tableName: item.name,
                                        columnName: columnName,
                                        indexName: indexName
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });
        return tables;
    }

    #findNewCompositeIndexes(tables) {
        tables.forEach(function (item, index) {
            // Skip new tables — createTable() in schema.js already creates their composite indexes
            if(item.newTables && item.newTables.length > 0) return;

            if (item.new && item.old) {
                const newComposite = item.new.__compositeIndexes || [];
                const oldComposite = item.old.__compositeIndexes || [];

                newComposite.forEach(function(newIdx) {
                    const exists = oldComposite.some(oldIdx =>
                        oldIdx.name === newIdx.name
                    );

                    if (!exists) {
                        item.newCompositeIndexes.push({
                            tableName: item.name,
                            columns: newIdx.columns,
                            indexName: newIdx.name,
                            unique: newIdx.unique
                        });
                    }
                });
            }
        });
        return tables;
    }

    #findDeletedCompositeIndexes(tables) {
        tables.forEach(function (item, index) {
            if (item.new && item.old) {
                const newComposite = item.new.__compositeIndexes || [];
                const oldComposite = item.old.__compositeIndexes || [];

                oldComposite.forEach(function(oldIdx) {
                    const exists = newComposite.some(newIdx =>
                        newIdx.name === oldIdx.name
                    );

                    if (!exists) {
                        item.deletedCompositeIndexes.push({
                            tableName: item.name,
                            columns: oldIdx.columns,
                            indexName: oldIdx.name,
                            unique: oldIdx.unique
                        });
                    }
                });
            }
        });
        return tables;
    }

    #findNewSeedData(tables, newSeedData) {
        // newSeedData is from schema snapshot: { tableName: [records] }
        tables.forEach(function(item) {
            const tableSeedData = newSeedData[item.name];
            if (tableSeedData && tableSeedData.length > 0) {
                item.newSeedData = tableSeedData;
            }
        });
        return tables;
    }



    findContextFile(executedLocation, contextFileName){
        var files = globSearch.sync(`**/*${contextFileName}.js`, {
            cwd: executedLocation,
            dot: true,
            windowsPathsNoEscape: true
        });
        var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
        return file;
    }

    findContext(executedLocation, contextFileName){
        var files = globSearch.sync(`**/*${contextFileName}.js`, {
            cwd: executedLocation,
            dot: true,
            windowsPathsNoEscape: true
        });
        var file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
        if(!file){
            return null;
        }
        var context = require(file);
        return {
            context : context,
            fileLocation : file
            }
    }

    // remove hasMany and hasOne and hasManyThrough
    cleanEntities(entities){
        var newEntity = [];
        for (let i = 0; i < entities.length; i++) {
            var entity = entities[i];
            var newObj = {}

            for (let key in entity) {
                if (entity.hasOwnProperty(key)) {
              
                    if(entity[key].type !== "hasOne" && entity[key].type  !== "hasMany" && entity[key].type  !== "hasManyThrough"){
                        // if(entity[key].relationshipType == "belongsTo" ){
                        //     entity[key].name = entity[key].foreignKey;
                        // }
                        newObj[key] = entity[key];
                    }
                }
            }
            newEntity.push(newObj);
        }

        return newEntity;
    }

    createSnapShot(snap){
        // Place migrations alongside the Context file by default:
        // <ContextDir>/db/migrations/<context>_contextSnapShot.json
        // BUT: if the context file is already inside db/migrations, use that directly
        // Uses shared utility to prevent duplicate db/migrations in path
        const migrationsDirectory = resolveMigrationsDirectory(snap.file);

        // Ensure migrations directory exists
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory, { recursive: true });
        }

        const snapshotPath = path.join(migrationsDirectory, `${snap.contextFileName}_contextSnapShot.json`);

        // Store relative paths (portable): values are relative to the snapshot file directory (migrationsDirectory)
        const relContextLocation = path.relative(migrationsDirectory, snap.file);
        const relMigrationFolder = '.'; // the snapshot sits inside migrationsDirectory
        const relSnapshotLocation = path.basename(snapshotPath);

        // Order seed data by dependencies if context instance is available
        const orderedSeedData = snap.context && snap.context.getOrderedSeedData
            ? snap.context.getOrderedSeedData()
            : snap.contextSeedData || {};

        const content = {
            contextLocation: relContextLocation,
            migrationFolder: relMigrationFolder,
            snapShotLocation: relSnapshotLocation,
            schema : snap.contextEntities,
            seedData: orderedSeedData,
            seedConfig: snap.contextSeedConfig || {}
        };

        const jsonContent = JSON.stringify(content, null, 2);
        try{
            fs.writeFileSync(snapshotPath, jsonContent);
            console.log(`✓ Snapshot created at: ${snapshotPath}`);
        }catch (e){
            console.log("Cannot write file ", e);
            throw e;
        }
    }

    // validate if schema has changed based on new and old
    buildUpObject(oldSchema, newSchema){
        var tableObj = {}
        var tables = this.#buildMigrationObject(oldSchema, newSchema);

        tables.forEach(function (item, index) {
                    // add new columns for table
                    var columnInfo = tables[index];
                    // Always expose each table under its name so templates like
                    // this.createTable(table.TableName) can safely access it.
                    tableObj[item.name] = columnInfo.new;
                    
                    item.newTables.forEach(function (column, ind) {
                        tableObj[item.name] = columnInfo.new;
                    });

                    item.newColumns.forEach(function (column, ind) {
                        columnInfo.new[column].tableName = item.name;
                        tableObj[column] = columnInfo.new[column];
                    });

                    item.deletedColumns.forEach(function (column, ind) {
                        columnInfo.old[column].tableName = item.name;
                        tableObj[column] = columnInfo.old[column];
                    });

                    item.updatedColumns.forEach(function (column, ind) {
                        tableObj[column.table.name] = column;
                    });

                    if(item.new === null){
                        columnInfo.old.tableName = item.name;
                        tableObj["new"] = columnInfo.old;
                    }
                
                    tableObj.___table = item;
                });
        return tableObj;
    }

    // Returns true if there are any changes between old and new schema
    hasChanges(oldSchema, newSchema, newSeedData = {}){
        const tables = this.#buildMigrationObject(oldSchema, newSchema, newSeedData);
        for(const t of tables){
            if(!t) continue;
            if((t.newTables && t.newTables.length) ||
               (t.newColumns && t.newColumns.length) ||
               (t.deletedColumns && t.deletedColumns.length) ||
               (t.updatedColumns && t.updatedColumns.length) ||
               (t.newIndexes && t.newIndexes.length) ||
               (t.deletedIndexes && t.deletedIndexes.length) ||
               (t.newCompositeIndexes && t.newCompositeIndexes.length) ||
               (t.deletedCompositeIndexes && t.deletedCompositeIndexes.length) ||
               (t.newSeedData && t.newSeedData.length) ||
               (t.old === null) || (t.new === null)){
                return true;
            }
        }
        return false;
    }

    template(name, oldSchema, newSchema, newSeedData = {}, seedConfig = {}, currentEnv = null, moduleType = 'cjs'){
        var MT = new MigrationTemplate(name);
        // Determine current environment if not provided
        if (!currentEnv) {
            currentEnv = process.env.NODE_ENV || process.env.master || 'development';
        }
        var tables = this.#buildMigrationObject(oldSchema, newSchema, newSeedData);

        tables.forEach(function (item, index) {
            if(item.old === null){
                MT.createTable("up", column, item.name);
                MT.dropTable("down", column, item.name);
            }

            if(item.new === null){
                MT.dropTable("up", column, item.name);
                MT.createTable("down", column, item.name);
            }

            item.newTables.forEach(function (column, ind) {
                MT.createTable("up", item.name);
                MT.dropTable("down", item.name);
            });

            // add new columns for table
            item.newColumns.forEach(function (column, index) {
                MT.addColumn("up", column, item.name);
                MT.dropColumn("down", column, item.name);
            });

            item.deletedColumns.forEach(function (column, index) {
                MT.dropColumn("up", column, item.name);
                MT.addColumn("down",column, item.name);
            });

            item.updatedColumns.forEach(function (column, index) {
                const isEmpty = Object.keys(column).length === 0;
                if(!isEmpty){
                    MT.alterColumn("up", column.table.name, item.name);
                    MT.alterColumn("down", column.table.name, item.name);
                }
            });

            item.newIndexes.forEach(function (indexInfo, index) {
                MT.createIndex("up", indexInfo);
            });

            item.deletedIndexes.forEach(function (indexInfo, index) {
                MT.dropIndex("up", indexInfo);
            });

            item.newCompositeIndexes.forEach(function (indexInfo, index) {
                MT.createCompositeIndex("up", indexInfo);
            });

            item.deletedCompositeIndexes.forEach(function (indexInfo, index) {
                MT.dropCompositeIndex("up", indexInfo);
            });

            // Generate seed data code
            if (item.newSeedData && item.newSeedData.length > 0) {
                MT.seedData("up", item.name, item.newSeedData, currentEnv);
                MT.seedDataDown("down", item.name, item.newSeedData, seedConfig);
            }

        });

       return MT.get(moduleType);
    }

}

module.exports = Migrations;