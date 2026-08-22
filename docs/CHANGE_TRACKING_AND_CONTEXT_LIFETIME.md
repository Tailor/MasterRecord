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

`clearChangeTracker()` drops pending changes, so on a shared context it can destroy another in-flight request's writes — it is not a safe per-request mitigation. Use request-scoped contexts or `asNoTracking()` instead.

---

## Scoping a context (the memory bound)

MasterRecord holds tracked entities with **strong references** for the life of the context (as EF does — EF removed weak references in 3.0). Memory is therefore bounded by **context lifetime**, exactly as in EF Core. Two supported patterns:

### 1. Request-scoped context (recommended)

Create a context per request and `close()` it when the request ends. Connections are pooled underneath, and `close()` releases the whole change tracker. Every `load → mutate → saveChanges` handler works unchanged, with no tracking-behavior tweaks and no way to introduce a lost write.

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
