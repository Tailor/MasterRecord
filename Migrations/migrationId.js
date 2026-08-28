// Migration identifiers. Shared by MigrationsAssembly (which orders the files on
// disk) and HistoryRepository (which orders the rows in the history table) so the
// two can never disagree about what "the next migration" is.

import path from 'node:path';

/** EF's Migration.InitialDatabase sentinel — "revert everything". */
export const INITIAL_DATABASE = '0';

/**
 * The timestamp prefix of `<timestamp>_<Name>_migration.js`. Ids without one sort
 * last, then by name.
 */
export function timestampOf(id) {
    const m = /^(\d+)_/.exec(path.basename(String(id)));
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Order migration ids the way EF orders MigrationIds: chronologically.
 *
 * EF can compare its ids as strings because they are fixed-width
 * (`20260101120000_Name`). masterrecord's are epoch milliseconds, which are only
 * the same width by coincidence — `900_A` must still come before `1000_B`, and a
 * plain string comparison puts them the wrong way round.
 */
export function compareMigrationIds(a, b) {
    const ta = timestampOf(a);
    const tb = timestampOf(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a).localeCompare(String(b));
}
