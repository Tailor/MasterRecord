
class SQLEngine {
    static update(query){
        var query = ` UPDATE ${query.tableName}
        SET ${query.arg} 
        WHERE ${query.primaryKey} = ${query.value}` // primary key for that table = 
        return this.execute(query);
   }

   static delete(query){
       var query = `DELETE FROM ${query.tableName} WHERE ${query.primaryKey} = ${query.value}`;
       return this.execute(query);
    }

    static insert(query){
        var query = `INSERT INTO ${query.tableName} (${query.columns})
        VALUES (${query.values})`;
        return this.execute(query);
    }

   static execute(query){

        switch(this.db.__name) {
            case "better-sqlite3":
                console.log("SQL:", query);
                return this.db.exec(query);
                // code block
            break;
        }
   }

   static get(query){
    switch(this.db.__name) {
        case "better-sqlite3":
            try {
                console.log("SQL:", query);
                return this.db.prepare(query).get();
            } catch (err) {
                console.error(err);
            }
            // code block
        break;
    }
}

   static setDB(db){
       this.db = db;
   }


}

module.exports = SQLEngine;