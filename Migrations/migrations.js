// version 0.0.4
// learn more about seeding info -  https://www.pauric.blog/Database-Updates-and-Migrations-with-Entity-Framework/

var fs = require('fs');
var diff = require("deep-object-diff");
var MigrationTemplate = require("./migrationTemplate");
var globSearch = require("glob");
const { table } = require('console');

// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    getContext(executedLocation, contextFileName){
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
        var migrationsDirectory = `${snap.executedLocation}/db/migrations`;
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory);
        }
    
        var content = {
            contextLocation: snap.file,
            migrationFolder: `${snap.executedLocation}/db/migrations`,
            snapShotLocation: `${snap.executedLocation}/db/migrations/${snap.contextFileName}_contextSnapShot.json`,
            schema : snap.context.__entities
        };
    
        const jsonContent = JSON.stringify(content, null, 2);
        try{
          // will replace the whole file if it exist
            fs.writeFileSync(`${migrationsDirectory}/${snap.contextFileName}_contextSnapShot.json`, jsonContent);
        }catch (e){
            console.log("Cannot write file ", e);
        }
    }

    organizeSchemaByTables(oldSchema, newSchema){
            var tables = []

            newSchema.forEach(function (item, index) {

                var table = {
                    name: item["__name"],
                    old: null,
                    new :item,
                    newColumns : [],
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

            return tables;
    }

    findDeletedColumnsInTables(tables){
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

    findUpdatedColumns(tables){
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

    findNewColumnsInTables(tables){
            tables.forEach(function (item, index) {
                var newColumn = null;
                if(item.new && item.old){
                    Object.keys(item.new).forEach(function (key) {
                        var value = item.new[key].name;
                        newColumn = null;
                        Object.keys(item.old).forEach(function (oldKey) {
                            var oldValue = item.old[oldKey].name;
                            if(value === oldValue){
                                newColumn = value;
                            }
                        });
                        if(newColumn === null){
                            item.newColumns.push(value);
                        }
                    });
                }
            });
            return tables;
    }

    // build table to build new migration snapshot
    buildMigrationObject(oldSchema, newSchema){
        var tables = this.organizeSchemaByTables(oldSchema, newSchema);
        tables = this.findNewColumnsInTables(tables);
        tables = this.findDeletedColumnsInTables(tables);
        tables = this.findUpdatedColumns(tables);
        return tables;
    }

    //
    callMigrationUp(oldSchema, newSchema){
        var tableObj = {}
        var tables = this.buildMigrationObject(oldSchema, newSchema);
        tables.forEach(function (item, index) {
                    // add new columns for table
                    var columnInfo = tables[index];
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

                    if(item.old === null){
                        columnInfo.new.tableName = item.name;
                        tableObj[column] = columnInfo.new;
                    }

                    if(item.new === null){
                        columnInfo.old.tableName = item.name;
                        tableObj[column] = columnInfo.old;
                    }
                    tableObj.___table = item;
                });
                return tableObj;
    }

    buildMigrationTemplate(name, oldSchema, newSchema){

        var MT = new MigrationTemplate(name);
        var tables = this.buildMigrationObject(oldSchema, newSchema);
        tables.forEach(function (item, index) {
            // add new columns for table
            item.newColumns.forEach(function (column, index) {
                MT.addColumn("up", column);
                MT.dropColumn("down", column);
            });

            item.deletedColumns.forEach(function (column, index) {
                MT.dropColumn("up", column);
                MT.addColumn("down",column);
            });

            item.updatedColumns.forEach(function (column, index) {
                const isEmpty = Object.keys(column).length === 0;
                if(!isEmpty){
                    MT.alterColumn("up", column.table.name);
                    MT.alterColumn("down", column.table.name);
                }
            });

            if(item.old === null){
                MT.createTable("up", column);
                MT.dropTable("down", column);

            }
            if(item.new === null){
                MT.dropTable("up", column);
                MT.createTable("down", column);
            }

        });

       return MT.get();
    

    }

    migrationCodeGenerator(name, column, migrationDate){
        // will create migration file with data needed
        // using the migration template

    }


}

module.exports = Migrations;