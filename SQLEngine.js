
class SQLEngine {
    update(query){
        var query = ` UPDATE ${query.tableName}
        SET ${query.arg} 
        WHERE ${query.primaryKey} = ${query.value}` // primary key for that table = 
        return this.execute(query);
   }

    delete(query){
       var query = `DELETE FROM ${query.tableName} WHERE ${query.primaryKey} = ${query.value}`;
       return this.execute(query);
    }

    insert(query){
        var query = `INSERT INTO ${query.tableName} (${query.columns})
        VALUES (${query.values})`;
        return this.execute(query);
    }

    execute(query){

        switch(this.db.__name) {
            case "better-sqlite3":
                console.log("SQL:", query);
                return this.db.exec(query);
                // code block
            break;
        }
    }

    get(query){
    switch(this.db.__name) {
        case "better-sqlite3":
            try {
                console.log("SQL:", query);
                return this.db.prepare(query).get();
            } catch (err) {
                console.error(err);
                return null;
            }
            // code block
        break;
        }
    }

    setDB(db){
       this.db = db;
   }
}

module.exports = SQLEngine;