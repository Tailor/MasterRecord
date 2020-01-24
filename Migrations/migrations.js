// version 1
var fs = require('fs');
// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context



/*
SQLITE CREATE MIGRATIONS
CREATE TABLE "user" (
	"id"	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
	"auth_id"	INTEGER NOT NULL,
	"view_counter"	INTEGER NOT NULL DEFAULT 0,
	"background_image_id"	INTEGER NOT NULL,
	"profile_image_id"	INTEGER NOT NULL,
	"full_name"	TEXT NOT NULL,
	"languages"	TEXT,
	"profile_email"	TEXT,
	"phone_number"	TEXT,
	"birthmonth"	TEXT,
	"birthday"	TEXT,
	"created_at"	TEXT,
	"updated_at"	TEXT
);

*/

class Migrations{
    // SQL Lite doesnt have a date so please use TEXT fields;

    EDMModelDiffer(snapShot, contextModel){
            
        // do a diff and return only diff fields
        // if table doesnt exist then add a create database object.
    }

    migrationCodeGenerator(name, column, migrationDate){
        // will create migration file with data needed
        // using the migration template

    }


}

module.exports = Migrations;