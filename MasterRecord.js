// version 1.1.0
import context from './context.js';
import schema from './Migrations/schema.js';
import ContextPool from './ContextPool.js';

class masterrecord {
    constructor() {
        this.context = context;
        this.schema = schema;
        this.ContextPool = ContextPool;   // EF AddDbContextPool equivalent
    }
}

export default new masterrecord();
