// version 1.3.2 - ESM only
import schema from './schema.js';

/**
 * Instantiate a user context and ensure its database is reachable for
 * migrations, AUTO-CREATING a missing MySQL/Postgres database (and retrying the
 * connection) via the schema layer — the same path `ensure-database` uses.
 *
 * Why this exists: the migration CLI used to await the raw
 * `context._initPromise` directly. When the target database didn't exist yet,
 * that promise rejected with "Unknown database 'X'" (MySQL) /
 * `database "X" does not exist` (Postgres), and the CLI's catch block merely
 * reported failure and exited — it never invoked the auto-create that lives in
 * `schema._ensureReady()` (`_createDatabaseFromConfig` + retry). So the CLI's
 * own message "this will create the database if it doesn't exist" was a lie for
 * a first-time deploy against an empty server. Routing through
 * `schema._ensureReady()` makes that promise real.
 *
 * SQLite is unaffected (the driver creates the file on open); for SQLite this
 * is just a normal construct-and-connect.
 *
 * @param {Function} ContextCtor - The user's context class (constructor)
 * @returns {Promise<object>} A ready context whose engine/pool is live
 * @throws Propagates a genuine connection/config failure (not "db missing")
 */
export async function instantiateReadyContext(ContextCtor) {
    const initSchema = new schema(ContextCtor);
    await initSchema._ensureReady();
    const ctx = initSchema.context;
    // After _ensureReady() the engine/pool is live — including the
    // create-database-then-retry path, which swaps in a fresh engine/pool but
    // leaves the original (now-settled, possibly rejected) _initPromise in
    // place. Mark the context ready so later context._execute() calls
    // short-circuit context._ensureReady() instead of re-awaiting that promise.
    ctx._ready = true;
    return ctx;
}

export default instantiateReadyContext;
