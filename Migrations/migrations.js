// version 0.0.4
// learn more about seeding info -  https://www.pauric.blog/Database-Updates-and-Migrations-with-Entity-Framework/

var fs = require('fs');
var diff = require("deep-object-diff");
var MigrationTemplate = require("./migrationTemplate");
var globSearch = require("glob");

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
                item.updatedColumns.push(diff.updatedDiff(item.old, item.new));
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
                    item.newColumns.forEach(function (column, index) {
                        tables[index].new[column].tableName = item.name;
                        tableObj[column] = tables[index].new[column];
                    });

                    item.deletedColumns.forEach(function (column, index) {
                        tables[index].old[column].tableName = item.name;
                        tableObj[column] =tables[index].old[column];
                    });

                    item.updatedColumns.forEach(function (column, index) {
                        tables[index].new[column].tableName = item.name;
                        tableObj[column] = tables[index].new[column];
                    });

                    if(item.old === null){
                        tables[index].new.tableName = item.name;
                        tableObj[column] = tables[index].new;
                    }

                    if(item.new === null){
                        tables[index].old.tableName = item.name;
                        tableObj[column] = tables[index].old;
                    }

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
                MT.alterColumn("up", column);
                MT.alterColumn("down", column)
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