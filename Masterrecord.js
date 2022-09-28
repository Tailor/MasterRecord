
// https://github.com/kriasoft/node-sqlite
// https://www.learnentityframeworkcore.com/dbset/deleting-data
// version 1.0.19
var context = require("./context");
var schema = require("./Migrations/schema");

class masterrecord{

    constructor(){
        this.context = context;
        this.schema = schema;
    }
}


module.exports = masterrecord;



/*

//Create new standard
var standard = new Standard();
standard.StandardName = "Standard1";

//create three new teachers
var teacher1 = new Teacher();
teacher1.TeacherName = "New Teacher1";

var teacher2 = new Teacher();
teacher2.TeacherName = "New Teacher2";

var teacher3 = new Teacher();
teacher3.TeacherName = "New Teacher3";

//add teachers for new standard
standard.Teachers.Add(teacher1);
standard.Teachers.Add(teacher2);
standard.Teachers.Add(teacher3);

using (var dbCtx = new SchoolDBEntities())
{
    //add standard entity into standards entitySet
    dbCtx.Standards.Add(standard);
    //Save whole entity graph to the database
    dbCtx.SaveChanges();
}
*/