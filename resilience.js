/**
 * Connection resiliency — EF Core's execution strategy / EnableRetryOnFailure.
 *
 * Retries an operation on TRANSIENT database errors (deadlocks, lock
 * timeouts, dropped connections, busy SQLite) with capped exponential backoff
 * and jitter. Non-transient errors (constraint violations, syntax errors,
 * concurrency conflicts) are never retried. Like EF, retries are NOT applied
 * inside a user transaction — the transaction as a whole is the retry unit
 * and must be re-run by the caller.
 */

/** Error classifier per engine. Conservative: only well-known transient codes. */
function isTransientError(err, engine) {
    if (!err) return false;
    if (err.name === 'ConcurrencyError') return false;
    const code = err.code || (err.original && err.original.code) || (err.cause && err.cause.code);
    const errno = err.errno;
    const msg = String(err.message || '');

    // Network-level, any engine
    if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST'].includes(code)) return true;

    switch (engine) {
        case 'sqlite':
            return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'SQLITE_BUSY_SNAPSHOT' || /SQLITE_BUSY|database is locked/i.test(msg);
        case 'mysql':
            return code === 'ER_LOCK_DEADLOCK' || errno === 1213
                || code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205
                || code === 'ER_TOO_MANY_USER_CONNECTIONS' || errno === 1203
                || code === 'ER_CON_COUNT_ERROR' || errno === 1040;
        case 'postgres':
            // serialization_failure, deadlock_detected, admin_shutdown, crash_shutdown,
            // cannot_connect_now, and connection-exception class 08xxx
            return ['40001', '40P01', '57P01', '57P02', '57P03'].includes(code) || /^08/.test(String(code || ''));
        default:
            return false;
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Run `fn` with retries on transient errors.
 * @param {() => Promise<any>} fn
 * @param {object} opts { maxRetries=3, maxDelayMs=2000, baseDelayMs=50, engine, onRetry }
 */
async function withRetry(fn, opts = {}) {
    const maxRetries = Number.isInteger(opts.maxRetries) && opts.maxRetries >= 0 ? opts.maxRetries : 3;
    const maxDelayMs = Number(opts.maxDelayMs) > 0 ? Number(opts.maxDelayMs) : 2000;
    const baseDelayMs = Number(opts.baseDelayMs) > 0 ? Number(opts.baseDelayMs) : 50;
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        } catch (err) {
            if (attempt >= maxRetries || !isTransientError(err, opts.engine)) throw err;
            attempt++;
            const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
            const delay = Math.round(exp * (0.5 + Math.random() * 0.5));   // jitter
            if (typeof opts.onRetry === 'function') {
                try { opts.onRetry({ attempt, maxRetries, delayMs: delay, error: err }); } catch (_) { /* ignore */ }
            }
            await sleep(delay);
        }
    }
}

export { isTransientError, withRetry };
