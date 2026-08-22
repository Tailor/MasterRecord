# Change Tracking & Context Lifetime

MasterRecord's change tracking follows the **Unit of Work + Identity Map** model that Entity Framework Core uses. This guide covers how tracking works, how to control it, and — most importantly — how to scope a context so it is correct and bounded in memory.

> **The one rule that prevents most problems:** a context is a **unit of work**. Scope it **per request**, not as a process-wide singleton. This mirrors EF Core, whose docs state a `DbContext` "is not thread-safe" and "designed to be used for a single unit-of-work." Sharing one context across concurrent requests is unsupported and causes lost writes and unbounded memory.

---

## How tracking works

- A **query tracks its results by default**. Loaded entities are registered in the context's identity map, so later edits are detected.
- Mutating a tracked entity marks it **dirty**; `saveChanges()` flushes the dirty set in one transaction.
- Each `saveChanges()` commits **only its change set** (the dirty entities). A flush is **O(changes)**, not O(total tracked); an empty save is O(1).
- After a successful flush, written entities are reset to clean and released; deletes are detached; anything re-mutated mid-flush stays pending.

```javascript
const user = await db.User.where('u => u.id == $$', id).single(); // tracked
user.blocked = 1;                                                 // dirty
await db.saveChanges();                                           // one UPDATE
```

---

## Controlling what gets tracked (EF's `QueryTrackingBehavior`)

Tracking is the default. For read-only work, opt out so nothing is retained.

| API | EF Core equivalent | Effect |
|---|---|---|
| `db.Model.asNoTracking().toList()` | `AsNoTracking()` | This query's results are **not** tracked; nothing retained; mutations on them are not saved. |
| `db.Model.asTracking()...` | `AsTracking()` | Track this query even when the context defaults to no-tracking. |
| `context.setQueryTrackingBehavior('no-track')` | `ChangeTracker.QueryTrackingBehavior = NoTracking` | Make **every** query no-tracking by default; opt back in per query with `asTracking()`. |
| `context.setQueryTrackingBehavior('track')` | (default) | Queries track their results. |

**Read-only endpoints** (e.g. a listing that `.toList()`s a whole table) should use `asNoTracking()` — it is the direct fix for a growing tracked set:

```javascript
const users = await db.User.asNoTracking().toList();   // retains nothing
```

If you set a `no-track` default on a shared/long-lived context, remember every write path must then use `asTracking()` on the query it intends to modify — otherwise its edits won't be tracked. That is an app-wide change; prefer request-scoped contexts (below) if you can.

---

## Managing the tracker

| API | EF Core equivalent | Effect |
|---|---|---|
| `context.detach(entity)` | `Entry(e).State = Detached` | Stop tracking one entity (drops its pending change). |
| `context.clearChangeTracker()` | `ChangeTracker.Clear()` | Detach all entities and drop all pending changes. |
| `context.reset()` | (pool release reset) | Detach all + clear the query cache, but **keep the connection open** — the "reuse this instance" primitive. |
| `await context.close()` | `Dispose()` | Release the change tracker **and** the connection (decrements the connection-pool ref). |
| `context.entry(entity)` | `Entry(entity)` | `state` (get/set), `originalValues`, `currentValues`, `isModified(field)`, `reload()`, `getDatabaseValues()`, `detach()`. |
| `context.hasChanges()` / `context.entries([model])` | `ChangeTracker.HasChanges()` / `Entries()` | Pending changes? / all tracked entries. |
| `context.add(e)` / `context.remove(e)` | `Add` / `Remove` | Context-level add/remove (resolves the owning dbset). |
| `ctx.Model.find(pk)` | `Find` | Identity map first — no query if the row is already tracked. |
| `await ctx.entry(e).load('nav')` / `ctx.loadNavigation(e, 'nav')` | `Entry(e).Reference(n).Load()` / `Collection(n).Load()` | Explicit loading of a navigation on any engine (parameterized). `entry(e).isLoaded('nav')`. |
| `await post.author` (lazy) | lazy-loading proxies | An unloaded navigation returns a Promise that loads it once and caches it; loaded navigations read synchronously. `lazyLoadingOff()` → `null` until loaded explicitly. |
| `post.author = anAuthor` / `post.author_id = id` | relationship fix-up | Assigning a parent sets the FK and marks dirty; changing the FK invalidates a loaded parent. Engines persist the **key**, never the navigation object. |

`clearChangeTracker()` drops pending changes, so on a shared context it can destroy another in-flight request's writes — it is not a safe per-request mitigation. Use request-scoped contexts or `asNoTracking()` instead.

---

## Scoping a context (the memory bound)

MasterRecord holds tracked entities with **strong references** for the life of the context (as EF does — EF removed weak references in 3.0). Memory is therefore bounded by **context lifetime**, exactly as in EF Core. Two supported patterns:

### 1. Request-scoped context (recommended)

Create a context per request and `close()` it when the request ends. Every `load → mutate → saveChanges` handler works unchanged, with no tracking-behavior tweaks and no way to introduce a lost write.

`new AppContext()` is cheap — it does **not** open a new connection. Connections are pooled per database (like ADO.NET under EF): `close()` releases the change tracker and returns the connection to the pool **kept open and idle**, so the next context reuses a warm connection with no reconnect. Idle connections are reclaimed by a background reaper after `MR_POOL_IDLE_MS` (default 60000ms; set `0` to close immediately at refcount zero). So per-request contexts — and background jobs that build a scope per run — do not churn connections.

```javascript
async function handler(req, res) {
    const db = new AppContext();
    try {
        // ... load / mutate / saveChanges ...
    } finally {
        await db.close();   // releases tracker + returns the connection
    }
}
```

### 2. Context pooling (EF's `AddDbContextPool`)

If constructing a context per request is too costly (e.g. many contexts, or you want to avoid connection churn), use a `ContextPool`. It keeps a small set of instances **with their connections warm** and lends an exclusive, reset instance per request — you pay setup once, and each request still gets its own instance (no cross-request sharing).

```javascript
import ContextPool from 'masterrecord/ContextPool';
// or: const { ContextPool } = masterrecord;

const pool = new ContextPool(AppContext, { maxSize: 64 });

// per request — automatic acquire/reset/release, even on error:
await pool.use(async (db) => {
    const user = await db.User.asTracking().where('u => u.id == $$', id).single();
    user.blocked = 1;
    await db.saveChanges();
});

// at shutdown:
await pool.drain();
```

`pool.acquire()` / `pool.release(ctx)` are available if you need manual control. `release()` calls `reset()` (detach all + clear cache, connection kept), so the next rental behaves like a fresh context.

---

## Optimistic concurrency (EF's concurrency tokens)

Without a token, two writers that load the same row and save different changes silently overwrite each other — last write wins. MasterRecord implements EF Core's optimistic concurrency:

```javascript
class Doc {
    id(db)      { db.integer().primary().auto(); }
    title(db)   { db.string(); }
    version(db) { db.rowVersion(); }                 // ORM-managed: bumped on every UPDATE
}
class Tagged {
    id(db)   { db.integer().primary().auto(); }
    etag(db) { db.string().concurrencyToken(); }     // app-managed: you set a new value when you change the row
}
```

- **`rowVersion()`** — an integer token the ORM owns. Every UPDATE runs `SET ..., version = version + 1 WHERE id = ? AND version = <original>`. Works identically on SQLite, MySQL and PostgreSQL (EF's `IsRowVersion`, but application-managed so it is portable).
- **`concurrencyToken()`** — any column whose **original** (as-loaded) value is added to the UPDATE/DELETE `WHERE`. You rotate its value yourself (e.g. a GUID/etag) when you change the row (EF's `IsConcurrencyToken`).
- **Rows-affected is always checked**, token or not: updating or deleting a row that was concurrently deleted affects 0 rows and throws.

When a conflict is detected, `saveChanges()` rolls the whole batch back and throws **`ConcurrencyError`** (EF's `DbUpdateConcurrencyException`). `err.entries` holds the conflicting entities; they stay tracked and dirty so you can resolve and retry:

```javascript
import { ConcurrencyError } from 'masterrecord/errors';   // also re-exported from 'masterrecord/context'

for (let attempt = 0; attempt < 3; attempt++) {
    try { await db.saveChanges(); break; }
    catch (e) {
        if (!(e instanceof ConcurrencyError)) throw e;
        for (const entity of e.entries) {
            await entity.reload();          // database wins: refresh values + original values
            entity.title = myNewTitle;      // re-apply what you still want
        }
    }
}
```

Resolution strategies mirror EF: **database wins** (`reload()` then re-apply), **client wins** (`reload()`, then set your values on the now-fresh originals and save), or merge per field using `entity.__originalValues` vs the reloaded values.

## Transactions (EF's `Database.BeginTransaction`)

`saveChanges()` is always atomic on its own. To span several saves (or raw SQL) in one unit:

```javascript
await db.transaction(async (tx) => {          // begin → run → commit; rollback + rethrow on error
    tx.Account.add(a);  await tx.saveChanges();
    await tx.execute('UPDATE Ledger SET ...');
    tx.Audit.add(log);  await tx.saveChanges();
});

// manual control
await db.beginTransaction();
try { ...; await db.commit(); } catch (e) { await db.rollback(); throw e; }

// savepoints inside an open transaction
await db.createSavepoint('beforeBulk');
...
await db.rollbackToSavepoint('beforeBulk');   // or releaseSavepoint('beforeBulk')
```

Inside a user transaction each `saveChanges()` is protected by a savepoint and does **not** commit by itself — a failed save leaves the outer transaction usable, exactly as in EF. The transaction holds the context's engine lock, so another unit of work on the same pooled connection waits rather than interleaving. Nested `beginTransaction()` is rejected; use savepoints.

## Set-based writes (EF's `ExecuteUpdate` / `ExecuteDelete`)

One SQL statement over the rows a query selects — no loading, no change tracker, returns rows affected:

```javascript
import { sql } from 'masterrecord/sql';
await db.Blog.where('b => b.rating < $$', 3).executeUpdate({ hidden: true, views: sql`views + 1` });
await db.Session.where('s => s.expiresAt < $$', Date.now()).executeDelete();
```

Setter values are parameterized; `sql\`…\`` inlines a trusted fragment (it refuses interpolations). Like EF, these don't refresh tracked instances — avoid mixing them with pending tracked edits to the same rows. Inside `transaction()` they join the transaction.

## Global query filters (EF's `HasQueryFilter`)

A filter is a where-lambda appended to every query on an entity — soft delete and multi-tenancy without repeating the predicate:

```javascript
this.dbset(Blog)
    .queryFilter('softDelete', 'b => b.deletedAt == null')
    .queryFilter('tenant', 'b => b.tenantId == $$', ctx => ctx.tenantId);   // evaluated per query

await db.Blog.toList();                                   // filtered
await db.Blog.ignoreQueryFilters().toList();              // all rows
await db.Blog.ignoreQueryFilters(['softDelete']).toList(); // EF 10: ignore by name
```

Filters apply to `toList`/`single`/`first`/`findById`/`count`/`exists` and to `executeUpdate`/`executeDelete`. They currently apply to the root entity of a query (not inside `include()`d navigations).

## Events & interceptors (EF's `SavingChanges` / interceptors)

```javascript
db.on('savingChanges', ({ entries }) => {
    for (const { entity, state } of entries) {
        if (state === 'modified') entity.updatedAt = Date.now();            // audit column
        if (state === 'delete') { entity.__state = 'modified'; entity.deletedAt = Date.now(); } // soft delete
    }
});
db.on('savedChanges', ({ entries }) => { /* after commit */ });
db.on('saveChangesFailed', ({ error }) => { /* before rethrow */ });
db.on('command', ({ sql, params, durationMs, engine, error }) => { /* every SQL statement */ });
db.on('tracked', …); db.on('stateChanged', …);
```

`on()` returns an unsubscribe function; `once()` fires a single time. `savingChanges` runs before the flush and the change set is re-collected afterwards, so edits made by handlers ship in the same save.

## Logging & diagnostics (EF's `LogTo` / `EnableSensitiveDataLogging`)

Nothing is logged by default, and parameter values are **redacted** unless you opt in — exactly EF's defaults:

```javascript
import masterrecord from 'masterrecord';
masterrecord.configureLogging({
    logger: myLogger,        // { debug, info, warn, error } — default console
    level: 'debug',          // min level
    logSql: true,            // log every command (or LOG_SQL=true)
    sensitiveData: false,    // show parameter values? (or MR_SENSITIVE_LOGGING=true)
    slowQueryMs: 250,        // warn on slow commands even when logSql is off (or MR_SLOW_QUERY_MS)
    migrations: true,        // log migration DDL at info (MR_SILENT_MIGRATIONS=true to silence)
});
```

Every command on every engine flows through one timed path → the logger and the `command` event (`{ sql, params, durationMs, engine, error? }`).

## Connection resiliency (EF's `EnableRetryOnFailure`)

```javascript
db.setRetryOnFailure({ maxRetries: 3, maxDelayMs: 2000 });   // per context (false to disable)
masterrecord.configureRetry({ maxRetries: 3 });               // process-wide default
db.on('retry', ({ attempt, delayMs, error }) => …);
```

Transient errors (deadlocks, lock timeouts, busy SQLite, dropped connections) are retried with capped exponential backoff; constraint/syntax errors and `ConcurrencyError` are not. Queries, `saveChanges()` and `executeUpdate`/`executeDelete` are covered; nothing is retried inside an explicit transaction — re-run the whole transaction (EF semantics). Off by default.

## Why not a singleton context?

A singleton context shared across concurrent requests is the root cause of an entire class of bugs (and is unsupported in EF for the same reasons):

- **Lost writes** — one request's `saveChanges()` interacting with another's tracked entities.
- **Unbounded memory** — read-only queries track results that are never released.
- **Undefined behavior** under concurrent access (EF: "application crashes and data corruption").

MasterRecord hardens against the worst symptoms (each save commits only its own change set; identities are collision-free; the dirty index is complete), but the correct and supported model is a **per-request context** — pooled if you need to amortize setup.

---

## Mapping to Entity Framework Core

| MasterRecord | EF Core |
|---|---|
| context = unit of work, scoped per request | `DbContext`, registered `Scoped` via `AddDbContext` |
| `ContextPool` / `pool.use()` | `AddDbContextPool` |
| `asNoTracking()` / `asTracking()` | `AsNoTracking()` / `AsTracking()` |
| `setQueryTrackingBehavior('no-track')` | `QueryTrackingBehavior.NoTracking` |
| `clearChangeTracker()` | `ChangeTracker.Clear()` |
| `reset()` (pool release) | change-tracker reset on pool return |
| `close()` | `Dispose()` |
| dirty index → O(changes) saves | `StateManager` / change detection |
| strong-ref identity map, freed on dispose | strong references, freed on dispose |
