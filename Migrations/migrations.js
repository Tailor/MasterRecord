// version 0.0.2


var fs = require('fs');
// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    createSnapShot(snap){
        var migrationsDirectory = `${snap.executedLocation}/db/migrations`;
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory);
        }
    
        var content = {
            contextLocation: snap.file,
            migrationFolder: `${snap.executedLocation}/db/migrations`,
            snapShotLocation: `${snap.executedLocation}/db/migrations/contextSnapShot.json`,
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

      /*
       object returned
        
      
      
      
      */
      
    schemaCompare(snapShots, tableList){
        var schemaList = []
        const tableKeyList = Object.keys(tableList);
        // loop through tables
        for (const tableKey of tableKeyList) {
            // check if table has already been migrated
            var tableSnapShot = snapShots[tableKey];
            if(tableSnapShot){
                // check if we have the column in the sceama
                const columnKeyList = Object.keys(tableKey);
                // loop through tables
                for (const columnKey of columnKeyList) {
                    var newTable = {};
                    if(tableSnapShot[columnKey]){

                        /*
                            id : {
                                nullabale : true,
                                type : string
                            }

                            id : {
                                nullabale : true,
                                type : int,
                                unique : true
                            }
                        
                        */
                        // if we then check if we have all the same types
                        // loop through schema list
                        // check if we have the same in the context
                        // if the same then check if if value is diffrent
                        // then delete from context
                        // after loop complete wahtever left in conext just push to object
                    }
                    else{
                        // if we dont have it then add it to the
                        newTable[columnKey] = tableKey[columnKey];
                        schemaList.push(newTable);
                    }  
                }
            }else{
                schemaList.push(contextKeys[key]);
            }
            
           
        }
    }

    migrationCodeGenerator(name, column, migrationDate){
        // will create migration file with data needed
        // using the migration template

    }


}

module.exports = Migrations;