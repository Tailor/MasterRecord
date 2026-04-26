
import context from "file:///Users/alexanderrich/Documents/development/opensourceHQ/MasterRecord/context.js";

class Author {
    id(db) { db.integer().primary().auto(); }
    name(db) { db.string(); }
}
class Book {
    id(db) { db.integer().primary().auto(); }
    title(db) { db.string(); }
}
class Review {
    id(db) { db.integer().primary().auto(); }
    body(db) { db.string(); }
}

class multimigctx extends context {
    constructor() {
        super();
        this.env("/Users/alexanderrich/Documents/development/opensourceHQ/MasterRecord/test/fixtures/multi-migration-xDfXbJ/config/environments");
        this.dbset(Author);
        this.dbset(Book);
        this.dbset(Review);
    }
}
export default multimigctx;
