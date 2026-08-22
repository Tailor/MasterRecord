/**
 * A trusted raw SQL fragment for set-based updates — the counterpart of
 * EF Core's `SetProperty(b => b.Views, b => b.Views + 1)` (referencing the
 * existing column value in the SET clause).
 *
 *   await db.Blogs.where('b => b.rating < $$', 3).executeUpdate({
 *       views: sql`views + 1`,      // raw fragment, inlined verbatim
 *       hidden: true,               // plain value, parameterized
 *   });
 *
 * The fragment is inlined into the statement, so it is developer-owned SQL.
 * To keep it injection-safe by construction, the tagged template REFUSES
 * interpolations (`sql\`views + ${n}\`` throws) — pass dynamic values as
 * ordinary setter values, which are parameterized.
 */
class RawSql {
    constructor(fragment) {
        if (typeof fragment !== 'string' || fragment.trim() === '') {
            throw new TypeError('masterrecord: sql() requires a non-empty SQL fragment string.');
        }
        this.__rawSql = fragment;
        Object.freeze(this);
    }
    toString() { return this.__rawSql; }
}

function sql(strings, ...values) {
    // sql('views + 1')
    if (typeof strings === 'string') return new RawSql(strings);
    // sql`views + 1` (tagged template, no interpolations)
    if (values.length > 0) {
        throw new TypeError(
            'masterrecord: sql`...` does not accept interpolated values (they would be inlined unparameterized). ' +
            'Put dynamic values in ordinary setter properties instead — those are sent as parameters.'
        );
    }
    return new RawSql(Array.isArray(strings) ? strings.join('') : String(strings));
}

export { RawSql, sql };
export default sql;
