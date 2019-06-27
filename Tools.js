class Tools{

    static buildSQLEqualTo(model){
        var argument = null;
        var dirtyFields = model.__dirtyFields;
        for (var column in dirtyFields) {
            // column1 = value1, column2 = value2, ...
            var value = model[dirtyFields[column]];
            // TODO Boolean value is a string with a letter
            if(typeof value === "number"){
                argument = argument === null ? `${dirtyFields[column]} = ${model[dirtyFields[column]]},` : `${argument} ${dirtyFields[column]} = ${model[dirtyFields[column]]},`;
            }else{
                argument = argument === null ? `${dirtyFields[column]} = '${model[dirtyFields[column]]}',` : `${argument} ${dirtyFields[column]} = '${model[dirtyFields[column]]}',`;
            }
        }
        return argument.replace(/,\s*$/, "");
    }
    
    // return columns and value strings
    static getInsertObj(fields){
        var columns = null;
        var values = null;
        for (var column in fields.__entity) {
            // column1 = value1, column2 = value2, ...
            if(column.indexOf("__") === -1 ){
                if(fields[column] !== undefined){
                    columns = columns === null ? `${column},` : `${columns} ${column},`;
                    var fieldColumn = fields[column];
                    if(fields.__entity[column].type.name === "String"){
                        fieldColumn = `"${fields[column]}"`;
                    }
                    values = values === null ? `${fieldColumn},` : `${values} ${fieldColumn},`;
                }
            }
        }

        return{
            columns :columns.replace(/,\s*$/, ""),
            values : values.replace(/,\s*$/, "")
        }
    }

    static getPrimaryKeyObject(model){
        for (var key in model) {
            if (model.hasOwnProperty(key)) {
                if(model[key].primary){
                    if(model[key].primary === true){
                        return key
                    }
                }
            }
        }
    }
}

module.exports = Tools;