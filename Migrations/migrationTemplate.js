var Migration = require('./migrations');


// https://channel9.msdn.com/Blogs/EF/Migrations-Under-the-Hood


// migration Logic
// using the command line run the command - "add migration 'name' 'context file location' ";
// this will call the context which will return on object of entities
// then call the previous migration and pass that model object and the context object to the EDMModelDiffer
// the EDMModelDiffer function to calculate database changes
// EDMModelDiffer will return only database changes model that have not been implemented already
// we then create the miration using function 'migrationCodeGenerator' based on the model that was provided by EDMModelDiffer
// js date stamp Date.now()

class Migration extends Migration {

    constructor() {
        super();
    }

    static up(){

        this.createTable("user", {
            id : {
                type : "integer",
                primary : true,
                unique : true,
                nullable : false
            },
            user_id : {
                type : "integer",
                required : true, // SQL Data Constraints
                foreignKey : "user" // SQL Data Constraints
            },
            website_url : {
                type : "string",
                required : true,
                maxLength : 60
            },
            website_type : {
                type : "string",
                required : true
            }
        });

        this.addColumn("blog", "url", {
            type : "string",
            required : true
        });

        this.done();
    }

    static down(){
        this.dropTable("user");

        this.dropColumn("blog", "url");

        this.done();      
    }
}

module.exports = Migration;