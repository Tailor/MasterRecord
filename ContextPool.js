/**
 * ContextPool — a bounded pool of reusable context instances, modeled on
 * Entity Framework Core's `AddDbContextPool`.
 *
 * A context is a unit of work and must be scoped per request (it is not safe to
 * share one instance across concurrent requests). Constructing a fresh context
 * per request is correct but pays connection/setup cost every time. A pool keeps
 * a small set of instances — with their database connections warm — and lends an
 * exclusive one per request: `acquire()` rents an instance (reset and ready),
 * `release()` resets its change tracker/cache (NOT the connection) and returns
 * it for reuse. You pay setup once, and each request still gets its own
 * instance, so there is no cross-request sharing.
 *
 * @example
 *   const pool = new ContextPool(AppContext, { maxSize: 64 });
 *   // per request:
 *   const db = await pool.acquire();
 *   try {
 *     // ... load / mutate / saveChanges, exactly like a scoped context ...
 *   } finally {
 *     pool.release(db);   // reset + return to pool (connection stays open)
 *   }
 *   // at shutdown: await pool.drain();
 */
class ContextPool {
    /**
     * @param {Function} ContextCtor - a context class (extends masterrecord.context)
     * @param {object} [options]
     * @param {number} [options.maxSize=128] - max idle instances kept warm; when
     *   the pool is at capacity on release, the returned instance is closed
     *   instead of pooled. Rentals beyond this still succeed (extra instances are
     *   created on demand and simply closed rather than pooled on release).
     */
    constructor(ContextCtor, options = {}) {
        if (typeof ContextCtor !== 'function') {
            throw new Error('ContextPool: first argument must be a context class (constructor).');
        }
        this._ctor = ContextCtor;
        this._maxSize = Number.isInteger(options.maxSize) && options.maxSize > 0 ? options.maxSize : 128;
        this._idle = [];        // instances ready to lend (reset, connection warm)
        this._rented = new Set();
        this._drained = false;
    }

    /**
     * Rent an instance from the pool (or create one if none are idle). The
     * returned context is reset and its connection is ready. Give it back with
     * release() when the unit of work is done.
     */
    async acquire() {
        if (this._drained) throw new Error('ContextPool: cannot acquire from a drained pool.');
        let ctx = this._idle.pop();
        if (!ctx) {
            ctx = new this._ctor();
        }
        // Ensure the connection is initialized before handing it out.
        if (typeof ctx._ensureReady === 'function') {
            await ctx._ensureReady();
        }
        this._rented.add(ctx);
        return ctx;
    }

    /**
     * Return an instance to the pool. Its unit of work is reset (tracked
     * entities detached, dirty index and query cache cleared) but its connection
     * is kept open for reuse. If the pool is already full, the instance is closed
     * instead of retained.
     */
    release(ctx) {
        if (!ctx) return;
        this._rented.delete(ctx);
        try {
            if (typeof ctx.reset === 'function') ctx.reset();
        } catch (_) { /* fall through to close on a bad reset */ }

        if (this._drained || this._idle.length >= this._maxSize) {
            // Pool full or shutting down: actually close this one.
            Promise.resolve(typeof ctx.close === 'function' ? ctx.close() : undefined).catch(() => {});
            return;
        }
        this._idle.push(ctx);
    }

    /**
     * Run `fn(ctx)` with a rented instance and release it automatically —
     * including on error. Returns whatever `fn` returns.
     *
     * @example await pool.use(async (db) => { ...; await db.saveChanges(); });
     */
    async use(fn) {
        const ctx = await this.acquire();
        try {
            return await fn(ctx);
        } finally {
            this.release(ctx);
        }
    }

    /** Number of idle (pooled) instances currently kept warm. */
    get size() { return this._idle.length; }
    /** Number of instances currently rented out (in flight). */
    get rented() { return this._rented.size; }

    /**
     * Close every idle instance and stop pooling. Call at application shutdown.
     * Rented instances are left to their holders to release (release() will close
     * them because the pool is drained).
     */
    async drain() {
        this._drained = true;
        const idle = this._idle.splice(0, this._idle.length);
        for (const ctx of idle) {
            if (typeof ctx.close === 'function') {
                try { await ctx.close(); } catch (_) { /* best-effort */ }
            }
        }
    }
}

export default ContextPool;
