
import masterrecord from "file:///Users/alexanderrich/Documents/development/opensourceHQ/MasterRecord/MasterRecord.js";
class CreateReview extends masterrecord.schema {
    constructor(context){ super(context); }
    async up(table){
        await this.init(table);
        await this.createTable(table.Review);
    }
    async down(table){
        await this.init(table);
        await this.dropTable(table.Review);
    }
}
export default CreateReview;
