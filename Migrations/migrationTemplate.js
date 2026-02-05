

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

    async up(table){
        this.init(table);
        ${this.#up}
    }

    async down(table){
        this.init(table);
        ${this.#down}
    }
}
module.exports = ${this.name};
        `
    }

    alterColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.alterColumn(table.${name});` 
        }
        else{
            this.#down += os.EOL + `     this.alterColumn(table.${name});` 
        }
    }
    createTable(type, name){
        if(type === "up"){
            this.#up += os.EOL + `     await this.createTable(table.${name});`
        }
        else{
            this.#down += os.EOL + `     await this.createTable(table.${name});`
        }
    }

    addColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.addColumn(table.${name});`
        }
        else{
            this.#down += os.EOL + `     this.addColumn(table.${name});`
        }
    }
    //this.addColumn(table.${parent}.${name});`
   
    dropTable(type, name){
        if(type === "up"){
            this.#down += os.EOL + `    this.dropTable(table.${name});`
        }
        else{
            this.#down += os.EOL + `    this.dropTable(table.${name});`
        }
    }

    dropColumn(type, name, parent){
        if(type === "up"){
            this.#up += os.EOL + `     this.dropColumn(table.${name});`
        }
        else{
            this.#down += os.EOL + `     this.dropColumn(table.${name});`
        }
    }

    createIndex(type, indexInfo){
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;

        const indexInfoStr = JSON.stringify({
            tableName: indexInfo.tableName,
            columnName: indexInfo.columnName,
            indexName: indexInfo.indexName
        });

        if(type === "up"){
            this.#up += os.EOL + `     this.createIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     this.dropIndex(${indexInfoStr});`
        }
    }

    dropIndex(type, indexInfo){
        const indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;

        const indexInfoStr = JSON.stringify({
            tableName: indexInfo.tableName,
            columnName: indexInfo.columnName,
            indexName: indexInfo.indexName
        });

        if(type === "up"){
            this.#up += os.EOL + `     this.dropIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     this.createIndex(${indexInfoStr});`
        }
    }

}

module.exports = MigrationTemplate;

