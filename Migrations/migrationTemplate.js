
const Masterrecord = require('masterrecord');
// https://channel9.msdn.com/Blogs/EF/Migrations-Under-the-Hood


// migration Logic
// using the command line run the command - "add migration 'name' 'context file location' ";
// this will call the context which will return on object of entities
// then call the previous migration and pass that model object and the context object to the EDMModelDiffer
// the EDMModelDiffer function to calculate database changes
// EDMModelDiffer will return only database changes model that have not been implemented already
// we then create the miration using function 'migrationCodeGenerator' based on the model that was provided by EDMModelDiffer
// js date stamp Date.now()
class Migration extends Masterrecord.Migrations {

    constructor() {
        super();
    }

    // Public field declaration
    models = {
            "user": {
                id : {
                    type : Number,
                    primary : true,
                    default : "0",
                    nullable : false
                },
                user_id : {
                    type : Number,
                    required : true,
                    foreignKey : "user"
                },
                website_url : {
                    type : String,
                    required : true,
                    maxLength : 60
                },
                website_type : {
                    type : String,
                    required : true
                }
            },
            "blog": {
                url : {
                    type : String,
                    required : true
                }
            }
    };

    static up(){

        this.createTable("user", model["user"]);

        this.addColumn("blog", "url", model["blog"]["url"]);

        this.done();
    }

    static down(){
        this.dropTable("user");

        this.dropColumn("blog", "url");

        this.done();      
    }
}

module.exports = Migration;