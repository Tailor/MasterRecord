
import masterrecord from "file:///Users/alexanderrich/Documents/development/opensourceHQ/MasterRecord/MasterRecord.js";
class CreateBook extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){
        await this.init(table);
        await this.createTable(table.Book);
    }
    async down(table){
        await this.init(table);
        await this.dropTable(table.Book);
    }
}
export default CreateBook;
