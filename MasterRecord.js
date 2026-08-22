// version 1.1.0
import context from './context.js';
import schema from './Migrations/schema.js';
import ContextPool from './ContextPool.js';
import { sql, RawSql } from './QueryLanguage/rawSql.js';
import { ConcurrencyError } from './errors.js';

class masterrecord {
    constructor() {
        this.context = context;
        this.schema = schema;
        this.ContextPool = ContextPool;   // EF AddDbContextPool equivalent
        this.sql = sql;                   // raw SET fragment for executeUpdate (EF SetProperty(b => b.X + 1))
        this.RawSql = RawSql;
        this.ConcurrencyError = ConcurrencyError;
    }
}

export default new masterrecord();
