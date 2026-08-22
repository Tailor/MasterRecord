/**
 * Shared DDL fragments for Entity Framework Core-style column modeling, used by
 * the SQLite / MySQL / Postgres migration query builders so all three engines
 * render identically-structured clauses:
 *
 *   EF                      masterrecord                  DDL
 *   HasDefaultValueSql   -> db.defaultSql(sql)         -> DEFAULT <expr>
 *   HasComputedColumnSql -> db.computed(sql, {stored}) -> GENERATED ALWAYS AS (<expr>) STORED|VIRTUAL
 *   HasCheckConstraint   -> db.check(sql, name)        -> [CONSTRAINT name] CHECK (<expr>)
 */

// Defaults that may appear bare; any other expression is parenthesized
// (SQLite and MySQL require it, Postgres accepts it). MySQL additionally
// requires even CURRENT_TIMESTAMP to be parenthesized on TEXT/BLOB/JSON
// columns (expression defaults, 8.0.13+) — and masterrecord maps every
// temporal type to TEXT — so on MySQL only literals stay bare.
const LITERAL_DEFAULT = /^(NULL|TRUE|FALSE|-?\d+(\.\d+)?|'(?:[^']|'')*')$/i;
const BARE_DEFAULT = /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i;

/** @param {'sqlite'|'mysql'|'postgres'} [engine] */
export function defaultSqlClause(col, engine) {
    if (!col || col.defaultSql === undefined || col.defaultSql === null || col.defaultSql === '') return '';
    const sql = String(col.defaultSql).trim();
    const bare = LITERAL_DEFAULT.test(sql)
        || (engine !== 'mysql' && BARE_DEFAULT.test(sql))
        || (sql.startsWith('(') && sql.endsWith(')'));
    return bare ? ` DEFAULT ${sql}` : ` DEFAULT (${sql})`;
}

/** @param {'sqlite'|'mysql'|'postgres'} engine Postgres supports STORED only. */
export function computedClause(col, engine) {
    if (!col || !col.computedSql) return '';
    const stored = engine === 'postgres' ? true : col.computedStored !== false;
    return ` GENERATED ALWAYS AS (${col.computedSql}) ${stored ? 'STORED' : 'VIRTUAL'}`;
}

/** @param {(name:string)=>string} [quote] identifier quoting for the constraint name */
export function checkClause(col, quote) {
    if (!col || !col.check) return '';
    const name = col.checkName ? ` CONSTRAINT ${quote ? quote(col.checkName) : col.checkName}` : '';
    return `${name} CHECK (${col.check})`;
}

/** Reject contradictory modeling options up front, with the column named. */
export function assertDdlOptions(col) {
    if (!col || !col.computedSql) return;
    if (col.default !== undefined && col.default !== null) throw new Error(`masterrecord: column '${col.name}' cannot have both computed() and default().`);
    if (col.defaultSql !== undefined && col.defaultSql !== null) throw new Error(`masterrecord: column '${col.name}' cannot have both computed() and defaultSql().`);
    if (col.primary) throw new Error(`masterrecord: computed column '${col.name}' cannot be the primary key.`);
    if (col.auto) throw new Error(`masterrecord: computed column '${col.name}' cannot be auto-increment.`);
}

/**
 * Primary-key DB column names of an entity definition. More than one means a
 * composite key (EF HasKey(a, b)): the builders then emit a table-level
 * `PRIMARY KEY (a, b)` and no inline PRIMARY KEY / auto-increment.
 */
export function primaryKeyColumns(table) {
    const out = [];
    for (const key of Object.keys(table || {})) {
        if (key.startsWith('__') || key === 'indexes') continue;
        const col = table[key];
        if (!col || typeof col !== 'object' || col.primary !== true) continue;
        if (col.type === 'hasOne' || col.type === 'hasMany' || col.type === 'hasManyThrough') continue;
        out.push((col.relationshipType === 'belongsTo' && col.foreignKey) ? col.foreignKey : (col.name || key));
    }
    return out;
}

export function compositePrimaryKeyClause(table, quote) {
    const cols = primaryKeyColumns(table);
    if (cols.length < 2) return '';
    for (const key of Object.keys(table)) {
        const col = table[key];
        if (col && typeof col === 'object' && col.primary === true && col.auto) {
            throw new Error(`masterrecord: composite key on '${table.__name}' cannot include the auto-increment column '${col.name || key}' (EF: identity columns are not part of composite keys).`);
        }
    }
    const q = quote || ((n) => n);
    return `PRIMARY KEY (${cols.map(q).join(', ')})`;
}

/** True when the column's value is produced by the database (never written by the ORM). */
export function isComputedColumn(col) {
    return !!(col && typeof col === 'object' && col.computedSql);
}
