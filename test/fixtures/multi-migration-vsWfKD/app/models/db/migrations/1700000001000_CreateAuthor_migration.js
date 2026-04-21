
import masterrecord from "file:///Users/alexanderrich/Documents/development/opensourceHQ/MasterRecord/MasterRecord.js";
class CreateAuthor extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){
        await this.init(table);
        await this.createTable(table.Author);
    }
    async down(table){
        await this.init(table);
        await this.dropTable(table.Author);
    }
}
export default CreateAuthor;
