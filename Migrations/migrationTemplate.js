const os = require('os');

// https://channel9.msdn.com/Blogs/EF/Migrations-Under-the-Hood

class MigrationTemplate {
    up = ''
    down = ''
    constructor(name) {
      this.name = name;
    }

    get(){
        return ` 
class ${this.name} extends Schema { 
    constructor(context){
        super(context);
    }

    up(table){
        ${this.up}
    }

    down(table){
        ${this.down}
    }
}
module.exports = ${this.name};
        `
    }

    alterColumn(){
        if(type === "up"){
            this.up += os.EOL + `     this.alterColumn(table.name, table.column);` 
        }
        else{
            this.down += os.EOL + `     this.alterColumn(table.name, table.column);` 
        }
    }
    createTable(){
        if(type === "up"){
            this.up += os.EOL + `     this.createTable(table.name);` 
        }
        else{
            this.down += os.EOL + `     this.createTable(table.name);` 
        }
    }

    addColumn(type){
        if(type === "up"){
            this.up += os.EOL + `     this.addColumn(table.name, table.column);`
        }
        else{
            this.down += os.EOL + `     this.addColumn(table.name, table.column);`
        }
    }
    
   
    dropTable(type){
        if(type === "up"){
            this.down += os.EOL + `    this.droptable(table.name);`
        }
        else{
            this.down += os.EOL + `    this.droptable(table.name);`
        }
    }

    dropColumn(type){
        if(type === "up"){
            this.up += os.EOL + `     this.dropColumn(table.name, table.column);`
        }
        else{
            this.down += os.EOL + `     this.dropColumn(table.name, table.column);`
        }
    }

}

module.exports = MigrationTemplate;

