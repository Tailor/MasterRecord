/**
 * Shared error types that must be importable by both the context and its
 * collaborators (insert/delete managers, engines) without creating an import
 * cycle through context.js.
 */

/**
 * Thrown by saveChanges() when an UPDATE or DELETE affected 0 rows — the row
 * was modified or deleted by someone else since this context loaded it
 * (optimistic concurrency conflict), or a concurrency-token value no longer
 * matches. Equivalent to EF Core's DbUpdateConcurrencyException.
 *
 * `entries` holds the entities whose writes were rejected so the caller can
 * resolve the conflict (reload and retry, client-wins, database-wins, merge).
 * The transaction is rolled back; the entities stay tracked and dirty.
 */
class ConcurrencyError extends Error {
    constructor(message, entries = [], details = {}) {
        super(message);
        this.name = 'ConcurrencyError';
        this.code = 'MR_CONCURRENCY_CONFLICT';
        this.entries = Array.isArray(entries) ? entries : [entries];
        this.details = details;
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
    }
}

export { ConcurrencyError };
