// version 1.1.0
import context from './context.js';
import schema from './Migrations/schema.js';

class masterrecord {
    constructor() {
        this.context = context;
        this.schema = schema;
    }
}

export default new masterrecord();
