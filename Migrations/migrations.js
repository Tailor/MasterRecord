// version 0.0.8
// learn more about seeding info -  https://www.pauric.blog/Database-Updates-and-Migrations-with-Entity-Framework/

var fs = require('fs');
var diff = require("deep-object-diff");
var MigrationTemplate = require("./migrationTemplate");
var globSearch = require("glob");

// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    #organizeSchemaByTables(oldSchema, newSchema){
            var tables = []
            if(oldSchema.length === 0){
                newSchema.forEach(function (item, index) {
                    var table = {
                        name: item["__name"],
                        new :item,
                        old : {},
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : []
                    }
                    tables.push(table);
                });
            }
            else{
                newSchema.forEach(function (item, index) {
                    var table = {
                        name: item["__name"],
                        old: null,
                        new :item,
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : []
                    }
                    
                    oldSchema.forEach(function (oldItem, index) {
                        var oldItemName = oldItem["__name"];
                        if(table.name === oldItemName){
                            table.old = oldItem;
                            tables.push(table);
                        }
                    });
    
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
                                item.newColumns.push(value);
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
    #buildMigrationObject(oldSchema, newSchema){
        var tables = this.#organizeSchemaByTables(oldSchema, newSchema);
        tables = this.#findNewTables(tables);
        tables = this.#findNewColumns(tables);
        tables = this.#findDeletedColumns(tables);
        tables = this.#findUpdatedColumns(tables);
        return tables;
    }



    findContext(executedLocation, contextFileName){
        var search = `${executedLocation}/**/*${contextFileName}.js`
        var files = globSearch.sync(search, executedLocation);
        var file = files[0];
        var context = require(file);
        return {
            context : context,
            fileLocation : file
            }
    }

    createSnapShot(snap){
        
        var dbFolder = `${snap.executedLocation}/db`;
        if (!fs.existsSync(dbFolder)){
            fs.mkdirSync(dbFolder);
        }

        var migrationsDirectory = `${snap.executedLocation}/db/migrations`;
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory);
        }
    
        var content = {
            contextLocation: snap.file,
            migrationFolder: `${snap.executedLocation}/db/migrations`,
            snapShotLocation: `${snap.executedLocation}/db/migrations/${snap.contextFileName}_contextSnapShot.json`,
            schema : snap.contextEntities
        };
    
        const jsonContent = JSON.stringify(content, null, 2);
        try{
          // will replace the whole file if it exist
            fs.writeFileSync(`${migrationsDirectory}/${snap.contextFileName}_contextSnapShot.json`, jsonContent);
        }catch (e){
            console.log("Cannot write file ", e);
        }
    }

    //
    buildUpObject(oldSchema, newSchema){
        var tableObj = {}
        var tables = this.#buildMigrationObject(oldSchema, newSchema); 
        tables.forEach(function (item, index) {
                    // add new columns for table
                    var columnInfo = tables[index];
                    
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
                        tableObj[column] = columnInfo.old;
                    }

                    tableObj.___table = item;
                });
        return tableObj;
    }

    template(name, oldSchema, newSchema){
        var MT = new MigrationTemplate(name);
        var tables = this.#buildMigrationObject(oldSchema, newSchema);
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

        });

       return MT.get();
    }


}

module.exports = Migrations;