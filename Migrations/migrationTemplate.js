

// https://channel9.msdn.com/Blogs/EF/Migrations-Under-the-Hood
// version 0.0.3

const os = require('os');
class MigrationTemplate {

    constructor(name) {
        this.name = name;
    }

    #up = ''
    #down = ''

    get(){
        return ` 
         
var masterrecord = require('masterrecord');

class ${this.name} extends masterrecord.schema { 
    constructor(context){
        super(context);
    }

    up(table){
        this.init(table);
        ${this.#up}
    }

    down(table){
        this.init(table);
        ${this.#down}
    }
}
module.exports = ${this.name};
        `
    }

    alterColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.alterColumn(table.${parent}.${name});` 
        }
        else{
            this.#down += os.EOL + `     this.alterColumn(table.${parent}.${name});` 
        }
    }
    createTable(type, name){
        if(type === "up"){
            this.#up += os.EOL + `     this.createTable(table.${name});` 
        }
        else{
            this.#down += os.EOL + `     this.createTable(table.${name});` 
        }
    }

    addColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.addColumn(table.${parent}.${name});`
        }
        else{
            this.#down += os.EOL + `     this.addColumn(table.${parent}.${name});`
        }
    }
    
   
    dropTable(type, name){
        if(type === "up"){
            this.#down += os.EOL + `    this.droptable(table.${name});`
        }
        else{
            this.#down += os.EOL + `    this.droptable(table.${name});`
        }
    }

    dropColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.dropColumn(table.${parent}.${name});`
        }
        else{
            this.#down += os.EOL + `     this.dropColumn(table.${parent}.${name});`
        }
    }

}

module.exports = MigrationTemplate;

