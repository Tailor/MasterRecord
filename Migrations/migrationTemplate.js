var Schema = require('./schema');
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

    static up(table){
        ${this.up}
    }

    static down(table){
        ${this.down}
    }
}
module.exports = ${this.name};
        `
    }

    alterColumn(){
        this.up += os.EOL + `     this.alterColumn(table.name, table.column);` 
    }
    createTable(){
        this.up += os.EOL + `     this.createTable(table.name);` 
    }

    addColumn(){
        this.up += os.EOL + `     this.addColumn(table.name, table.column);`
    }
   
    dropTable(){
        this.down += os.EOL + `    this.droptable(table.name);`
    }

    dropColumn(){
        this.down += os.EOL + `     this.dropColumn(table.name, table.column);`
    }

}

module.exports = MigrationTemplate;

