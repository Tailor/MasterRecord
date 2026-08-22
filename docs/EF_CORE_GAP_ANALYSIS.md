# MasterRecord vs. Entity Framework Core — Gap Analysis

_Compared against EF Core 10 (current stable, LTS, Nov 2025) and EF Core 11 (preview, due Nov 2026). Every MasterRecord claim below was verified against the source with a file:line citation._

MasterRecord has deliberately adopted EF Core's architecture for change tracking and context lifetime (1.5.9–1.5.17: unit-of-work `saveChanges`, identity map, dirty index, `asNoTracking`/`asTracking`/`setQueryTrackingBehavior`, `clearChangeTracker`, `close()`=Dispose, `ContextPool`=`AddDbContextPool`, ADO.NET-style warm connection pooling, scoped DI + `createScope()`). This document lists what EF Core has that MasterRecord still **doesn't**, ranked by how much it matters for a production ORM, plus what's deliberately out of scope.

---

> **Status (Aug 2026):** Tier 1 #1 (optimistic concurrency + rows-affected check) and #2 (explicit transactions) shipped in **1.6.0**; FK constraint DDL + honored cascade behaviors + rename advisories shipped in **1.7.0**; #3 `executeUpdate`/`executeDelete` + set-based `bulkUpdate`/`bulkDelete` shipped in **1.8.0**. Remaining items are tracked below in their original ranking.

## Tier 1 — Production correctness / safety (do first)

These are the gaps where EF provides a guarantee MasterRecord currently lacks, and where the absence can cause **silent data loss or corruption**.

### 1. Optimistic concurrency (concurrency tokens / rowversion) — MISSING
- **EF:** a property marked `IsConcurrencyToken()` / `[Timestamp]` (`IsRowVersion()`) is added to the UPDATE/DELETE `WHERE` clause: `UPDATE ... WHERE Id = @p0 AND Version = @p1`. If 0 rows are affected, `SaveChanges` throws `DbUpdateConcurrencyException`, and the app resolves it (client-wins / database-wins / merge via `OriginalValues`/`GetDatabaseValues`). Application-managed tokens (GUID/version counter) work on every DB incl. SQLite.
- **MasterRecord:** UPDATE is primary-key-only on all three engines — `mySQLEngine.js:44`, `postgresEngine.js:82`, `SQLLiteEngine.js:16-19` — and `_saveChangesExclusive` (`context.js:2266-2286`) returns `true` **without inspecting rows-affected**. Two concurrent writers silently clobber each other, and an UPDATE of a row that was concurrently deleted is reported as success.
- **Do:** add `db.field().concurrencyToken()` (and an auto-incrementing `.version()` sugar); include tokens in the UPDATE/DELETE `WHERE`; **check rows-affected === 1 and throw `ConcurrencyError`** (with the affected entity) otherwise. This is the single most important missing guarantee.

### 2. Explicit transaction API — MISSING (public)
- **EF:** `context.Database.BeginTransaction()` / `Commit` / `Rollback`, savepoints (`CreateSavepoint`/`RollbackToSavepoint`), `SaveChanges` auto-creates a savepoint when already inside a transaction, isolation levels, cross-context `UseTransaction`.
- **MasterRecord:** engines already implement `startTransaction`/`endTransaction`/`errorTransaction`/`savepoint`/`rollbackToSavepoint` (`SQLLiteEngine.js:753-777`, `postgresEngine.js:1093-1135`), but the context exposes **no** `beginTransaction`/`commit`/`rollback`/`transaction(fn)` — they're used only internally by `saveChanges` (`context.js:2270-2277`) and `_bulkWithFallback` (`context.js:1840-1866`). A user cannot span two `saveChanges()` calls (or a save + raw SQL) in one atomic unit.
- **Do:** `await ctx.beginTransaction()` / `ctx.commit()` / `ctx.rollback()` + `await ctx.transaction(async (tx) => {...})` (auto-commit/rollback), savepoint helpers, and make `saveChanges()` create a savepoint when a user transaction is open (EF semantics). The engine plumbing already exists — this is mostly wiring.

### 3. Set-based bulk update/delete (`ExecuteUpdate` / `ExecuteDelete`) — MISSING
- **EF:** `ctx.Blogs.Where(b => b.Rating < 3).ExecuteDeleteAsync()` / `.ExecuteUpdateAsync(s => s.SetProperty(...))` — one SQL statement, bypasses the change tracker, returns rows-affected (EF10: setter lambda can be a plain non-expression lambda).
- **MasterRecord:** no `.where(...).update({...})` / `.where(...).delete()` on the query builder. The existing `bulkUpdate` (`context.js:2543`) and `bulkDelete` (`context.js:2591`) are **N+1**: per id they `findById` (a SELECT) and `bulkDelete` calls `entity.delete()` which runs a full `saveChanges()` each — so 100 ids = 100 SELECTs + 100 transactions, despite the docstring "Much faster than deleting individually."
- **Do:** `ctx.Model.where(...).executeUpdate({col: value | fn})` and `.executeDelete()` that emit a single UPDATE/DELETE with the query's WHERE, return affected count, don't touch the tracker (document the EF caveat that tracked entities are not refreshed). Reimplement `bulkUpdate`/`bulkDelete` on top of it.

### 4. Global query filters (soft delete, multi-tenancy) — MISSING
- **EF:** `HasQueryFilter(b => !b.IsDeleted)` is appended to every query on that entity (incl. navigations); `IgnoreQueryFilters()` per query; **EF10: named filters** (`HasQueryFilter("SoftDeletion", ...)` + `HasQueryFilter("Tenant", ...)`, disable selectively with `IgnoreQueryFilters(["SoftDeletion"])`).
- **MasterRecord:** zero hits for any filter mechanism. Soft-delete/tenant scoping must be hand-written in every query — the class of bug filters exist to eliminate.
- **Do:** `ctx.Model.queryFilter('softDelete', e => e.deletedAt == null)` at model/context setup, applied in `where`-building for `toList/first/single/count/…` and `include`d navigations; `.ignoreQueryFilters()` / `.ignoreQueryFilters(['softDelete'])`. Ship named filters from day one (EF10 shape).

### 5. Connection resiliency (retry on transient failure) — MISSING
- **EF:** `EnableRetryOnFailure()` / execution strategy with exponential backoff on transient errors (timeouts, connection reset, deadlock), incl. retrying whole transactions.
- **MasterRecord:** no retry/backoff anywhere in `mySQLEngine.js`/`postgresEngine.js`/`context.js`; no `ETIMEDOUT`/`ECONNRESET`/deadlock handling. A transient blip is a hard failure. (The only "retry" is one-shot re-init after DB creation in migrations, `Migrations/schema.js:92,169`.)
- **Do:** an execution strategy around query/save with a transient-error classifier per engine (MySQL `ER_LOCK_DEADLOCK`/`ECONNRESET`, PG `40001`/`40P01`/`57P01`, SQLite `SQLITE_BUSY`) and capped exponential backoff; opt-in `retryOnFailure({ maxRetries, maxDelayMs })`.

### 6. Pluggable logging + sensitive-data redaction — MISSING
- **EF:** `LogTo(...)`/ILogger integration, command/transaction/connection events, **parameter values redacted by default** (`EnableSensitiveDataLogging` to opt in); EF10 also redacts inlined constants.
- **MasterRecord:** logging is hardcoded `console.*` gated on env vars (`SQLLiteEngine.js:1409`, `postgresEngine.js:1062-1066`), **on by default whenever `NODE_ENV !== 'production'`**, and **logs parameter values verbatim** (`postgresEngine.js:1065`, `SQLLiteEngine.js:1418`) — PII/secrets leak into dev logs. No slow-query timing.
- **Do:** `ctx.setLogger(fn)` / `masterrecord.configureLogging({ level, sensitiveData: false })`; redact params unless `sensitiveData: true`; emit `{ sql, durationMs, rows }` with a `slowQueryMs` threshold.

### 7. Migrations: transactional apply, script/dry-run, pending list — PARTIAL
- **EF:** each migration applies in a transaction (EF10 reverted to *per-migration*, not one giant one); `migrations script` (incl. `--idempotent`) for DBA review; `migrations list` shows applied vs pending; `--connection` override; EF11 adds `database update --add`, wildcard `--context "*"`, and records the latest migration id in the snapshot to surface divergent-branch merges.
- **MasterRecord:** CLI (`Migrations/cli.js`) has enable/add/update/down/restart/target/get-migrations + `*-all` variants, but: **no transaction around a migration** (DDL autocommits statement-by-statement; a mid-migration failure leaves a half-applied schema — acknowledged at `cli.js:607`), **no script/dry-run**, `get-migrations` (`cli.js:872`) lists files only (applied/pending is computed internally at `cli.js:582-591` but never exposed), **no `--connection`**.
- **Do:** wrap each migration's `up()` in a transaction where the engine supports transactional DDL (Postgres, SQLite; MySQL implicit-commits DDL — document that), add `script [--idempotent]` and `migrations-status` (applied/pending), `--connection`, and record the latest migration id in the snapshot (EF11's team-merge safety).

---

## Tier 2 — API completeness (developer ergonomics)

### 8. `find(pk)` that checks the identity map first — MISSING
- **EF:** `Find`/`FindAsync` returns the tracked instance without a query if present; composite keys supported.
- **MasterRecord:** `findById` (`queryMethods.js:510`) always hits the DB; `__findTracked` (`context.js:3008`) exists but is internal. **Do:** `ctx.Model.find(id)` = identity-map lookup by table+pk, then DB fallback (and track).

### 9. Entity-entry / change-tracker introspection — MISSING
- **EF:** `ctx.Entry(e).State` (get/set), `OriginalValues`/`CurrentValues`/`GetDatabaseValues`, `Property(...).IsModified`, `Reload()`, `ChangeTracker.Entries()`, `HasChanges()`, `DbSet.Local`.
- **MasterRecord:** state is a raw `__state` string and a `__dirtyFields` name list; **no original-value snapshot** (so "database-wins/merge" concurrency resolution is impossible), no `hasChanges()`, no public `entries()`. Has `reload()` (`entityTrackerModel.js:167`), `attach/attachAll/detach`.
- **Do:** `ctx.entry(entity)` → `{ state, originalValues, currentValues, isModified(field), reload(), getDatabaseValues() }`, `ctx.hasChanges()`, `ctx.entries([Model])`. Capturing original values at load is also a prerequisite for #1's merge resolution and for a cleaner "only changed columns" UPDATE.

### 10. Context-level interceptors / events — MISSING (only entity hooks exist)
- **EF:** `SavingChanges`/`SavedChanges`/`SaveChangesFailed` events + `ISaveChangesInterceptor`; `IDbCommandInterceptor` (rewrite/observe SQL, e.g. query tagging, auditing); connection/transaction interceptors; `ChangeTracker.Tracked`/`StateChanged`.
- **MasterRecord:** only per-entity `beforeSave/afterSave/beforeDelete/afterDelete` (`Entity/entityModelBuilder.js:22`; invoked `context.js:1913,1992,2022,2084,2103,2150`). No way to implement audit columns (`createdBy/updatedAt`) or soft-delete-on-remove **once** for all entities.
- **Do:** `ctx.on('savingChanges'|'savedChanges'|'saveChangesFailed', fn)` with access to the change set/entries, `ctx.on('command', fn)` for SQL observe/rewrite, `ctx.on('tracked'|'stateChanged')`. (Combined with #4 this gives EF's canonical soft-delete recipe: intercept `delete` → mark `modified` + set `deletedAt`.)

### 11. Query operators — PARTIAL
Present: `where/and/orderBy/orderByDescending/take/skip/include/select/count/first/last/single/exists/pluck/raw/search/cache/asNoTracking/asTracking`, `IN` via `.includes()`→`any()` (`queryMethods.js:384`).
Missing vs EF: **`thenInclude`** (nested eager load), explicit loading (`entry.collection(...).load()`), **`thenBy`/`thenByDescending`**, **`distinct`**, aggregates **`sum/avg/min/max`** (only `count`), `groupBy`, `join`/`leftJoin` (EF10 `LeftJoin`/`RightJoin`, EF11 `FullJoin`), DTO projection (`select` returns entity-shaped rows), `any(pred)`/`all(pred)`, split queries, `MaxBy/MinBy` (EF11).
- **Quick win first:** `join()` and `groupBy()` at `queryMethods.js:101-107` are **empty bodies returning `undefined`** — chaining off them throws a bare `TypeError`. Either implement or make them throw `NotSupportedError('groupBy is not supported yet')`. Remove the underscore-hidden `_____leftJoin`/`______orderByCount*` stubs.
- Then: `thenInclude`, `thenBy`, `distinct`, `sum/avg/min/max`, DTO `select({...})`, and `groupBy` + `having`.

---

## Tier 3 — Modeling (EF 8–11 direction)

| Feature | EF Core | MasterRecord | Notes |
|---|---|---|---|
| Composite primary keys | `HasKey(e => new {a,b})` | **No** — `primary()` is a per-field flag, consumers use the *first* one (`queryMethods.js:513-519`) | Needed for join tables / multi-column natural keys |
| Many-to-many (auto join table) | `HasMany().WithMany()` skip navigation | **No** — `hasManyThrough` (`entityModel.js:282`) requires a hand-declared join entity; DDL skips it (`schema.js:414`) | |
| Complex / owned types, JSON mapping | EF10 complex types (table-splitting **or** `ToJson()`), value semantics, optional, ExecuteUpdate over JSON; EF11 on TPT/TPC, keys/indexes on complex props | **No** complex types; `json()` column exists (`entityModel.js:136`) but no typed sub-object mapping/querying | JSON-column querying (`WHERE json->>'x'`) is the practical win |
| Inheritance (TPH discriminator) | Yes (TPH/TPT/TPC) | **No** | |
| Computed / generated columns, default SQL | `HasComputedColumnSql`, `HasDefaultValueSql` (EF10 named default constraints) | **No** generated columns; `default()` takes a JS literal only (`entityModel.js:179`) | `default(sql\`now()\`)` is cheap |
| Check constraints | `HasCheckConstraint` | **No** (only a comment, `migrationSQLiteQuery.js:484`) | |
| Shadow properties | Yes | **No** | low priority |
| Value converters | `HasConversion` | **Yes** — `transform({toDatabase,fromDatabase})` (`entityModel.js:242`) | parity |
| Unique / composite / partial indexes | Yes | **Yes** (`unique()`, `compositeIndex()` `context.js:1483`, partial `context.js:1511` PG/SQLite) | parity; MySQL partial throws (correct — MySQL lacks them) |
| Full-text search | SQL Server FTS (EF11 catalogs/TVFs) | **Yes** (`schema.js:850`, `search()`) | MasterRecord is ahead here for its engines |
| Cascade delete config | `OnDelete(DeleteBehavior.*)` | **Yes** (`cascadeOnDelete`, `stopCascadeOnDelete`) | parity |

---

## Addendum — additional verified findings from the full inventory

A second, exhaustive pass over the code surfaced items the targeted check missed. Each was re-verified by hand.

### Correctness / data-safety (treat as Tier 1)
- **No foreign-key constraints are ever emitted in DDL.** `REFERENCES` / `FOREIGN KEY` appear only in comments (`migrationSQLiteQuery.js:471,485`, `migrationPostgresQuery.js:333`); `createTable` emits columns only. EF always creates FK constraints (+ an index on the FK). MasterRecord relationships are purely ORM-level — the database enforces nothing, so orphans are possible via raw SQL or any non-ORM writer. **Do:** emit `REFERENCES parent(pk) ON DELETE <behavior>` for `belongsTo`/`hasMany` FKs in all three builders, with `addForeignKey`/`dropForeignKey` on `schema.js`, and EF11's `excludeForeignKeyFromMigrations()` escape hatch for legacy DBs.
- **`stopCascadeOnDelete()` is a no-op.** `cascadeOnDelete` is read nowhere outside `entityModel.js` (the builders only mention it in a doc-comment example); `deleteManager.js:48-106` cascades purely by relationship type into *loaded* values and never consults the flag. Once FK DDL exists, map this to EF's `OnDelete(Cascade|Restrict|SetNull|NoAction)` and honor it in both DDL and the in-process cascade.
- **Lazy-loaded navigation properties return an un-awaited Promise.** The lazy getters call `.single()`/`.toList()` without `await` and assign the result (`entityTrackerModel.js:573,634`), so `post.author` is a `Promise`, not an entity; the SQL is also hand-built SQLite-shaped string interpolation (`TODO` at `:563,595`). EF's lazy loading is proxy-based and synchronous-looking by design. **Do:** either make lazy loading an explicit `await entity.load('author')` (EF explicit loading) and remove the broken auto-getter, or keep it off by default — today it is *on* by default (`entityModel.js:43`).
- **`RedisQueryCache` is broken in the query path.** Its `get`/`set` are `async`, but the read path calls `_queryCache.get(cacheKey)` without `await` and tests truthiness (`queryMethods.js:548,604`) — a Promise is always truthy, so `.cache()` returns a Promise-of-entity. The readme (`:1151-1165`) tells users to swap it in. **Do:** `await` the cache in the read path (the in-memory cache stays sync-compatible), or drop the Redis cache until it is wired.
- **A column/table rename is diffed as drop + add.** `renameTable` exists on the SQLite builder (`migrationSQLiteQuery.js:224`) but `schema.js` has no wrapper and the differ never emits rename — a renamed column in a generated migration is `dropColumn` + `addColumn`, i.e. **data loss on apply**. _Correction:_ EF Core's differ deliberately does **not** auto-detect renames either (it scaffolds drop+add and tells you to review/change to `RenameColumn`, because a guess can move data under the wrong name). **Done in 1.7.0 (EF-faithful):** drop+add is still emitted, but the generated migration carries a `// POSSIBLE RENAME` advisory with the exact `renameColumn(...)` call when one removed and one added column share a definition; `schema.renameTable` added.
- **Index create/drop are generated up-only** (`migrations.js:649-663`) — no `down()` for indexes, so rollback leaves indexes behind.

### API / docs integrity
- **Readme documents APIs that don't exist:** a terminal `.any()` (`readme.md:1452`; the real method is `.exists()`), `context.remove(entity)` / `db.remove(alice)` (`readme.md:340,1415`; only `ctx.Entity.remove()` exists). `docs/METHODS_REFERENCE.md` omits `asNoTracking/asTracking/cache/last/exists/pluck/findById/count/removeRange/track`. Fix the docs (or add the aliases — EF has `context.Remove(entity)`).
- `pluck(field)` loads full entities then maps in JS (`queryMethods.js:366`) — not a SQL projection. Should emit `SELECT field`.
- `take/skip` are interpolated into `LIMIT/OFFSET` (validated non-negative int) rather than parameterized — safe, but noted.
- No `usePostgres()` convenience (Postgres only via `env()`); no `renameTable`, `remove-migration`, `database drop`, migration checksum verification, or command timeout.
- Health checks exist only for Postgres (`postgresSyncConnect.healthCheck`); nothing for MySQL/SQLite or on the context.
- The only public transaction wrapper is Postgres-specific `postgresSyncConnect.transaction(cb)` — reinforces Tier 1 #2 (make it engine-agnostic on the context).

These addenda raise two items into the "do first" bucket alongside concurrency/transactions: **FK constraint DDL** (EF's baseline referential integrity) and the **rename-as-drop+add migration diff** (silent data loss on apply).

## Deliberately out of scope (EF features that don't map to a JS/SQLite-MySQL-PG ORM)

SQL Server vector type / `VECTOR_SEARCH` and JSON indexes, Azure Cosmos DB (full-text, hybrid search, transactional batches, session tokens), temporal tables, `System.Transactions`/ambient transactions, compiled models / Roslyn migration compilation, .NET-specific LINQ translations (`DateOnly`, `DateTimeOffset`, `UInt128`), PowerShell PMC tooling. Don't chase these.

---

## Recommended order

1. **Optimistic concurrency + rows-affected check** (#1) and **explicit transactions** (#2) — they close the only remaining *silent-data-loss* class, and #2 is mostly wiring over existing engine code.
2. **`executeUpdate`/`executeDelete`** (#3) — fixes the N+1 `bulkUpdate/bulkDelete` and gives set-based writes.
3. **Global (named) query filters** (#4) + **context events/interceptors** (#10) — together they deliver EF's soft-delete/multi-tenant/audit recipes.
4. **Logging/redaction** (#6) and **retry** (#5) — production hygiene; the PII-in-dev-logs default is worth fixing soon.
5. **Migrations: transactional apply, script, status, --connection** (#7).
6. **Query ergonomics** (#8, #9, #11): `find`, `entry()`, `thenInclude`, `thenBy`, `distinct`, aggregates, DTO `select`, `groupBy`; and immediately make the empty `join/groupBy` stubs fail loudly.
7. **Modeling** (Tier 3): composite keys → many-to-many → JSON sub-object mapping → computed/default-SQL/check constraints → TPH.

Everything above follows EF's design directly; none of it requires inventing non-EF mechanisms.
