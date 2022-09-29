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
         
var masterrecord = require('masterrecord');

class ${this.name} extends masterrecord.schema { 
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

    alterColumn(type, name){
        if(type === "up"){
            this.up += os.EOL + `     this.alterColumn(table.${name});` 
        }
        else{
            this.down += os.EOL + `     this.alterColumn(table.${name});` 
        }
    }
    createTable(type, name){
        if(type === "up"){
            this.up += os.EOL + `     this.createTable(table.${name});` 
        }
        else{
            this.down += os.EOL + `     this.createTable(table.${name});` 
        }
    }

    addColumn(type, name){
        if(type === "up"){
            this.up += os.EOL + `     this.addColumn(table.${name});`
        }
        else{
            this.down += os.EOL + `     this.addColumn(table.${name});`
        }
    }
    
   
    dropTable(type, name){
        if(type === "up"){
            this.down += os.EOL + `    this.droptable(table.${name});`
        }
        else{
            this.down += os.EOL + `    this.droptable(table.${name});`
        }
    }

    dropColumn(type, name){
        if(type === "up"){
            this.up += os.EOL + `     this.dropColumn(table.${name});`
        }
        else{
            this.down += os.EOL + `     this.dropColumn(table.${name});`
        }
    }

}

module.exports = MigrationTemplate;

