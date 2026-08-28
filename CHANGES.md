# MasterRecord Changelog

## v1.27.0 — `Migrator.GenerateScript` and `HasPendingModelChanges`: EF's `IMigrator` is now complete

1.26.0 moved applying into `Migrator`; this finishes the interface. EF's `IMigrator` is
`Migrate` / `GenerateScript` / `HasPendingModelChanges`, and every masterrecord CLI command
is now a shell over it — there is no second implementation of anything left.

- **`Migrator.generateScript(from, to, { idempotent, appliedMigrations })`** (EF:
  `GenerateScript`). `from` omitted or `'0'` scripts from an empty database and emits the
  history-table bootstrap first, exactly as EF does; `appliedMigrations` scripts against
  what a live database has actually applied, which is what `masterrecord script` passes.
  `--idempotent` wraps each migration in a "only if not already applied" guard (Postgres
  `DO $MR$ … IF NOT EXISTS …`); SQLite and MySQL refuse it, as EF's SQLite provider does.
- **`Migrator.hasPendingModelChanges()`** and `context.database.hasPendingModelChanges()`
  (EF: `HasPendingModelChanges`) — true when entities have changed since the last migration.
- **`context.database.generateMigrationScript()`** for the same thing from an app.
- **`masterrecord script` delegates to it** and gained `--idempotent`.
- **Fix:** the generated script recorded each migration with a *parameterized* insert
  (`VALUES (?, ?)` plus a `-- params:` comment), which is not runnable SQL — the point of
  the command is to hand a DBA something they can execute. It now emits literal values via
  `HistoryRepository.getInsertScript`.
- **`migrations-status` and `remove-migration`** read history through `HistoryRepository`
  instead of their own SQL. The last of the duplicated migration helpers
  (`__getAppliedMigrations`, `__recordMigrationApplied`, `__getAppliedMigrationRows`,
  and the `_masterrecord_migrations` string constant) are deleted — **139 lines of
  duplication removed across 1.26.0 and 1.27.0**.

New tests: `generateScript` (runnable output, applies nothing, pending-only, SQLite refusing
idempotent) and `hasPendingModelChanges` in `test/ef-migrator-apply.test.js`.

## v1.26.0 — one migration code path: `Migrator.Migrate` (EF), and the CLI is a thin shell over it

EF's `IMigrator` is `Migrate` / `GenerateScript` / `HasPendingModelChanges` — applying
migrations *is* the Migrator, and `dotnet ef database update` is a thin shell over it.
masterrecord had the apply logic living inside the `update-database` CLI command instead,
with `update-database-all`, `update-database-down` and `remove-migration` each carrying
their own copy. That is now one path.

- **`Migrator.migrate(target)`** applies and reverts: no target applies everything pending,
  a migration id migrates up or down to it, and `'0'` (EF's `Migration.InitialDatabase`)
  reverts everything, newest first. Each migration is applied **atomically with its history
  row** and recorded as it goes, so an interrupted run resumes where it stopped.
- **`context.database.migrate()`** — EF's `context.Database.Migrate()`, callable from an app
  at startup, not just from the CLI. It discovers the snapshot and migration files, or takes
  them explicitly.
- **`update-database`, `update-database-all`, `update-database-down` and `remove-migration`
  now all delegate to `Migrator`**, and 71 lines of duplicated apply logic were deleted
  (`__applyMigrationStep`, `__ensureMigrationsTable`, `__removeMigrationApplied`).
- **Fix:** `update-database-down` ran `down()` **outside any transaction** — a failed
  rollback could leave a half-reverted schema with the history row still present. Rolling
  back now uses the same per-migration transaction as applying.
- **Fix:** every migration opens its own context (its schema constructor builds one); it is
  now released after the migration runs. Only `update-database-all` did this before, so
  single-context runs leaked a connection per migration.

New tests: `test/ef-migrator-apply.test.js` (apply-all and idempotency, targeted up/down,
revert-to-`'0'`, and `context.database.migrate()`).

## v1.25.0 — EF's Migrator planning: getMigrations / getPendingMigrations

Completes the read half of EF's `DbContext.Database` surface. Ported from Entity
Framework Core (see `THIRD-PARTY-NOTICES.md`).

- **`Migrator`** (`Migrations/Migrator.js`) — EF's `PopulateMigrations` planning, faithfully:
  no target applies every unapplied migration; the `'0'` target (EF's
  `Migration.InitialDatabase`) reverts every applied one, newest first; a target id applies
  unapplied migrations up to and including it and reverts applied ones after it. Applied-id
  matching is case-insensitive, as in EF. `plan(target)` reads the live history table.
- **`MigrationsAssembly`** (`Migrations/MigrationsAssembly.js`) — EF's `IMigrationsAssembly`
  over `<timestamp>_<Name>_migration.js` files, with `getMigrationId()` resolving a full id,
  a file name or the bare migration name (and reporting ambiguity).
- **`context.database.getMigrations()` / `.getPendingMigrations()`** (EF: `GetMigrations` /
  `GetPendingMigrations`). A non-empty pending list means the schema is behind the code —
  a useful startup or health check.
- **Fix (ordering):** `getAppliedMigrations()` returned rows in the history table's
  lexicographic `ORDER BY`, so `1000_Beta` sorted before `900_Alpha`. Migration ids are
  epoch milliseconds and only the same width by coincidence, so ids are now ordered
  chronologically by a comparator (`Migrations/migrationId.js`) shared with
  `MigrationsAssembly` — the files on disk and the rows in the table can no longer disagree
  about what the next migration is.

Applying migrations remains the `masterrecord update-database` CLI's job; this release is
the planner it and your app can both ask. New tests: `test/ef-migrator-planning.test.js`.

## v1.24.2 — reserved-word entity names work end to end on SQLite

- **Fix (SQLite):** `buildFrom` emitted `FROM Order AS ran` unquoted, so every query
  against an entity named with a SQL reserved word (`Order`, `Group`, `Transaction`,
  `Index`…) failed with `near "Order": syntax error`. It is now bracket-quoted like every
  other table reference in that engine. Together with the DDL quoting in 1.24.0, a
  reserved-word entity now creates, inserts, queries, filters, counts, updates and deletes
  normally. MySQL (backticks) and Postgres (`_q()`) already quoted correctly — this was
  SQLite-only. New test: `test/reserved-word-entity.test.js`.
- **Fix (tooling):** `mySQLEngine.js` contained a literal NUL byte — a deliberate delimiter
  in a composite cache key, but written as a raw byte rather than the `\u0000` escape. That
  made the file count as binary, so `grep` skipped it **silently**: no search of the
  repository ever matched anything in the MySQL engine. Same runtime value, now written as
  an escape; the file is UTF-8 text again and searchable.

## v1.24.1 — MySQL/Postgres coverage for the EF port, and a Postgres `ensureDeleted` fix

1.24.0's MySQL and Postgres providers shipped without ever being executed — masterrecord
has no live cross-engine suite (`docker-compose.test.yml` advertises `MR_TEST_MYSQL_URL` /
`MR_TEST_PG_URL`, but nothing read them). Reviewing and testing those paths found a real bug:

- **Fix (Postgres):** `ensureDeleted()` issued `DROP DATABASE` on the context's own
  connection, which Postgres always rejects — *"cannot drop the currently open database"*.
  It now closes the context's pool, connects to the `postgres` maintenance database,
  terminates any other backend attached to the target, and drops from there — the shape
  EF's Npgsql provider uses and the one masterrecord's own
  `_createPostgresDatabaseFromConfig()` already used for CREATE.
- **Fix (MySQL):** `ensureDeleted()` likewise drops through an admin connection with no
  database selected, after closing the context pool. Dropping the schema a live pool points
  at left every pooled connection referring to a database that no longer existed.
- **Hardening:** a database name that is not a plain identifier is now refused rather than
  interpolated into `DROP DATABASE` (the same rule the schema layer already applied to CREATE).
- **Tests:** `test/ef-provider-sql.test.js` drives the HistoryRepository and
  RelationalDatabaseCreator SQL for **all three engines** with a context that captures
  statements instead of running them — no database required, so MySQL/Postgres SQL
  generation is covered on every `npm test`. `test/ef-cross-engine.integration.test.js`
  adds real end-to-end coverage (EnsureCreated → query → history → baseline → EnsureDeleted
  against a scratch database), skipped unless `MR_TEST_MYSQL_URL` / `MR_TEST_PG_URL` are set.

## v1.24.0 — EF Core's database-creation and migrations-history object model

Ported from Entity Framework Core (dotnet/efcore, MIT — see `THIRD-PARTY-NOTICES.md`),
preserving EF's class structure, method names and algorithms.

- **`context.database`** — EF's `DbContext.Database` facade: `ensureCreated()`,
  `ensureDeleted()`, `canConnect()`, `hasTables()`, `generateCreateScript()`,
  `getAppliedMigrations()`, `getAppliedMigrationRows()`, `baseline()`.
- **`RelationalDatabaseCreator`** (`Migrations/RelationalDatabaseCreator.js`) with SQLite,
  MySQL and Postgres implementations: `exists`, `create`, `delete`, `hasTables`,
  `createTables`, `ensureCreated`, `ensureDeleted`, `generateCreateScript`, `canConnect`.
  **`ensureCreated()` is all-or-nothing, exactly as in EF**: it creates the database and the
  model's tables only when the database has *no tables at all*, and never alters an existing
  table. It does not use migrations — use it for tests, prototypes and cold starts, and
  migrations for a schema that has to evolve.
- **`HistoryRepository`** (`Migrations/HistoryRepository.js`) — the migrations history table
  as a first-class, overridable abstraction (EF's `__EFMigrationsHistory`): `exists`,
  `create`, `createIfNotExists`, `getAppliedMigrations`, `getInsertScript`,
  `getDeleteScript`, `recordApplied`, `recordReverted`, and EF's
  `getBeginIfNotExistsScript`/`getEndIfScript` idempotency hooks (implemented for Postgres;
  SQLite refuses them, as EF's SQLite provider does). masterrecord's existing
  `_masterrecord_migrations` table and its column names remain the defaults, so nothing
  changes for existing databases; EF's `ProductVersion` is added as a nullable
  `product_version` column the first time history is written.
- **`HistoryRow`** (`Migrations/HistoryRow.js`) — EF's history row, plus `appliedAt`.
- **Baselining** — `ctx.database.baseline(migrationId)` and `masterrecord baseline <context>
  [migration] [--all]` record a migration as applied **without running it**: EF's documented
  way to bring a database that already has the schema under migration control.
- **CLI**: `masterrecord ensure-created <context>` (EF `EnsureCreated`),
  `masterrecord ensure-deleted <context> --force` (EF `EnsureDeleted`; refuses without
  `--force`), `masterrecord baseline`. `ensure-created` works on a project with no
  migrations yet, so a cold start no longer needs a hand-written bootstrap script.
- **Subpath exports opened** for `Migrations/HistoryRow`, `Migrations/HistoryRepository`,
  `Migrations/RelationalDatabaseCreator`, `Migrations/DatabaseFacade` and
  `Migrations/contextInit` — the last of which previously forced callers to bypass the
  package's `exports` map to reach `instantiateReadyContext`.
- **Fix (SQLite DDL):** `createTable`/`dropTable`/`renameTable` now quote the table name,
  as the MySQL and Postgres builders already did. An entity named with a reserved word
  (`Order`, `Group`, `Transaction`…) previously failed to create with
  `near "Order": syntax error`. Note that **queries** against such a table still fail —
  the query builder does not yet quote table names.

New tests: `test/ef-database-creator.test.js`.

## v1.23.0 — entity property reads ~16x faster (shared prototype per entity type)

- **Perf:** every entity of a type now shares **one prototype** and keeps its backing slots (`_<col>`, `_<nav>`, `__loading_<nav>`) as **non-enumerable own properties**. Before, each row got a fresh `{}` prototype holding its slots, so every entity had its own V8 hidden class and `entity.col` was a megamorphic accessor read: **~326 ns/read** (both tracked and `asNoTracking()`), i.e. an O(n²) loop over two 2 000-row tables took seconds and over larger tables minutes. Now **~20 ns/read**; the 2 000×2 000 nested loop went from 2.07 s to 0.19 s. EF Core entities are POCOs — a property read should cost about what a plain object read costs.
- Public shape is unchanged: `Object.keys(entity)` / `JSON.stringify` / `{ ...entity }` still expose only columns; navigation getters, `asNoTracking()`, change tracking, `Object.create(entity)` clean models (engine idiom: reads walk the chain, writes reach the owner through the entity's `__self`) all behave as before. Internal slot access is centralized in `tools.slotOwner/getSlot/setSlot/hasSlot/deleteSlot` (code that poked `Object.getPrototypeOf(entity)['_col']` must use these).
- Guidance still holds for hot loops: prefer `asNoTracking()` for read-only queries (no tracking bookkeeping per row) and build one-pass `Map`s instead of nested loops.

New test: `test/entity-layout-read-performance.test.js`.

## v1.22.1 — boolean columns materialize as booleans on read (fix)

- **Fix:** `db.boolean()` columns are now materialized as real `true`/`false` when rows are read (`toList()/find()/single()/first()`, tracked or `asNoTracking()`), matching EF Core value conversion. SQLite stores booleans as INTEGER `0/1` and MySQL as `TINYINT(1)`/`BIT(1)`, so an entity read back exposed `1`/`0` (an API echoed `{ published: true }` after the insert but `{ published: 1 }` after a later read/update). `null` is preserved; other types are untouched; a custom `transform()` still wins. Implemented as `FieldTransformer.materialize(value, fieldDef)`, applied on the single row→entity path.
- Found validating the `master new` scaffold end to end. New test: `test/boolean-materialization.test.js`.

## v1.22.0 — owned / complex types as JSON (EF Core `OwnsOne(...).ToJson()` / `ComplexProperty`)

- **`db.owned(Address)`** stores the value as JSON in one column and **hydrates it into the class on read**; **`db.owned()`** for plain objects/arrays. Serialization is automatic (a custom `transform()` still wins).
- **Nested mutations are detected at `saveChanges()`** — `user.address.city = 'Paris'` or `prefs.tags.push('x')` never touch a column setter, so the context compares the serialized value with the loaded one (EF `DetectChanges` on complex properties) and writes only when it differs; replacing the whole value or setting `null` works as before.

New tests: `test/owned-types.test.js`.

## v1.21.0 — `groupBy().aggregate()` (EF Core GroupBy + Select(g => new { g.Key, g.Count(), g.Sum(…) }))

- **`groupBy('o => o.status'[, 'region'…]).aggregate({ n: 'count', total: ['sum', 'amount'], avg: ['avg', 'amount'] }, { having: { n: ['>', 1] }, orderBy: [['total', 'desc']] })`** → `[{ status, region?, n, total, avg }]`, translated to `SELECT <groups>, <aggregates> … GROUP BY … [HAVING …] [ORDER BY …] [LIMIT/OFFSET]` on SQLite, MySQL and Postgres. `where()/and()`, global query filters (and `ignoreQueryFilters()`), `take()/skip()` apply to the groups. Aggregates: `count`, `sum`, `avg`, `min`, `max`; `having` operators `==, !=, >, >=, <, <=` (parameterized); identifiers are validated, unknown columns/aggregates/aliases fail loudly. `groupBy()` used to throw "not supported".
- `join()` / `leftJoin()` remain unsupported by design — `include()`/`thenInclude()` cover relationship loading; use `ctx.query()` for hand-written joins.

New tests: `test/group-by.test.js`.

## v1.20.0 — composite primary keys (EF Core `HasKey(a, b)`)

- **Two or more `.primary()` columns form a composite key.** DDL on all three engines emits a table-level `PRIMARY KEY (a, b)` (key columns NOT NULL, no inline PRIMARY KEY / auto-increment; an `auto()` column inside a composite key is rejected, as EF rejects identity columns there).
- **UPDATE and DELETE address the row by every key column** (the extra key columns ride in the WHERE like concurrency tokens); bulk deletes of composite-key entities run per row (a `WHERE IN` on one column cannot address them); rows-affected checks still apply.
- **`find(a, b)` / `find({ a, b })` / `findById(a, b)`** (EF `Find(a, b)`), identity-map first; `reload()`, `entry().getDatabaseValues()` and the post-insert read-back of generated columns use every key. Wrong arity fails with a clear message naming the key columns.
- Not supported (documented): FKs *to* a composite-key entity and `manyToMany()` owners with composite keys.

New tests: `test/composite-keys.test.js`.

## v1.19.0 — table-per-hierarchy inheritance (EF Core's default inheritance mapping)

- **`dbset(Cat, { extends: Animal })`** maps a derived model onto its base's table (TPH). The hierarchy table gains a **discriminator column** (`discriminator` by default, values = model names — EF's convention; override with `{ discriminator, value }`) and the derived models' own columns (nullable — rows of other types leave them NULL). Migrations see **one table**; base rows carry the base name.
- **`ctx.Cat` / `ctx.Dog`** query the base table with the discriminator predicate — part of the type mapping, so `ignoreQueryFilters()` never removes it (EF) — and **inserts / `.new()` stamp the discriminator**; updates, `count`, `executeUpdate/Delete`, `find` etc. all scope to the type. **Base-type global query filters apply to derived sets** (EF), and a derived set can have its own.
- **`ctx.Animal` returns the whole hierarchy, each row materialized as its derived type** (a Cat read through the Animal set has `lives` and `__entity.__tph.value === 'Cat'`), so updating it persists as a Cat.
- Misuse fails loudly: derived registered before its base, a derived type declaring its own primary key, conflicting discriminator column names.

New tests: `test/tph-inheritance.test.js` (model/DDL/migrations single table; insert via derived/base/.new(); filtered derived queries; base set materialization; updates through both; base filter on derived; set-based delete per type; misuse).

## v1.18.0 — global query filters inside include() (EF HasQueryFilter on navigations, IgnoreQueryFilters for the whole query)

- **Included navigations honor the target entity's global query filters** (soft delete, tenant…), as in EF Core: `include()` of a navigation whose target has active filters loads through the split loader, whose dbset queries apply them; lazy/explicit loading already did. A filtered-out `belongsTo` parent reads `null`.
- **`ignoreQueryFilters()` / `ignoreQueryFilters([names])` on the root query propagate to every included level** (EF: `IgnoreQueryFilters` applies to the whole query), including `thenInclude()` levels.
- Previously only the root entity was filtered; the joined (SQL) include returned soft-deleted / foreign-tenant rows.
- **SQLite: boolean (and Date / undefined) query parameters are now bindable** — `where('x => x.flag == $$', true)` and boolean query filters threw `SQLite3 can only bind numbers, strings, bigints, buffers, and null`; every statement now normalizes `true/false → 1/0`, `undefined → NULL`, `Date → ISO` (MySQL/Postgres already accepted them).

New tests: `test/include-query-filters.test.js`.

## v1.17.0 — `thenInclude()` and `asSplitQuery()` (EF Core ThenInclude / AsSplitQuery)

- **`include('p => p.tags').thenInclude('t => t.category')`** (chain `thenInclude()` again for deeper levels): implemented as EF's **split query** — after the main query, **one batched query per navigation level** (`IN` on the parent keys, chunked by 500), on every engine; no cartesian explosion, no N+1. Works for belongsTo, hasOne, hasMany, hasManyThrough and manyToMany at any depth; `single()`/`first()` run it too. Levels already hydrated by the eager (SQL) `include()` are reused; the rest are batch-loaded.
- **`asSplitQuery()`** (call before `include()`): every `include()` of the query loads as a separate batched query instead of one joined statement (EF `AsSplitQuery`). Bare navigation names (`include('author')`) are accepted alongside lambdas.
- **`include()` of an implicit many-to-many navigation** (`manyToMany()`) goes through the split loader automatically.
- Loaded collections keep EF's `add()/remove()`; a loaded reference with no related row is `null` (EF) and is **not** lazy-loaded again — `null` in the navigation slot now means "loaded, nothing there", `undefined` means "not loaded".
- Low-level: `ctx.__batchLoadNavigation(parents, nav)`.

New tests: `test/then-include.test.js` (manyToMany → belongsTo with exactly 4 SELECTs for N posts; asSplitQuery hasMany → manyToMany → belongsTo with 5 SELECTs; batched belongsTo include; single()/first(); misuse errors).

## v1.16.0 — many-to-many skip navigations (EF Core 5+ `HasMany().WithMany()`) + collection Add/Remove

- **`db.manyToMany('Tag')`**: the context **synthesizes the implicit join entity** (EF convention: the two entity names in alphabetical order, e.g. `PostTag`) with an auto primary key, `belongsTo()` to both sides (`post_id`, `tag_id`, FK constraints with ON DELETE CASCADE) and a **unique composite index** — registered through `dbset()` so table prefix, FK type resolution, migrations/snapshot, `ctx.PostTag` and the query builders all see it. Declaring the navigation on both sides maps to the same join entity. Options: `{ through, foreignKey, otherKey }` (self-referencing must pass both keys, as EF names them after the navigations).
- **Insert:** `post.tags = [tagEntity, tagId, { label: 'new' }]` — persisted targets are linked by key, **new targets are inserted first** (EF cascade insert), then one join row per element.
- **Load:** `await post.tags`, `ctx.entry(post).collection('tags').load()`, reverse side `await tag.posts` — join → targets, parameterized, every engine.
- **Collections have EF's `add()` / `remove()`** (non-enumerable, JSON-safe) on loaded `hasMany` and `hasManyThrough`/`manyToMany` navigations, plus `ctx.entry(e).collection(nav)` (`load`, `isLoaded`, `add`, `remove`) and `ctx.entry(e).reference(nav)` (`load`, `isLoaded`) — EF's `Entry(e).Collection(n)` / `Reference(n)`. `add()` tracks a join row (or sets the child's FK; new targets/children are added to the tracker), `remove()` schedules the join row for DELETE (or NULLs a nullable FK / deletes an orphan of a required relationship, like EF); nothing hits the database until `saveChanges()`. Duplicate links fail at save on the unique index (EF throws too). Low-level: `ctx.linkNavigation(owner, nav, item)` / `ctx.unlinkNavigation(owner, nav, item)`.
- Explicit `hasManyThrough` navigations gain the same collection API; `_joinSides()` resolves both FK sides (explicit keys first, then by table).

New tests: `test/many-to-many.test.js` (synthesis once for both sides + model/migrations visibility; insert by entity/id/new object; lazy + explicit load both ways; add/remove incl. new target; duplicate rejected; cascade delete of join rows only; hasMany collection add/remove with nullable FK).

## v1.15.0 — health checks on every engine + `remove-migration` (EF `migrations remove`)

- **`await context.healthCheck()`** → `{ healthy, engine, latencyMs, version, … }` on SQLite, MySQL and Postgres (pool counters / server time where the driver exposes them); **never throws** — on failure `{ healthy: false, engine, error }`. **`await context.canConnect()`** (EF `Database.CanConnect()`). Previously only the Postgres sync-connect helper had a health check.
- **`masterrecord remove-migration <context>`** (alias `rm`; EF `dotnet ef migrations remove`): deletes the latest migration file. Like EF it **refuses an applied migration** with instructions, unless **`--force`**, which reverts it first (down, in its own transaction via the atomic step) and updates the snapshot's `latestMigration` to the previous applied one. A pending migration is simply deleted — the snapshot needs no rewrite because masterrecord's snapshot reflects the *applied* database state.

New tests: `test/health-check.test.js`, `remove-migration` cases in `test/migrations-tooling.test.js`.

## v1.14.0 — DDL modeling parity: defaultSql / computed / check (EF HasDefaultValueSql, HasComputedColumnSql, HasCheckConstraint)

Closes the Tier-3 "computed columns / default SQL / check constraints" gap on all three engines.

- **`db.defaultSql('CURRENT_TIMESTAMP')`** (EF `HasDefaultValueSql`): a database-side default *expression*, emitted verbatim (parenthesized when it is not a literal/`CURRENT_*`; on MySQL always parenthesized except literals, because masterrecord maps temporal types to TEXT and MySQL only accepts expression defaults there). Postgres `alterColumn` emits `SET DEFAULT (expr)`. The SQLite schema sync compares the stored expression so a `defaultSql` column no longer looks "changed" on every run.
- **`db.computed('CAST(ROUND(price * 100) AS INTEGER)', { stored })`** (EF `HasComputedColumnSql`): renders `GENERATED ALWAYS AS (expr) STORED|VIRTUAL` (Postgres: STORED only). The ORM **never writes** a computed column — it is skipped on INSERT and UPDATE in all three engines, even when `entry(e).state = 'modified'` marks everything — and its value is **read back onto the entity after INSERT** (EF fetches generated values after `SaveChanges`). SQLite introspection now uses `PRAGMA table_xinfo` so generated columns are seen by schema sync (`table_info` hides them); adding a computed column to an existing SQLite table rebuilds it (SQLite cannot `ADD` a STORED generated column — EF's SQLite provider rebuilds too), and the rebuild's data copy excludes generated columns.
- **`db.check('qty >= 0', 'CK_Product_qty')`** (EF `HasCheckConstraint`): `[CONSTRAINT name] CHECK (expr)` on the column, all engines; violations surface as the engine's constraint error on `saveChanges()`.
- **DB defaults are read back after INSERT** when the entity left the column unset (`default()` / `defaultSql()`), so a later full `Update()` writes the real value instead of NULL over the database default.
- Contradictory modeling (`computed()` + `default()`/`defaultSql()`/primary/auto) fails loudly, naming the column.
- **Bug fixed (1.12.0):** `entry(e).state = 'modified'` marked entity metadata (`__compositeIndexes`) as a dirty column (`no such column: __compositeIndexes`) and used the FK *column* name for `belongsTo` fields, which the engines could not resolve. New `_scalarFields()` marks exactly the writable fields.
- Shared `Migrations/ddlClauses.js` renders the clauses for SQLite / MySQL / Postgres identically.

New tests: `test/ddl-modeling.test.js` (all three builders: DEFAULT expr / GENERATED ALWAYS AS STORED|VIRTUAL / CHECK with and without name, Postgres STORED-only and `SET DEFAULT (expr)`, contradictory options; SQLite end-to-end: default applied, computed derived + read back + never written on INSERT/UPDATE incl. full `Update()`, recomputed, DB default preserved, CHECK enforced, schema sync sees the generated column and is idempotent without losing rows).

## v1.13.0 — navigation loading done the EF way (explicit/lazy loading, fix-up) + async query cache

Closes the three "outright bugs" from the EF gap analysis addendum.

- **Explicit loading** (EF `Entry(e).Reference(n).Load()` / `Collection(n).Load()`): `await ctx.entry(e).load('nav')`, `ctx.loadNavigation(e, 'nav')`, `ctx.entry(e).isLoaded('nav')` / `ctx.isNavigationLoaded(e, 'nav')`. Works for `belongsTo`, `hasOne`, `hasMany` and `hasManyThrough` on **every engine**, through the normal parameterized query builder (the old getter issued SQLite-shaped SQL with the key *value* interpolated into the lambda — a string key with a quote broke it, and it was an injection surface).
- **Lazy loading adapted to async drivers:** reading an unloaded navigation with lazy loading on (default) returns a Promise that loads it **once** and caches it (`await post.author`); after that (or after `include()`/explicit load) the read is synchronous. With `lazyLoadingOff()` an unloaded navigation reads `null` (EF). Errors are thrown, not returned as strings. An un-awaited lazy read can no longer crash the process with an unhandled rejection.
- **Relationship fix-up (EF):** `post.author = someAuthor` sets `post.author_id` and marks the entity dirty; changing `post.author_id` invalidates a previously loaded `post.author` so the next read re-resolves instead of returning a stale parent; the legacy idiom `post.author = authorId` still works and keeps the FK column in sync.
- **Engines never persist a navigation object.** All three engines read the FK value for a `belongsTo` field through one helper (`Tools.foreignKeyValue`) — an assigned entity → its key, an assigned primitive, or the FK column — and never through the navigation getter. Previously a loaded navigation (or the lazy Promise) could leak into the UPDATE (`Type mismatch … got object`), and invoking the getter on the engines' derived clean model wrote the lazily-loaded parent as an own property on the real entity, shadowing the slot (saves then wrote the *old* key).
- **Inserts** accept a parent entity, an id on the navigation, or the FK column, on plain `new Model()`, `.new()` and `add()`-ed objects; an already-persisted parent assigned to a `.new()` entity is no longer re-INSERTed (`INSERT failed: No columns to insert`) — its key is used (EF fix-up). `.new()` no longer assigns a random `__ID` (same identity-map collision class fixed for queried entities in 1.5.12).
- **`RedisQueryCache` actually works:** `.cache()` reads now `await` the cache `get()`, so an async cache returns the entity rather than a Promise-of-entity being treated as a hit.

New tests: `test/navigation-loading.test.js` (lazy belongsTo via a string PK containing a quote, caching, fix-up on entity assignment and persisted FK; explicit `entry().load()` for hasMany/hasOne/hasManyThrough incl. empty; `lazyLoadingOff()` → null then explicit load; FK-column change invalidating a loaded parent; legacy id assignment; inserts via entity/id/FK column on plain and `.new()` objects). Full suite green (0 fail, 370 pass, 20 gated skipped); 0 lint errors.

## v1.12.0 — query & change-tracker ergonomics (EF Find, Entry, aggregates, ThenBy, Distinct, Any, context.Add/Remove)

Closes gap-analysis #8, #9 and most of #11.

- **`ctx.Model.find(pk)`** (EF `Find`): checks the identity map first and returns the tracked instance **without a query**; otherwise loads (and tracks). `findById` remains the always-query form.
- **`ctx.entry(entity)`** (EF `DbContext.Entry`): `state` (get/set: `track`/`modified`/`insert`/`delete`/`detached`; setting `modified` with no dirty fields marks every column like EF `Update()`), `originalValues`, `currentValues`, `isModified(field?)`, `reload()`, `getDatabaseValues()` (live row, ignores query filters, doesn't touch the entity), `detach()`. **`ctx.hasChanges()`** (EF `ChangeTracker.HasChanges`) and **`ctx.entries([model])`** (EF `ChangeTracker.Entries`).
- **Aggregates `sum/avg/min/max(field)`** on any query (EF `Sum/Average/Min/Max`), honoring `where`/`and` and global query filters; `sum` of no rows is `0`, the others `null`. Engines gain `getAggregate`.
- **`thenBy(field|lambda)` / `thenByDescending`** (EF `ThenBy`): secondary sort keys with independent directions on all three engines; **`distinct()`** (EF `Distinct` → `SELECT DISTINCT`); **`any([predicate, ...args])`** (EF `Any`) — the readme documented `.any()` for years but it never existed; **`toObjectList(options)`** (plain-object DTO list, not tracked).
- **`pluck(field)` is now a SQL projection** (`SELECT <field>` with no tracking) instead of loading full entities and mapping in JS.
- **`ctx.add(entity)` / `ctx.remove(entity)` / `addRange` / `removeRange`** (EF `DbContext.Add/Remove`) — the readme documented `context.remove(entity)` which did not exist; they resolve the owning dbset by entity metadata or constructor name.
- **`join()`, `groupBy()`, `leftJoin()` now throw a clear `not supported yet` error** with the alternative to use — they were empty bodies returning `undefined`, so chaining off them threw a bare `TypeError`.
- Not in this release (documented limitation): `thenInclude`, `groupBy`/`join` translation.

New tests: `test/query-ergonomics.test.js` (identity-map `find` with no SQL; entry state/original/current/isModified/getDatabaseValues/detach, hasChanges, entries; aggregates incl. empty-set semantics and invalid column; orderBy+thenBy/thenByDescending ordering, distinct, any, toObjectList, pluck selects only its column; context add/remove; loud stubs). Full suite green (0 fail, 366 pass, 20 gated skipped); 0 lint errors.

## v1.11.0 — migrations tooling: atomic apply, `script`, `migrations-status`, `--connection`, latest-migration id (EF parity)

Closes gap-analysis #7.

- **Each migration now applies atomically** (EF Core: one transaction per migration). The migration's DDL/DML **and its tracking-table row** commit or roll back together, so a failing migration can no longer leave a half-applied schema. PostgreSQL: `BEGIN…COMMIT`. SQLite: transactional too, with FK enforcement switched off *before* the transaction and restored after (SQLite's `PRAGMA foreign_keys` is a no-op inside a transaction and the table-rebuild path depends on it — exactly EF's SQLite approach). MySQL: DDL implicitly commits, so atomicity isn't possible there (EF documents the same); it runs as before. Used by `update-database` and `update-database-all`.
- **`masterrecord script <ctx> [-o file]`** (EF `migrations script`): prints the SQL that `update-database` *would* run for pending migrations — DDL plus the tracking-table insert, per migration — **without applying anything**. Introspection still runs against the live database so the plan is accurate; execution is captured instead of performed.
- **`masterrecord migrations-status <ctx>`** (EF `migrations list`): applied migrations with timestamps, pending ones, recorded-but-missing files, and the snapshot's latest migration.
- **`--connection <json>`** global option (EF `--connection`): a JSON connection config (optionally keyed by context name) overriding the environment file for that run, e.g. `update-database AppContext --connection '{"type":"sqlite","connection":"./tmp/"}'`. Honored by `context.env()` via `MASTERRECORD_CONNECTION_OVERRIDE`.
- **Snapshot records `latestMigration`** (EF 11): two branches that each add a migration now conflict on merge, surfacing a divergent migration tree instead of silently diverging.
- Internals: `__applyMigrationStep`, `__resolveMigrationPlan`, `__getAppliedMigrationRows` helpers in the CLI.

New tests: `test/migrations-tooling.test.js` (status before/after + snapshot latest id; `script` emits DDL + tracking insert and leaves the DB untouched, `--output` file; a failing migration is rolled back atomically with nothing recorded; `--connection` override creates the DB at the overridden location). Full suite green (0 fail, 360 pass, 20 gated skipped); 0 lint errors.

## v1.10.0 — pluggable logging with parameter redaction (EF LogTo/EnableSensitiveDataLogging) + retry on transient failures (EF EnableRetryOnFailure)

Closes gap-analysis #5 (resiliency) and #6 (logging/diagnostics), the way EF Core does them.

**Logging (`logging.js`, `masterrecord.configureLogging(...)`)**
- **Behavior change (security):** SQL is **no longer logged by default**. Previously every SQL statement **with its parameter values** was printed whenever `NODE_ENV !== 'production'` — PII and secrets in dev logs. Like EF, nothing is logged unless you ask (`configureLogging({ logSql: true })` or `LOG_SQL=true`), and **parameter values are redacted to `?` by default** — opt in with `sensitiveData: true` / `MR_SENSITIVE_LOGGING=true` (EF `EnableSensitiveDataLogging`).
- Pluggable `logger` (`{ debug, info, warn, error }`, default `console`) and min `level`; `slowQueryMs` warns on slow commands **even when SQL logging is off** (`MR_SLOW_QUERY_MS`); migration DDL logged at `info` unless `migrations: false` / `MR_SILENT_MIGRATIONS=true`; failed commands logged at `error` with duration.
- All three engines route **every** command (reads, writes, DDL, raw) through one timed path that feeds the logger and the `command` event; the SQLite no-param `_execute` path (previously unobserved) is included. Query-cache debug chatter now goes through the logger at `debug` instead of `console.debug` in non-production.
- `masterrecord.getLoggingConfig()`; exports `masterrecord/logging`.

**Connection resiliency (`resilience.js`, `ctx.setRetryOnFailure(...)`, `masterrecord.configureRetry(...)`)**
- Retries operations on **transient** errors with capped exponential backoff + jitter (EF's execution strategy): SQLite `SQLITE_BUSY`/`LOCKED`, MySQL deadlock/lock-wait-timeout/too-many-connections, Postgres `40001`/`40P01`/`57P0x`/`08xxx`, and network `ECONNRESET`/`ETIMEDOUT`/`PROTOCOL_CONNECTION_LOST` on any engine. Non-transient errors (constraints, syntax, `ConcurrencyError`) are never retried.
- Applies to queries (`toList`/`single`/`count`…), `saveChanges()` (the whole unit of work is re-run; a failed attempt rolled back and left entities dirty) and `executeUpdate`/`executeDelete`. **Not** inside an explicit transaction (EF: the transaction is the retry unit). Off by default (EF default); per-context `setRetryOnFailure({ maxRetries, maxDelayMs, baseDelayMs, onRetry })` or `false`; process-wide default via `masterrecord.configureRetry(...)`. A `retry` event `{ attempt, maxRetries, delayMs, error }` fires before each wait. `masterrecord.isTransientError(err, engine)`; exports `masterrecord/resilience`.

New tests: `test/logging-redaction.test.js` (nothing logged by default; SQL logged with redacted params; values only when opted in; slow-query warning with logSql off; migration DDL at info / silenced; failed command at error; config validation) and `test/retry-on-failure.test.js` (classifier per engine; query retry with `retry` events and exhaustion; non-transient not retried; no retry inside a transaction; saveChanges retry commits exactly once; global default + per-context override). Full suite green (0 fail, 356 pass, 20 gated skipped); 0 lint errors.

## v1.9.0 — named global query filters (EF HasQueryFilter) + context events/interceptors

Closes gap-analysis #4 (query filters) and #10 (context-level interceptors) — together they deliver EF's soft-delete, multi-tenancy and audit recipes.

**Global query filters (EF Core `HasQueryFilter`, named filters in EF 10, `IgnoreQueryFilters`)**
- `this.dbset(Blog).queryFilter('softDelete', 'b => b.deletedAt == null').queryFilter('tenant', 'b => b.tenantId == $$', ctx => ctx.tenantId)` (or `ctx.queryFilter('Blog', name, lambda, ...args)`; omit the name for a single unnamed filter). The predicate is a normal where-lambda.
- Applied to **every** query on the entity: `toList`/`single`/`first`/`last`/`exists`/`findById`/`count` **and** `executeUpdate`/`executeDelete` (EF applies filters to ExecuteUpdate/Delete too). Composes with the user's `where()`/`and()` regardless of lambda alias.
- **Named**: several coexist; `query.ignoreQueryFilters()` drops all for that query, `ignoreQueryFilters(['softDelete'])` drops only those (EF 10). `ctx.removeQueryFilter(model, name)`.
- Args may be **functions evaluated at query time with the context** — the EF pattern of a filter referencing a DbContext field (`tenantId`).
- Known limitation (documented): filters apply to the root entity of a query, not yet inside `include()`d navigations.

**Events / interceptors (EF `SavingChanges`/`SavedChanges`/`SaveChangesFailed`, `ChangeTracker.Tracked`/`StateChanged`, `IDbCommandInterceptor`)**
- `ctx.on(event, handler)` / `once` / `off` (returns an unsubscribe fn). Events:
  - `savingChanges { context, entries }` — runs **before** the flush and may mutate entities (audit columns) or convert a delete into a soft-delete (`entity.__state = 'modified'; entity.deletedAt = …`); the change set is **re-collected afterwards** so those edits ship in the same save. Async handlers are awaited.
  - `savedChanges { context, entries }` after commit; `saveChangesFailed { context, entries, error }` before the error is rethrown.
  - `tracked { context, entity }` when an entity enters tracking; `stateChanged { context, entity, state }` when it becomes dirty.
  - `command { sql, params, durationMs, engine, error? }` for **every** SQL statement — engines now carry a command-observer set (`addCommandObserver`/`removeCommandObserver`); contexts attach on `on('command')` (also after init) and detach on `close()`. This is the hook Phase 5 logging/slow-query reporting builds on.

New tests: `test/query-filters.test.js` (apply to list/count/single/findById, compose with user where incl. different alias, ignore all / ignore by name, query-time function args, executeUpdate/executeDelete respect filters, removeQueryFilter + ctx.queryFilter form) and `test/context-events.test.js` (audit-column stamping via savingChanges + savedChanges, delete→soft-delete conversion, saveChangesFailed with error, tracked/stateChanged, command observer with timing, once/unsubscribe). Full suite green (0 fail, 348 pass, 20 gated skipped); 0 lint errors.

## v1.8.0 — executeUpdate / executeDelete (EF ExecuteUpdate/ExecuteDelete) + set-based bulk ops

Closes gap-analysis #3. Set-based writes that run **one SQL statement** over the rows a query selects, **bypass the change tracker**, execute immediately, and return rows affected — exactly EF Core's `ExecuteUpdate`/`ExecuteDelete`.

- **`query.executeDelete()`** — `DELETE … WHERE <the query's own compiled WHERE>`; returns rows affected.
- **`query.executeUpdate({ col: value, … })`** — `UPDATE … SET … WHERE <compiled WHERE>`; values are parameterized and run through the column's transformer; returns rows affected. To reference existing values (EF's `SetProperty(b => b.Views, b => b.Views + 1)`) use the new **`sql`** tag: `executeUpdate({ views: sql\`views + 1\` })` (`masterrecord.sql` / `import { sql } from 'masterrecord/sql'`). The tag **refuses interpolations** so raw fragments can't smuggle values — dynamic values go in ordinary (parameterized) setters. Validates columns; refuses to update the primary key; `include()`/`raw()` are rejected.
- Both reuse the engine's own WHERE compiler (same alias, same parameters), so the affected rows are exactly what the equivalent `toList()` would return. Inside `ctx.transaction()` they join the transaction; otherwise each is an autocommit statement (EF semantics). They invalidate the query cache for the table and serialize with other units of work on the shared connection.
- Engines: `executeUpdate(query, entity, setters)` / `executeDelete(query, entity)` on all three (MySQL uses the multi-table `DELETE alias FROM t AS alias` form so it works on every version; Postgres renumbers SET params after the WHERE's `$n`).
- **`ctx.bulkUpdate` / `ctx.bulkDelete` are now genuinely set-based**: `bulkDelete` is one `DELETE … WHERE pk IN (…)` (returns rows affected); `bulkUpdate` is one UPDATE per item in a single transaction with rows-affected checks — **no per-row SELECT**, no tracker round-trip (previously `findById` + `saveChanges()` per id: N SELECTs and N transactions, despite the docstring).
- `masterrecord` now also exposes `ConcurrencyError` and `RawSql`.

New tests: `test/execute-update-delete.test.js` (exact-row update with parameterized + `sql` setters and no tracker involvement; whole-table update; `sql` interpolation refused; column/PK validation; exact-row delete; join/rollback inside a transaction; cache invalidation; bulk ops issue no SELECTs and still fail on a missing id). Full suite green (0 fail, 339 pass, 20 gated skipped); 0 lint errors.

## v1.7.0 — FOREIGN KEY constraints in DDL (EF referential integrity) + rename advisories in migrations

Closes gap-analysis items "no FK constraints", "cascade config is a no-op", and "rename diffed as drop+add", the way EF Core does.

**FOREIGN KEY constraints** — relationships were ORM-only; no `REFERENCES`/`FOREIGN KEY` was ever emitted, so the database enforced nothing. Now every `belongsTo` column gets a FK constraint (EF always creates FK constraints for relationships):
- **SQLite:** inline `CONSTRAINT fk_<table>_<col> FOREIGN KEY (...) REFERENCES parent(pk) ON DELETE …` in `CREATE TABLE` (SQLite has no `ADD CONSTRAINT`); the connection now enables **`PRAGMA foreign_keys = ON`** so constraints are enforced (`MR_SQLITE_FOREIGN_KEYS=off` opts out). The SQLite table rebuild in `syncTable` preserves FKs. New `belongsTo` columns added via `addColumn` get an inline `REFERENCES` when nullable/defaulted.
- **MySQL/Postgres:** `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` is issued **after** the table — immediately if the referenced table exists, otherwise **deferred** and flushed by the new **`schema.finalize()`**, which the CLI calls after each migration's `up()`/`down()`. Table creation order and cycles therefore never matter; a still-missing referenced table is reported as a clear model error.
- **ON DELETE follows the model** (EF `OnDelete(DeleteBehavior.*)`): `CASCADE` by default; **`stopCascadeOnDelete()` is now honored** → `SET NULL` (nullable) / `RESTRICT` (required); new **`.onDelete('cascade'|'restrict'|'setNull'|'noAction')`** for explicit control.
- New **`.excludeForeignKeyFromMigrations()`** (EF 11): keep the relationship in the ORM but emit no DB constraint (legacy DBs, data-sync).
- An **index is created on every FK column** (SQLite/Postgres; MySQL auto-indexes FKs), as EF does.
- New `schema.addForeignKey(fk)` / `schema.dropForeignKey(fk)` (MySQL/Postgres) for hand-written migrations — e.g. to add constraints to tables created before this release (the snapshot does not record constraints, so existing tables are not retrofitted automatically; write a migration calling `addForeignKey`).

**Rename advisories (EF parity, not auto-rename)** — a renamed column was diffed as `dropColumn` + `addColumn`, which **destroys the column's data** on apply. EF Core's differ deliberately does *not* auto-detect renames (it cannot tell a rename from an unrelated drop+add — guessing wrong moves data under the wrong name) and tells you to review and change the scaffold to `RenameColumn`. MasterRecord now matches EF: drop+add is still emitted, but when exactly one removed and one added column share an identical definition, the generated migration carries a **`// POSSIBLE RENAME`** advisory with the exact `await this.renameColumn({...})` call to swap in, and `add-migration` prints a warning. Ambiguous cases get no advisory. New `schema.renameTable({tableName,newName})`; `renameColumn` now validates its spec.

New tests: `test/foreign-key-constraints.test.js` (SQLite inline FK + ON DELETE variants incl. `onDelete`/`stopCascadeOnDelete`/`excludeForeignKeyFromMigrations`; MySQL/PG `ADD CONSTRAINT` SQL; end-to-end SQLite enforcement: pragma on, orphan insert rejected, CASCADE delete, FK index; `finalize()` error on a missing referenced table) and `test/migration-rename-detection.test.js` (advisory emitted with drop+add intact; none when ambiguous or when definitions differ). Full suite green (0 fail, 333 pass, 20 gated skipped); 0 lint errors.

## v1.6.0 — optimistic concurrency (EF concurrency tokens) + explicit transactions

Closes the last **silent lost-write** class identified in `docs/EF_CORE_GAP_ANALYSIS.md` (#1 and #2), implemented the way Entity Framework Core does.

**Optimistic concurrency**
- `db.field().concurrencyToken()` — the column's **original** (as-loaded) value is added to every UPDATE/DELETE `WHERE` (EF `IsConcurrencyToken`). You rotate the value when you change the row.
- `db.rowVersion()` — an ORM-managed integer token bumped **atomically** in the same statement (`SET v = v + 1 … WHERE v = <original>`), mirrored onto the entity and re-snapshotted as the new original after a successful save. Portable across SQLite/MySQL/PostgreSQL (EF `IsRowVersion`, application-managed).
- **Rows-affected is now always checked** on UPDATE and DELETE (previously never): a row that was concurrently modified (token mismatch) or deleted affects 0 rows → `saveChanges()` rolls the batch back and throws **`ConcurrencyError`** (EF `DbUpdateConcurrencyException`; `err.entries` = conflicting entities, `err.code = 'MR_CONCURRENCY_CONFLICT'`). Before, such saves returned `true` and silently overwrote or no-op'd.
- Entities now carry **original values** (`__originalValues`, non-enumerable) captured at load / after insert / after save; `reload()` resets them (EF `Reload()`), which is what makes "reload and retry" resolution work. `reload()` also no longer leaves a duplicate tracked instance behind.
- Engines expose `affectedRows(result)` (SQLite `changes`, mysql2 `affectedRows` — mysql2 connects with `FOUND_ROWS`, so this is rows *matched*, as required; pg `rowCount`). Bulk deletes check total rows affected; entities with tokens are deleted per-row.
- New module `errors.js` (`ConcurrencyError`), also re-exported from `context.js`.

**Explicit transactions**
- `ctx.transaction(async tx => { … })` — begin → run → commit, rollback + rethrow on error (recommended form).
- `ctx.beginTransaction()` / `ctx.commit()` / `ctx.rollback()` (+ `commitTransaction`/`rollbackTransaction` aliases), `ctx.inTransaction`.
- `ctx.createSavepoint(name)` / `rollbackToSavepoint(name)` / `releaseSavepoint(name)` (names validated as identifiers).
- Inside a user transaction, each `saveChanges()` is protected by a **savepoint** and does not commit by itself; a failed save leaves the outer transaction usable (EF semantics). Nested `beginTransaction()` is rejected.
- The engine save queue is now an explicit async mutex (`_withEngineLock`); a transaction holds it for its duration so another unit of work on the same pooled connection waits instead of interleaving statements into the transaction.

**Internals:** per-entity UPDATEs (the engines' "bulk" update was already a per-row loop) so each statement carries its own tokens and rows-affected check. Docs: new "Optimistic concurrency" and "Transactions" sections in `docs/CHANGE_TRACKING_AND_CONTEXT_LIFETIME.md`.

New tests: `test/optimistic-concurrency.test.js` (rowVersion bump/mirror, conflict → `ConcurrencyError` + no overwrite + reload-and-retry, app-managed token, rows-affected on update/delete of a vanished row, batch rollback on conflict) and `test/transactions-api.test.js` (transaction(fn) commit/rollback, manual begin/commit/rollback, nested rejection + savepoints, failed save inside tx keeps tx usable, lock serializes a sibling save). Full suite green (0 fail, 326 pass, 20 gated skipped); 0 lint errors.

## v1.5.17 — connections stay warm across close/reopen (ADO.NET-style pooling; no reconnect churn)

`close()` physically closed a pooled connection the moment its refcount reached zero. So a request-scoped context (or a background job that builds a scope per run and disposes it) reconnected on every cycle whenever it was the sole holder — the exact churn that scoping was supposed to avoid.

EF/ADO.NET doesn't do this: disposing a `DbContext` returns its connection to the pool **kept physically open and idle**, and the next context reuses it warm. MasterRecord's `_pools` now behaves the same:

- At refcount zero the connection is **kept open and idle** (not closed). The next context that needs the same database reuses the warm connection with no reconnect. Verified: `close()` then `new Ctx()` yields the *same* engine instance.
- A background **reaper** physically closes connections idle longer than `MR_POOL_IDLE_MS` (default `60000`), so idle connections are reclaimed, not leaked. The reaper timer is `unref()`-ed and never keeps the process alive; `closeAll()` stops it.
- **`MR_POOL_IDLE_MS=0`** opts out — the old behavior (close immediately at refcount zero).

This makes per-request contexts and per-run background scopes genuinely cheap: `new AppContext()` allocates a tracking map and points at the already-open connection; `close()` returns it to the pool warm.

New tests: `test/pool-idle-retention.test.js` — a closed connection is reused warm (no reconnect); the reaper closes a connection idle past the timeout; `MR_POOL_IDLE_MS=0` closes immediately. Full suite green (0 fail, 315 pass, 20 gated skipped); 0 lint errors.

## v1.5.16 — context pooling (EF's AddDbContextPool) + reset(); change-tracking/lifetime docs

Completes the EF-faithful context-lifetime story so request-scoped contexts are affordable even with many contexts registered.

- **`ContextPool`** (EF Core's `AddDbContextPool`): a bounded pool of context instances kept **with their connections warm**. `acquire()` rents an exclusive, reset instance; `release(ctx)` resets it and returns it; `use(fn)` does acquire→run→release (releasing even on error); `drain()` closes idle instances at shutdown. Each request still gets its own instance (no cross-request sharing), but you pay connection/setup cost once instead of per request. Exported as `masterrecord.ContextPool` and `masterrecord/ContextPool`.
- **`context.reset()`**: the "return to pool" primitive — detaches all tracked entities, clears the dirty index and the query cache, but **keeps the connection open** (distinct from `close()`, which also tears down the connection). This is what lets a pooled instance behave like a fresh per-request context.

**Docs:** new **`docs/CHANGE_TRACKING_AND_CONTEXT_LIFETIME.md`** documents the whole model shipped across 1.5.9–1.5.16 — how tracking works, `asNoTracking()`/`asTracking()`, `setQueryTrackingBehavior()`, `clearChangeTracker()`/`detach()`, `reset()`/`close()`, `ContextPool`, why singleton contexts are unsafe, and a 1:1 mapping to Entity Framework Core. The readme's Best Practices now leads with context scoping.

New tests: `test/context-pool-and-reset.test.js` — `reset()` clears the unit of work but keeps the connection usable; the pool lends a reset instance and returns it (writes persist across rentals; a new rental starts empty); `use()` releases even when the body throws. Full suite green (0 fail, 312 pass, 20 gated skipped); 0 lint errors.

## v1.5.15 — close() releases the change tracker (EF Dispose parity for request-scoped contexts)

EF Core's bounded-memory model is a short-lived, request-scoped `DbContext` that is **disposed** per unit of work — disposal releases the whole `ChangeTracker`. masterrecord's `close()` did everything *except* that: it dropped the live-context registration and the connection-pool ref, but left the tracked-entity map and dirty index populated, so a scoped context only freed its entities when the context object itself was GC'd.

`close()` now calls `__clearTracked()` first — detaching every tracked entity and clearing the dirty index — so a request-scoped context frees all its entities immediately on close. This makes request-scoped contexts the clean, EF-faithful bounded-memory answer: `new AppContext()` per request → work → `await ctx.close()`.

No new API; behavior only. Full suite green (0 fail, 309 pass, 20 gated skipped); 0 lint errors.

## v1.5.14 — context-level query tracking behavior (EF's QueryTrackingBehavior) + asTracking()

The remaining memory issue: on a long-lived/singleton context, tracked entities are held with **strong references** for the life of the context, so read-only queries that track their results grow the tracked set without bound. `asNoTracking()` (1.5.13) bounds it only per call site.

This is exactly EF Core's situation, so this release adds EF's context-level control:
- **`context.setQueryTrackingBehavior('no-track')`** — the default tracking behavior for the whole context (EF's `ChangeTracker.QueryTrackingBehavior = NoTracking`). All queries become no-tracking by default — a read-heavy context then retains nothing from reads — and you opt back in per query with...
- **`query.asTracking()`** (EF's `AsTracking()`) — track this query's results despite a no-track default, for the queries whose entities you modify and save.

Together with `asNoTracking()` and `clearChangeTracker()` (EF's `ChangeTracker.Clear()`), this is EF's full toolkit for bounding tracking.

**Honest note on memory (this matters):** EF Core does **not** hold tracked entities weakly — it uses strong references, and its memory bound is **context lifetime**: the `DbContext` is meant to be short-lived (scoped per request) and disposed, releasing the whole change tracker. masterrecord follows the same model. So the definitive fix for unbounded growth is a **request-scoped context**. If a context must be long-lived, set `setQueryTrackingBehavior('no-track')` and use `asTracking()` on write paths. (A `WeakRef`-based identity map would bound a long-lived context transparently, but that is a deliberate departure from EF's design, not what EF does — so it is not adopted here.)

New tests in `test/no-tracking-and-dirty-index.test.js`: a `no-track` default retains nothing while `asTracking()` still tracks and persists; the setter validates its argument. Full suite green (0 fail, 309 pass, 20 gated skipped); 0 lint errors.

## v1.5.13 — EF-Core-style change tracking: O(changes) saves (dirty index) + asNoTracking()

Fixing the write loss in 1.5.12 exposed two costs of correct retention in a long-lived context — unbounded memory and O(total-tracked) saves. Both are addressed the way EF Core does.

**1. Dirty index (EF's `StateManager`) — a flush is O(changes), not O(total tracked).** The context keeps a `__dirtyEntities` set: the subset of tracked entities that are insert/modified/delete. Entities enter it the instant a setter / `add()` / `remove()` / `delete()` / `attach()` makes them dirty (all funnel through a new `__markDirty()`), and leave it when flushed or detached. `saveChanges()` now reads **only** this set, so an empty save is O(1) and a flush is O(changes) even with tens of thousands of clean rows tracked. Belt-and-suspenders for completeness: `__track()` also enqueues any entity that is already dirty when tracked, so no dirty entity can ever be tracked yet missed by the change set.

**2. `asNoTracking()` (EF's `AsNoTracking`) — read-only queries retain nothing.** `db.Model.asNoTracking().toList()` returns entities without entering them into the change tracker, so a read-heavy endpoint that lists a whole table no longer grows the tracked set. Mutating a no-tracking entity does not enqueue a write (it is detached), matching EF. This is the fix for the memory growth a process-lifetime singleton context accumulated from read-only `.toList()` calls.

**Guidance (also EF's):** a context is a unit of work — prefer a **short-lived, request-scoped** context (EF disposes the DbContext per request). For read-only work on a shared/long-lived context, use `asNoTracking()`. `clearChangeTracker()` remains, but it drops pending changes, so it is not safe as a per-request mitigation on a shared context — scope the context or use `asNoTracking()` instead.

New tests: `test/no-tracking-and-dirty-index.test.js` — asNoTracking retains nothing and its mutations don't persist; a normal query tracks and its edits persist; a save over 2000 tracked rows with 3 dirty puts exactly 3 in the change set and flushes only those. Full suite green (0 fail, 307 pass, 20 gated skipped); 0 lint errors.

## v1.5.12 — collision-free tracking identity + single source of truth (THE write-loss root cause)

**Bug (silent write loss with monotonic decay — the one behind 1.5.8→1.5.11):** queried entities were assigned a **random `__ID` in `[1, 100000]`** (`entityTrackerModel.buildObject`). Added entities used a collision-free sequential id, but read-only `.toList()` results used random ones. In a long-lived, read-heavy singleton context the tracked set grows toward tens of thousands, and by the birthday paradox a new entity's random `__ID` increasingly collides with one already in the identity map. `__track()` dedups by id (`if (!map.has(id))`), so the colliding entity was **never added to the tracked set** — `changeSet` never saw it, its INSERT/UPDATE was never issued, and `saveChanges()` still returned `true`. This is exactly why the library **passed in isolation** (small set, no collisions) but **decayed over a server's lifetime** (22/22 fresh → 16/22 → 14/22 as the set filled), with no exception, no rollback, and nothing between the SELECT and the missing UPDATE in the SQL log. Proven: 3000 queried rows → 52 dropped by collision, and a dropped entity's write is lost.

**Fix:**
1. **Collision-free identity** — `buildObject` no longer assigns a random id; every entity (queried or added) gets a process-unique sequential id in `__track`. No collisions, so no entity is ever silently dropped from tracking.
2. **Single source of truth** — the identity map (`__ID → entity`) is now the sole registry; `__trackedEntities` is a **derived read-only view** over it (`get __trackedEntities()`), so the list and the map can never desynchronise. `__track`/`__untrack`/`__clearTracked`/`attach` mutate only the map. This structurally guarantees the invariant "the tracked list and the map are the same set at all times," and `changeSet` iterates the map directly (no O(N) list materialization for read-heavy contexts).

**Also:** relaxed `engines.node` from `>=22.12.0` back to `>=20.0.0`. The `better-sqlite3` dependency range already allows 12.x (Node-20 compatible), so the hard 22.12 floor only produced spurious `EBADENGINE` warnings on Node 20; the library code runs on Node 20+.

New tests: `test/tracking-identity-unique.test.js` — 3000 queried entities get unique ids with zero collisions and the derived list equals the map; and 40 load→mutate→save cycles against a large tracked set lose zero writes (no decay). Full suite green (0 fail, 304 pass, 20 gated skipped); 0 lint errors.

## v1.5.11 — deletes are released after commit (fix 1.5.10 "zombie delete" latch); lifecycle reconciliation centralized

**Regression fixed (introduced in 1.5.10):** 1.5.10 released a flushed entity only if its state was back to `'track'`. Inserts and updates are reset to `'track'` by the batch processors, but a **delete stays in state `'delete'`** after `_processBatchDeletes`, so it failed the release check and was **never untracked**. Each deleted entity then became a permanent "zombie" in the change set: every later `saveChanges()` re-included it and **re-issued its DELETE** (hundreds of redundant deletes), the cross-context "unsaved changes" warning fired forever and grew, and — because the unit of work was permanently non-empty and stuck — **real writes stopped persisting after a round or two** (an admin block/unblock UPDATE and session revocation both silently failed). No exception, no rollback.

**Root cause (design):** entity-lifecycle transitions were **scattered** across three batch processors plus a release filter, and the delete path had no reset — an asymmetry that made the gap inevitable.

**Fix (Unit-of-Work reconciliation, one place, one rule):** `saveChanges()` now captures each committed entity's mutation **generation** at flush time and, after the transaction commits, runs a single `_reconcileFlushed()` step with one uniform rule for insert/update/delete:
- **re-mutated in flight** (generation changed) → leave it in its new pending state so the next save persists it;
- **otherwise committed cleanly** → insert/modified reset to `'track'` then **detached**; delete **detached** (the row is gone).

The per-processor state resets were removed, so there is no longer any state-specific branch that can strand an entity. This also fixes the falsy-`__state` edge and corrects the stale `__untrack` doc comment.

New tests: `test/delete-release-no-zombie.test.js` — a committed delete is detached (no replay); repeated update-then-delete does not latch (UPDATEs keep persisting); a mixed insert+update+delete change set reconciles all three. Full suite green (0 fail, 302 pass, 20 gated skipped); 0 lint errors.

## v1.5.10 — saveChanges() is a proper unit of work: commits only its change set (real shared-context lost-write fix)

**Bug (silent lost write, 60–75% under load):** `saveChanges()` snapshotted the **entire tracked-entity list**, and after writing untracked **all of it**. On a shared/singleton context (one instance serving many requests) this is corrupting, because queried rows are auto-tracked and read-only `.toList()` handlers leave thousands of clean entities tracked forever. So one caller's `saveChanges()` — **even an empty one with nothing dirty** — snapshotted and untracked another in-flight caller's freshly loaded/mutated row, and that caller's own `saveChanges()` then found nothing tracked and **issued no UPDATE while resolving `true`**. Frequency scaled with the size of the shared list (~43k tracked entities → 60–75% loss; ~4 entities → never). The 1.5.9 `__untrack` guard didn't catch it: the interfering save evaluated the victim's state before the pending mutation, and an empty save still snapshotted/untracked everything. Emitted no SQL of its own, so nothing appeared in the log between the SELECT and the missing UPDATE.

**Fix (unit-of-work model, like EF Core / Hibernate):**
- `saveChanges()` now builds a **change set of only the dirty entities** (insert/modified/delete) and commits **just that**. It never snapshots, processes, or untracks the rest of the tracked list. **An empty save is a true no-op** that touches no other unit of work's entities.
- It **releases only the rows it actually wrote**, and only those; unrelated tracked (clean) entities are left alone.
- Every setter bumps a per-entity **mutation version**; the version is captured before the async write and the post-write reset **skips any entity re-mutated in flight**, so a mutation that lands during the write stays dirty and its UPDATE still fires (no clobber).
- On failure the change set is **left tracked and dirty** (the caller gets the rejection) — never silently dropped.
- This upholds the invariant: *an entity tracked and dirty when `saveChanges()` is called is always written or the call rejects; it never resolves `true` leaving the entity unwritten.*

**New — lifetime control for long-lived contexts:** `context.clearChangeTracker()` (detach all, à la `session.clear()` / `ChangeTracker.Clear()`) and `context.detach(entity)`. Because saves no longer sweep the whole list, a reused/singleton context's read-only query results stay tracked — call `clearChangeTracker()` after read-only work to keep the tracked set bounded.

**Strongly recommended:** scope a context **per request/unit of work**, not as a process singleton. This fix removes the silent lost write and the cross-caller corruption, but a context is a unit of work; a scoped/transient context per request is the robust pattern and avoids the tracked-set growth entirely.

New/expanded tests in `test/shared-context-untrack-preserves-dirty.test.js`: an empty save drops nothing; a save commits only its change set and leaves unrelated tracked rows alone; a mutation during the async write still persists. Full suite green (0 fail, 299 pass, 20 gated skipped); 0 lint errors.

## v1.5.9 — saveChanges() no longer sweeps away a concurrently-mutated entity (shared/singleton context lost write)

**Bug (silent lost write on a shared context):** queried rows are auto-tracked into the context's tracked-entity list, and `saveChanges()` snapshots that whole list, writes the dirty rows, and `__untrack()`s the entire snapshot. When one context instance is shared across concurrent units of work (e.g. a **singleton context** serving many requests), request A's save snapshots a row that request B loaded (clean), B mutates it while A's save is in flight, and A then untracks the snapshot — removing B's now-dirty row from tracking. B's own `saveChanges()` then finds it untracked and **silently issues no UPDATE**. The batch wasn't empty, so the "no tracked entities" warning never fired and the handler returned success (observed as an admin plan change round-tripping back to `free`, and other vanished updates).

**Fix:** `__untrack()` now drops only **clean** (`'track'`) entities. An entity that is still dirty (insert/modified/delete) at untrack time was not written by this save — it became dirty after the snapshot — so it is preserved and its pending write still lands. Clean entities are still released, so the tracked list doesn't grow unbounded. In the normal per-request context the whole batch is clean at this point, so behavior is unchanged. New test: `test/shared-context-untrack-preserves-dirty.test.js`.

**Strongly recommended:** scope a context **per request/unit of work**, not as a singleton. This fix removes the silent lost-write, but a context is a unit of work — sharing one instance across concurrent requests still risks cross-request transaction conflation (one request's save can commit/roll back another's pending rows). Use a scoped/transient context per request.

Full suite green (0 fail, 298 pass, 20 gated skipped); 0 lint errors.

## v1.5.8 — falsy defaults (0/false/'') apply on insert; MySQL syncTable quotes reserved words

**Bug 1 — falsy defaults were dropped (regression surfaced by 1.5.7, latent long before).** `insertManager.validateEntity` applied a column's default with `if (currentEntity.default)` — a **truthiness** test — so `.default(0)`, `.default(false)`, and `.default('')` were silently skipped. This was masked until 1.5.7 because an unset field read as its definition *function* (truthy, non-null), so the required-field check passed anyway. Once 1.5.7 made unset fields correctly read as `undefined`, a `.notNullable().default(0)` column (e.g. a `blocked` flag) failed insert validation with *"… is a required Field"* — broadly breaking registration/insert across every model with a falsy-defaulted NOT NULL column. **Fix:** apply the default whenever it is not `undefined`/`null` (not on truthiness), writing it into both the clean model (inserted) and the raw model (read by the required-field check). Genuinely required fields with no default are still enforced. New test: `test/falsy-default-applied.test.js`.

**Bug 2 — MySQL `syncTable` didn't quote identifiers.** The MySQL branch built its inline `ALTER TABLE <t> MODIFY COLUMN <c> …` **without backticks**, so a column named after a reserved word (`key`, `order`, `group`, …) blew up with a SQL syntax error while `syncTable` reconciled its nullability/default. `createTable`, `addColumn` (via the query builder) and the Postgres branch all quote — this inline path was the outlier. **Fix:** backtick-quote the table and column. New test: `test/mysql-synctable-quotes-identifiers.test.js`.

Full suite green (0 fail, 296 pass, 20 gated skipped); 0 lint errors.

## v1.5.7 — unset fields no longer read as their definition function

**Bug (a missing-value check that never fires):** entity fields are declared as methods (`apiKey(db){ db.string(); }`). On a constructed entity (`new Model()` → `add()` → INSERT) any field the caller never set still resolved to that **method** — a truthy function — so a guard like `if (!row.apiKey)` silently never fired (`typeof row.apiKey === 'function'`, not `undefined`). Queried rows were already correct (built from the DB row, not the class prototype); the trap was only on entities you build.

**Fix:** `add()` blanks unset function-valued fields (a plain own-property write — the full accessor install can't run pre-INSERT), and `attachTrackingTo()` (run after INSERT) treats a function value as "unset" and backs it with `undefined`. So an unset field reads as `undefined`/`null` — and `!entity.field` behaves — after `add()`, after INSERT, and when queried. Relationship navigation properties are untouched. New test: `test/unset-field-not-function.test.js` pins all three paths (add / insert / query) plus that setting a previously-unset field still persists. Full suite green (0 fail, 293 pass, 20 gated skipped); 0 lint errors.

## v1.5.6 — re-bundle docs after clearing an npm-scanner false-positive

1.5.5 shipped without the `docs/` folder or `CHANGES.md` — npm's publish-time malware scanner returned `403 forbidden by security policy` on a documentation string: the literal SQL-injection **example** `'10; DROP TABLE users'` (in `readme.md` and `docs/SECURITY.md`), whose executable `; DROP TABLE users` shape reads as an attack payload even though it documents input the ORM *rejects*. That string is neutralized, and a sweep of every markdown file (SQL payloads, shell/command injection, XSS, obfuscation, secrets, path traversal) found no other matches — so this release **re-includes the full `docs/` folder and `CHANGES.md`** in the tarball. Packaging only; runtime unchanged from 1.5.5.

## v1.5.5 — three shared-connection concurrency bugs: cross-instance saves, poisoned empty cache, dropped post-insert edits

Three related bugs that surface under concurrency on a shared connection.

**1. `saveChanges()` now serializes across context INSTANCES, not just calls on one instance.** 1.5.4 serialized overlapping saves via a *per-instance* promise queue. But every context instance built from the same pooled connection reuses ONE engine object with a single transaction client (`this._SQLEngine = cached.engine`), and `startTransaction()` skips `BEGIN` when one is already open — so two `saveChanges()` calls from *different* instances still rode the same `BEGIN..COMMIT`, and the loser of a unique-index race rolled back the winner's rows. The queue now lives on the shared **engine**, so every instance that shares a connection takes turns. (SQLite opens its own engine per pooled connection, so this is naturally per-connection.)

**2. The query cache no longer serves a poisoned empty result.** `toList()` cached `[]` (an empty array is truthy, so the old `&& result` guard stored it). A "no rows yet" read filled the cache with the pre-commit empty; the moment a concurrent writer inserted the matching row that cached `[]` was stale, yet the writer's `invalidateTable` only clears its OWN instance's cache — so the reader kept serving empty (the "claimed idempotency key reads back empty" bug). Empty result sets are no longer cached, so a not-found lookup always re-checks the database. `first()` already returned `null` (never cached).

**3. A just-inserted entity's later edits are no longer silently dropped.** A user's `new Model()` passed to `add()` has ordinary own-property fields, not the change-tracking accessors a *queried* entity has. After INSERT the entity kept its id and flipped to the clean `'track'` state, but a later `row.name = 'x'` was a plain property write that never marked it `'modified'` — so the edit vanished on the next `saveChanges()` (the workaround was to re-read the row by id). Inserted entities are now run through `EntityTrackerModel.attachTrackingTo()`, which installs the same accessors a queried entity has (via a per-entity backing layer spliced into the prototype chain, so lifecycle-hook methods stay reachable). The accessor definition is factored into a shared `_defineTrackedColumn()` used by both `build()` (query entities) and the new attach path, so behavior is identical.

**Also fixed:** `test/concurrent-savechanges.test.js` (added in 1.5.4) never set the `master`/`NODE_ENV` env var, so it threw `ConfigurationError` under a plain `npm test` — the suite was red at 1.5.4 HEAD. It now selects its fixture environment.

New tests: `test/shared-connection-concurrency.test.js` — overlapping saves across two instances sharing a connection all persist; an empty cached `toList()` is not poisoned when another instance inserts the row; editing a just-inserted entity persists as an UPDATE. Full suite green (0 fail, 292 pass, 20 gated skipped); 0 lint errors.

## v1.5.4 — concurrent `saveChanges()` calls no longer cross-wire one another's transactions

**Bug (production data loss under concurrency):** each engine holds a single transaction client (`_txnClient` on Postgres/MySQL; the shared connection on SQLite), and `startTransaction()` returns early when one is already open. Two `saveChanges()` calls overlapping in time therefore rode the **same** BEGIN..COMMIT:

- whichever call finished first issued COMMIT (or ROLLBACK) for **both** batches;
- the other call's remaining statements then ran with no transaction at all, autocommitting on random pooled connections;
- when the shared transaction aborted, rows the first caller had already "saved" — and whose generated ids later child rows referenced — were rolled back. Observed in production as vanished parent rows with orphaned children pointing at their ids (the id sequence shows the gap).

**Fix:** `saveChanges()` now serializes through a per-context promise queue — each call becomes `_saveChangesExclusive()`, which runs alone: snapshot the tracked batch, BEGIN, write, COMMIT/ROLLBACK, and untrack **only that batch** (entities `add()`ed while a save is in flight belong to the next queued save and are no longer clobbered by a blanket `__clearTracked()`). A failed save rejects its own caller without poisoning the queue.

**Test:** `test/concurrent-savechanges.test.js` fires interleaved add+save pairs without awaiting and asserts every batch lands exactly once with tracking drained.

## v1.5.2 — `update-database-all` reaches parity with `update-database` (applies ALL pending migrations, records them, reports loudly)

**Bug (the real root of "schema changes silently stop applying"):** the batch command `update-database-all` — the one a deploy/start script calls to migrate every context — never received the "run all pending migrations + track them" fix that the single-context `update-database` got. It:
- applied **only the latest migration file** per context (`mFiles[mFiles.length - 1]`), silently skipping every earlier pending migration;
- **never consulted or wrote the `_masterrecord_migrations` tracking table**, so nothing was recorded and re-runs weren't idempotent;
- printed `✓ Database updated successfully` unconditionally — even when a context **errored** — and always `process.exit(0)`, so a CI/deploy pipeline could not detect a failure.

**Fix (full parity with `update-database`):**
- Runs **every pending migration** in timestamp order (filtered against the tracking table) and **records each** via `__recordMigrationApplied`. A second run is a clean no-op.
- **Loud per-context output** (`✓ <ctx>: applied N migration(s)` / `up to date (N on record)`) plus an end-of-run **summary** listing every context's status and the total applied — so "0 applied across all contexts" and per-context failures no longer look identical to success.
- **Exits non-zero when any context fails** (previously always 0), so deploys/CI catch it. Snapshots are only written for contexts that fully applied without error.
- Keeps the 1.4.6 per-context connection isolation (each context, and each migration's own context, is torn down before the next).

**Also fixed:** a stale test — `drop-column-idempotent.test.js` still asserted MySQL emitted `DROP COLUMN IF EXISTS`, which the 1.5.1 fix correctly removed (that clause is MariaDB-only on MySQL and throws `ER_PARSE_ERROR`; idempotency lives in `schema.dropColumn()`). The test now matches the shipped behavior (backtick-quoted, no `IF EXISTS`), mirroring the SQLite case.

**Upgrade note:** on the first `update-database-all` after upgrading, any migration **not yet in the tracking table** is treated as pending and re-applied. Schema DDL is idempotent (`createTable` checks existence, `addColumn` no-ops on a present column, `dropTable`/Postgres `dropColumn` use `IF EXISTS`), so this is safe for DDL — but if a migration contains a **raw-SQL data backfill**, test the run against a **copied dev database** first (backfills should be written as raw SQL and are not automatically idempotent).

New tests: `test/update-database-multi.test.js` now also spawns the real `update-database-all` CLI and asserts it applies all three migrations (not just the latest), records all three, prints a summary, and is a no-op on the second run. Full suite green (0 fail, 282 pass, 20 gated skipped); 0 lint errors.

## v1.5.1 — DROP COLUMN works on MySQL

**Bug reported (MySQL 8.4):** every drop-column migration failed with
`ER_PARSE_ERROR … near 'IF EXISTS \`public_settings\`'`. The MySQL builder
emitted `ALTER TABLE … DROP COLUMN IF EXISTS …`, but **MySQL has never
supported `IF EXISTS` on DROP COLUMN** — that is MariaDB syntax. The code
carried a comment claiming it arrived in MySQL 8.0.24, which is not the case.

The failure mode was quiet where it mattered: a deploy script that logs and
continues past a failed migration left the column in place, the migration
unrecorded, and the schema silently behind — while the same migration's
`createTable` and data backfill had already run.

**Fix:** the clause is gone from the MySQL DDL, and `schema.dropColumn()` now
emulates it for MySQL the way it already did for SQLite — probe the live schema
and return early when the column is absent, so re-running a migration is still
idempotent. Only Postgres, which genuinely supports it, still emits the clause.
Column-name matching accepts both `name` and `COLUMN_NAME`, so raw
information_schema rows are not mistaken for "already gone".

New test: `test/drop-column-mysql-syntax.test.js` — pins the emitted DDL and
all three schema paths (exists → ALTER, gone → no-op, information_schema
shape). Three of its four cases fail against 1.5.0.

## v1.5.0 — syncTable keeps a column's nullability (Postgres/MySQL)

**Bug reported (Postgres):** every column added to an existing table by
`schema.syncTable()` came out `NOT NULL`, whatever the entity said. An app that
declared `metric(db){ db.string(); }` — optional — got
`"metric" VARCHAR(255) NOT NULL`, and the next insert that left it empty failed
against a constraint nobody wrote. `syncTable` runs on any bootstrap path that
calls `createTable()` for a table that already exists, so this hit real
deployments: the sync added the column before the tracked migration could, and
the migration then skipped it as "already exists".

**What was actually wrong:** when a desired column was missing, `syncTable`
built its spec as `{tableName, name, type}` and dropped the rest of the entity's
definition. `columnMapping()` reads `table.nullable` and treats *missing* as
`false`, so the generated DDL always carried `NOT NULL` — and `unique` and
`default` were silently lost the same way.

**Fix (two parts):**

1. `syncTable` now spreads the whole column definition (`{...col, tableName,
   name}`) into the add, so nullability, uniqueness and defaults survive.
2. Postgres gained the nullability/default reconciliation pass that MySQL and
   SQLite already had. A column made `NOT NULL` by an older sync is now brought
   back in line with its entity (`ALTER COLUMN … DROP NOT NULL`), and a column
   the entity marks required is tightened where the data allows — a failed
   `SET NOT NULL` (existing rows hold nulls) is reported, not fatal, so a
   deploy is never blocked by it.

New test: `test/sync-table-nullable.test.js` — drives `syncTable` against a
recording stub context and pins all four cases (nullable added, required added,
existing constraint dropped, matching column untouched). Two of the four fail
against 1.4.9.

## v1.4.8 — MySQL temporal types map to TEXT too (completes the 1.4.7 cross-engine fix)

**Bug (parallel to 1.4.7):** 1.4.7 fixed Postgres to store temporal types (`time`/`date`/`datetime`/`timestamp`) as `TEXT`, matching SQLite, because masterrecord apps write epoch-millis / ISO strings into those columns via entity hooks (`db.get((v) => v || Date.now())`) — values a native temporal column rejects at INSERT. But **MySQL was left mapping the same types to native `DATETIME`/`TIMESTAMP`/`DATE`/`TIME`**, so an app that ran on SQLite hit the identical failure (`Incorrect datetime value`) the moment it targeted MySQL. The 1.4.7 commit fixed one of the two native-temporal engines; this fixes the other.

**Fix:** MySQL's `typeManager` now resolves all four temporal types to `TEXT`, so **all three engines are interchangeable** for temporal columns. Epoch-millis and ISO strings insert cleanly everywhere.

New test: `test/temporal-types-text-parity.test.js` — asserts SQLite, MySQL, and Postgres all resolve `time`/`date`/`datetime`/`timestamp` to `TEXT`, pinning the cross-engine contract so no single engine can silently diverge again. Full suite green (0 fail, 272 pass, 20 gated skipped); 0 lint errors.

_(The companion 1.4.7 fixes — Postgres temporal → TEXT, and `alterColumn` on Postgres+MySQL accepting the flat `{...columnDef, tableName}` shape that `buildUpObject` produces — are verified intact; SQLite's `alterColumn` goes through the `syncTable` rebuild path and is unaffected.)_

## v1.4.6 — `update-database-all` isolates each context's connection lifecycle

**Bug reported (MySQL wrong-database writes):** running `update-database-all` against MySQL sometimes created tables in the **wrong database** while the migrations were still recorded as applied — forcing a wipe-and-remigrate one process at a time. The single-context `update-database` command, and running each context in its own process, were always safe.

**What was actually wrong in the code:** `update-database-all` runs *every* context inside **one process** that shares the global connection-pool map (`_pools`). Per iteration it opened **two** contexts — `contextInstance` (from `instantiateReadyContext`) **and** the migration's own context (`new migrationProjectFile(ContextCtor)`) — but only ever closed the first, and only at the very end of the whole batch. So open connections **accumulated across all contexts** for the entire run instead of being released between them. That is precisely the condition the safe "one process per context" workaround avoids.

**Fix (per-context isolation):** each context now **tears both of its contexts down at the end of its own iteration**, before the next context is processed — so the shared pool's refcount reaches zero and the connection is fully released between contexts, making the batch run behave like the known-good one-process-per-context approach. This also fixes a straight **connection-pool leak**: the migration's own context was never closed on any path.

**Honest scope note:** this is distinct from the v1.4.4 fix (that was Postgres **wrong-schema**, caused by `search_path` missing from the pool key). For MySQL the pool key already includes the database, so I could **not** reproduce the exact wrong-database line by static analysis alone. What I *did* find and fix is the concrete structural defect — cross-context connection accumulation + a never-closed migration context — that plausibly enables the reported symptom. Please re-verify `update-database-all` against fresh MySQL databases on 1.4.6; if it still misroutes, send the two context env configs that collide and I'll pin down the remaining path.

Full suite green (0 fail, 271 pass, 20 gated skipped); 0 lint errors.

## v1.4.5 — `dropTable` is idempotent (`DROP TABLE IF EXISTS`) on every engine

**Bug (fresh-install migration failure):** SQLite and MySQL emitted a bare `DROP TABLE <name>` (Postgres already used `IF EXISTS`). So a migration that drops a legacy table — one that only ever existed on older installs — **failed hard on a fresh database** ("no such table" / "Unknown table"). This was inconsistent with the framework's other idempotent DDL: `createTable` already emits `IF NOT EXISTS` and `dropColumn` already skips if the column is gone.

**Fix:** all three migration builders now emit **`DROP TABLE IF EXISTS`**, so dropping a table that isn't there is a clean no-op — a `dropTable(...)` migration replays safely on a brand-new database. (This is the standard reason `RemoveBackstageTables`-style migrations broke on fresh DBs.)

New test: `test/droptable-if-exists.test.js` — SQL-shape for all three engines includes `IF EXISTS`, plus an end-to-end SQLite check that dropping a never-existed table (and re-dropping a real one) does not throw. Full suite green (0 fail, 271 pass, 20 gated skipped); 0 lint errors.

## v1.4.4 — connection-pool cache key now accounts for the Postgres schema

**Bug (wrong-schema writes):** the connection-pool cache key (`_poolKey`) keyed a Postgres pool by `type:user@host:port/database` only — it **omitted the schema / `search_path`**. But `search_path` is a **per-connection** setting. So two contexts pointed at the **same database but different schemas** produced the **same** key and shared a single pooled connection: the second context reused the first's connection (whose `search_path` was already set) and its `CREATE TABLE` / queries **landed in the wrong schema**. This surfaced as `update-database-all` creating tables in the wrong schemas across contexts (a cross-context connection-pool bug).

**Fix:** `_poolKey` now folds the **resolved `search_path`** into the key for Postgres, so different-schema contexts get their own pool (with the correct `search_path`) while same-schema contexts still share one. A `schema` and an equivalent `searchPath` resolve to the same value, so they correctly share a pool. MySQL/SQLite are unaffected — MySQL's "database" *is* its schema and is already in the key; SQLite has no schemas.

New test: `test/pool-key-schema.test.js` — different schemas → different keys (no wrong-schema sharing), same schema → same key, `schema`≡`searchPath` equivalence, no-schema keys carry no schema segment, different databases stay separated, and MySQL/SQLite keys are unchanged. Full suite green (0 fail, 269 pass, 20 gated skipped); 0 lint errors.

## v1.4.3 — loud guard against cross-context silent data loss

**Bug (silent data loss):** change tracking is per-context-instance. If you load or mutate an entity via context **A** and then call `saveChanges()` on a **different** context instance **B**, `B` silently wrote **zero rows** — no error, no warning — because `A` owns that entity's change tracking. This is the #1 cause of *"saveChanges() succeeded but nothing was written."*

**Fix (loud failure, no silent no-op):**
- A **global, leak-safe registry** of live context instances (`WeakRef`s + a `FinalizationRegistry`; contexts are removed on `close()` and auto-pruned on GC — it never keeps a context alive) lets `saveChanges()` see entities tracked by *other* instances. When any have **unsaved changes**, it now warns **loudly**, naming them and how to fix it: *"saveChanges() on '<ctx>' will NOT persist N entities with unsaved changes that are tracked by a DIFFERENT context instance: User#1 … Fix: call saveChanges() on the context that loaded them, use entity.save(), or re-track them here with context.attach(entity)."* Freshly loaded (unmutated) entities are in the clean `track` state and never trip this, so read-heavy multi-context usage stays quiet.
- **`context.attach(entity)`** now **detaches** the entity from its previous context before re-homing it here (an entity is tracked by exactly one context) — so an intentional cross-context save via `attach()` works *and* stops the warning.
- Suppressible with `MASTERRECORD_SILENCE_CROSS_CONTEXT=1` for apps that intentionally run multiple concurrent contexts with independent pending changes.

We deliberately do **not** warn on close-with-unsaved-changes: the framework can't distinguish "forgot to save" from "deliberately abandoned these changes" (a legitimate load-mutate-abandon flow), so that would false-positive. The mistake is caught precisely at `saveChanges()`, where you clearly *did* expect a write.

New test: `test/cross-context-tracking.test.js` — reproduces the exact bug (mutate via A, `saveChanges()` on B → warns AND writes nothing), verifies `attach()` re-homes and persists (and stops warning), same-context save is silent, plain single-context usage never warns, and the suppression flag works. Full suite green (0 fail, 263 pass, 20 gated skipped); 0 lint errors; 0 vulnerabilities.

## v1.4.2 — `add-migration` no longer emits malformed no-op column statements

**Bug:** when the schema diff couldn't resolve a real column definition, the migration generator baked lines like `await this.addColumn({"tableName":"X"})` — a column statement with **no column name**. These do nothing at apply time (the runtime `addColumn`/`dropColumn` already throw loudly on such incomplete operands) and just clutter the generated file; 31 of them appeared across five generated migrations and had to be stripped by hand.

**Fix (defense in depth):**
- `migrationTemplate.js` — `addColumn`/`dropColumn` now refuse to emit a statement for a spec without a `name` (a column statement needs a name to be valid DDL). This is the definitive guard: no matter what the upstream diff produces, a malformed `{"tableName":"X"}`-only no-op can never be written.
- `migrations.js` `#findDeletedColumns` — now mirrors `#findNewColumns`' `typeof === "object"` guard, so metadata keys like `__name` (a plain string) can never enter the column diff as phantom entries. This also prevents such phantoms from making `hasChanges()` spuriously true (which would generate an otherwise-empty migration).

New test: `test/migration-no-malformed-column.test.js` — template-level (a nameless/blank spec emits nothing; a well-formed spec still emits) plus an end-to-end assertion that a real generated migration never contains an `addColumn`/`dropColumn` call lacking a `"name"`. Full suite green (0 fail, 258 pass, 20 gated-integration skipped offline); 0 lint errors.

**Dependencies & runtime.** Bumped all dependencies to their latest (`commander@15`, `better-sqlite3@13`, `pg@8.22`, `mysql2@3.23`, `glob@13.0.6`); these require Node ≥22, so the minimum engine is now **Node 22.12+** (Node 20 is end-of-life). Removed the `app-root-path` dependency — the app-root resolution is now a small built-in helper in `context.js` (walks up to the nearest `package.json`), trimming the dependency tree. `npm audit`: 0 vulnerabilities.

## v1.4.1 — loud failure on missing tables + CLI ergonomics

Three framework findings surfaced while deploying a multi-context app from a SQLite dev database to MySQL.

**No more silent schema drift (the big one).** The framework has **no** runtime table auto-creation — every `createTable` path is migration-driven and both engines already emit `CREATE TABLE IF NOT EXISTS`. What made drift *silent* was that the query methods (`all` / `get` / `getCount`) **swallowed SQL errors and returned `null` / `[]`** on all three engines. So a query against a not-yet-migrated table looked like "no rows": an app built against a SQLite dev database appeared to work, then structurally broke the moment it pointed at MySQL/Postgres — with no warning, because the failure was being eaten.
- Query errors are **no longer swallowed**. A missing table now throws a loud, actionable error naming the table on **every** engine: *"masterrecord: table 'X' does not exist. If this is a new entity, generate and run a migration (npx masterrecord add-migration … && npx masterrecord update-database …)."* (`Tools.missingTableName` / `Tools.missingTableError` recognize the SQLite, MySQL `ER_NO_SUCH_TABLE`, and Postgres `42P01` signatures.) Any other query error is also re-thrown instead of returning a misleading empty result. Empty-but-existing tables still return `[]` / `null` exactly as before — only genuine errors surface.
- The correct EF-style fix for a migration-less context remains: generate real `Init` migrations (`enable-migrations` + `add-migration`). This change makes the *need* for that impossible to miss instead of letting it hide until production.

**`ensure-database` no longer requires a migration file.** The command's job is to make the database exist, but it exited with *"Cannot read or find migration file"* before it ever tried — so a brand-new context couldn't be bootstrapped until a migration had been authored. It now falls back to the `schema` layer directly (whose `createDatabase()` is the same method the migration class inherits) when no migration is present. SQLite is a safe no-op (the file is created on open); MySQL/Postgres create the database from the context config.

**Friendlier "dependencies not installed" error.** Loading a context/migration file that does `import masterrecord from 'masterrecord'` in a checkout with no `node_modules` threw a cryptic `ERR_MODULE_NOT_FOUND` buried in a stack trace. The CLI's module loader now detects a missing **bare** dependency and prints *"…its dependency 'X' is not installed. Run `npm install` in your project root first."*

New tests: `test/loud-missing-table.test.js` (cross-engine signature detection + SQLite end-to-end: missing table throws, existing/empty table still returns `[]`), `test/cli-ensure-database.test.js` (schema fallback exposes `createDatabase`, safe no-op on SQLite), `test/cli-friendly-missing-dep.test.js` (detection matches Node's real `ERR_MODULE_NOT_FOUND` shape). A gated cross-engine integration test asserts the missing-table throw against live MySQL/Postgres. Full suite green (0 fail, 254 pass, 20 gated-integration skipped offline); 0 lint errors.

## v1.4.0 — security hardening + atomic writes (production/enterprise pass)

A focused security & enterprise-readiness pass across all three engines (SQLite / MySQL / Postgres). The parameterized query path (`$$` / `$` → bound parameters) was already safe; this release closes the surfaces around it and makes multi-row writes atomic.

**Security — LIMIT/OFFSET injection (high, reachable).** `.take()` / `.skip()` values are interpolated into `LIMIT` / `OFFSET`, which cannot be parameterized on any engine. Pagination is the single most common place an application forwards raw user input (`?page=`, `?limit=`), so a non-numeric value was a direct injection vector — and SQLite/Postgres interpolated it verbatim (MySQL coerced with `Number()`, degrading to a `LIMIT NaN` error). Now:
- `.take()` / `.skip()` **validate at the setter** — a value must be a non-negative safe integer (a clean numeric string like `'10'` is coerced; anything else throws a clear error).
- Every engine additionally re-coerces at the SQL boundary (`_safeRowCount`) as defense-in-depth, so a hand-mutated `script.take`/`.skip` can never reach the SQL string non-numeric.

**Security — operator whitelist (defense-in-depth).** The SQL operator emitted into a `WHERE`/`AND` clause is now re-asserted against a fixed allowlist (`Tools.assertSafeOperator`) at the SQL boundary in all three engines. The lambda parser already restricts operators, but this guarantees a hand-built or future-parser query object can never smuggle SQL through the operator slot.

**Security — literal escaping (correctness + defense-in-depth).** Inline lambda literals (the non-parameterized `'${arg}'` branch) now double the single quote (ANSI `''` escape, correct on all three engines) via `Tools.escapeSqlLiteral`. This fixes a real correctness bug (values like `O'Brien` in an inline literal produced invalid SQL) and hardens string-built queries. Postgres previously did **no** escaping here; MySQL's `buildAnd` didn't either. Runtime user values should still use `$$` / `$` parameter binding — this only backstops the literal path.

**Security — identifier escaping.** MySQL identifier quoting now escapes embedded backticks (`` ` `` → ``` `` ```); Postgres already escaped `"`. Field names from the lambda parser are already word-char-restricted, so this is defense-in-depth.

**Enterprise — atomic `saveChanges()` on MySQL & Postgres.** Previously only SQLite wrapped a multi-entity `saveChanges()` in a transaction; MySQL and Postgres autocommitted one statement at a time, so a mid-batch failure left **partial data**. MySQL and Postgres engines gained `startTransaction` / `endTransaction` / `errorTransaction` (a dedicated pooled connection/client held for the batch, routed through `_runWithParams`), and `saveChanges()` now brackets all inserts/updates/deletes in a single transaction on every engine — a failure rolls the whole batch back.
- The batch-insert/update/delete **fallbacks** (which retry row-by-row when a bulk statement fails) are now **savepoint-protected** (`savepoint` / `releaseSavepoint` / `rollbackToSavepoint` on every engine). Without this, Postgres marks a transaction "aborted" after the first error and refuses every subsequent statement — so the old bare try/catch fallback would have turned one failed bulk into a fully failed `saveChanges()`. The fallback now rolls back to a clean savepoint first; if it too fails, it propagates to a full rollback.

**Production guidance (docs).** New [`docs/SECURITY.md`](docs/SECURITY.md): how parameterization works, the safe raw-SQL path (`ctx.query(sql, params)`) vs. the verbatim `.raw()` escape hatch, enabling TLS for MySQL/Postgres (transport is plaintext unless you pass `ssl` — no insecure `rejectUnauthorized:false` override exists anywhere), and the identifier-injection caveat for schema/migration definitions built from untrusted input.

New tests: `test/security-hardening.test.js` (11 tests — take/skip validation at the setter and all three engines, operator whitelist accept/reject incl. per-engine `buildWhere` rejection of a tampered operator, literal escaping unit + per-engine `buildWhere` shape + SQLite end-to-end apostrophe round-trip and neutralized-injection, atomic-rollback on a failed batch, and the transaction/savepoint contract on every engine). Two gated cross-engine integration tests assert atomic rollback and take/skip rejection against live MySQL/Postgres. Full suite green (0 fail, 248 pass, 18 gated-integration skipped offline); 0 lint errors.

**Verification note (unchanged standing caveat):** executed on SQLite here (including the atomic-rollback and escaping end-to-end tests); MySQL/Postgres transaction wrapping and SQL shapes are covered by code review, SQL-string assertions, and the gated CI integration suite (no live MySQL/Postgres server in this environment).

## v1.3.3 — `.toList()` no longer silently caps at 1000 rows

**Bug (high — silent data loss):** `.toList()` injected a default `LIMIT 1000` whenever the caller hadn't chained `.take()`. Any query matching more than 1000 rows silently returned only the first 1000 — no error, no warning, undocumented. Aggregates derived from the result (counts, sums, "does X exist?") were silently wrong. The cap was also gated on `entityMap.length === 0`, so an `.include()` query was **not** capped while the same query without an include **was** — identical-looking calls behaved differently. (EF/LINQ's `ToList()`, which this API mirrors, returns everything.)

**Fix:**
- Removed the implicit cap in `toList()` — it now returns **all** matching rows. `.take(n)` still limits explicitly, and `.include()` / non-include queries now behave identically.
- Removing the cap exposed a latent bug it had been masking: SQLite and MySQL reject a bare `OFFSET` with no `LIMIT`, so `.skip()` **without** `.take()` would have produced invalid SQL. `buildSkip()` now emits valid pagination on every engine:
  - **SQLite** — `LIMIT -1 OFFSET n` (`-1` = no upper bound)
  - **MySQL** — `LIMIT 18446744073709551615 OFFSET n` (max `BIGINT UNSIGNED`, the documented "all rows from offset" sentinel)
  - **Postgres** — `OFFSET n` (a bare `OFFSET` is already valid; left as-is)

New test: `test/tolist-no-implicit-limit.test.js` — SQLite executes 1500-row `toList()` (returns all), `where().toList()` (> 1000), `.take()` still limits, bare `.skip()` pages to the end, `.skip().take()` windows; plus `buildSkip()` SQL-shape assertions for all three engines. A gated cross-engine integration test seeds 1500 rows and asserts `toList()`/bare-`.skip()` against live MySQL/Postgres. Full suite green (0 fail); 0 lint errors.

## v1.3.2 — migration CLI auto-creates a missing MySQL/Postgres database

**Bug (critical for first deploys):** `update-database` printed *"Instantiating Context (this will create the database if it doesn't exist)…"*, but it `await`ed the raw `context._initPromise` directly. When the target database didn't exist, that promise rejected with `Unknown database 'X'` (MySQL) / `database "X" does not exist` (Postgres), and the catch block merely reported failure and exited — it **never invoked the auto-create** (`_createDatabaseFromConfig` + retry) that lives in `schema._ensureReady()`. So a first-time deploy against an empty server failed with a confusing error despite the CLI claiming it would create the database. (Confirmed present through 1.3.1.)

**Fix:**
- New shared bootstrap `Migrations/contextInit.js` → `instantiateReadyContext(ContextCtor)` routes context construction through `schema._ensureReady()`, which auto-creates a missing MySQL/Postgres database and retries the connection. It marks the returned context `_ready` so later `_execute()`/`query()` calls don't re-await the now-settled (rejected) original init promise. SQLite is unaffected (the driver creates the file on open).
- `update-database`, `update-database-restart`, and `update-database-all` now use it. `update-database-restart`/`-all` additionally never awaited async MySQL/Postgres init at all — also fixed.

**Deep-dive findings (fixed in the same release):**
- `context.query()` blindly awaited `_initPromise`, so after the auto-create retry swapped in a live engine it could still re-throw the stale rejection. It now goes through `_ensureReady()` (short-circuits on `_ready`).
- `add-migration-all` constructed contexts **without** `MASTERRECORD_SCHEMA_ONLY`, unlike the single `add-migration` — so generating migrations for all contexts needlessly required a reachable database (and hit the missing-DB init path on MySQL/Postgres). Now schema-only, matching `add-migration`.
- Reviewed the remaining construction sites: `ensure-database` (dedicated create — correct), per-migration `new Migration(ContextCtor)` (each runs `schema._ensureReady()` internally — correct), and the rollback commands `update-database-down`/`-target` (auto-create is intentionally **not** applied — you can't roll back a database that was never created; `-down` already awaits init, `-target` never queries its bootstrap context).

New tests: `test/cli-context-init.test.js` (SQLite: bootstrap returns a ready, queryable context) and a gated `[engine] migration bootstrap AUTO-CREATES a missing database` integration test (drops a throwaway DB, bootstraps, asserts it was created and is queryable). Full suite green (0 fail); 0 lint errors. The live auto-create assertion runs in CI against the MySQL/Postgres service containers.

## v1.3.1 — portable snapshots + heterogeneous batch inserts

**Fixed — Windows-generated migration snapshots broke Linux deploys (critical).**
`createSnapShot` stored `contextLocation` straight from `path.relative()`, which
emits backslashes on Windows. On Linux a backslash is a literal filename
character, so the CLI's `path.resolve()` built a bogus specifier and the ESM
import of the context died with `ERR_INVALID_MODULE_SPECIFIER` **before any
migration ran** — a backend container crash-looped at boot even with a fully
up-to-date database. Fix on both ends: `Migrations/pathUtils.js` gains
`toPosixPath()` (every `\` → `/`; forward slashes are valid on all platforms
Node supports, so Windows behavior is unchanged); the snapshot **writer**
normalizes `contextLocation` before serializing, and every CLI **read** site
normalizes on load — so already-committed backslash snapshots in user repos
work without regeneration.

**Fixed — `bulkInsert` built one INSERT from heterogeneous rows (MySQL +
Postgres).** The multi-row INSERT took its column list from the FIRST entity
but appended EACH entity's own placeholder group. Batched rows with different
populated field sets (the builder skips unset optional columns and auto-PKs)
produced a malformed statement — MySQL `ER_WRONG_VALUE_COUNT_ON_ROW` — and the
context silently fell back to slow per-row inserts on every such batch; worse,
rows whose column COUNT matched while the column SET differed would have landed
values in the wrong columns. Now rows are sub-grouped by identical column
signature and ONE multi-value INSERT is emitted per signature (no NULL-padding
to a column union — an omitted column keeps its DB-level `DEFAULT`, pinned by a
new integration test). Postgres `$n` placeholders renumber per statement, and
results map back to entities in their **original input order** — the contract
`context._processBatchInserts` relies on, which also fixes a latent id
misalignment when one batch spanned multiple tables. SQLite is unaffected (it
loops single inserts in a transaction).

**Tests.** Cross-engine integration tests now quote table identifiers per
engine (`user` is reserved in Postgres, and unquoted DDL case-folds to a
different relation than the engine's quoted writes), and every test body runs
in `try/finally` so `ctx.close()` always releases the pool — a failing test can
no longer hang the `node --test` runner. New `[engine] heterogeneous batch
stays on the bulk path` test pins the bulkInsert fix on both live engines.

## v1.3.0 — full builder type set + inline `env()` config

**Added — builder convenience type methods.** Every column type the engines'
DDL mappers already supported but the entity builder didn't expose now has a
method: `date()`, `datetime()`, `timestamp()`, `float()`, `decimal()`, `bigint()`,
`json()`, `uuid()`, `binary()`. Previously only `string/text/integer/time/boolean`
had methods and everything else required the generic `.type('…')`. Each resolves to
a valid SQL column type on SQLite, MySQL, and Postgres (verified end-to-end).

**Fixed — `context.env()` inline configuration object.** `env()` is documented (its
JSDoc `@example` and the README) to accept an inline config object —
`this.env({ type: 'sqlite', connection: './db/' })` — but it always treated its
argument as a folder path and threw `The "path" argument must be of type string` for
objects. `env()` now branches: an object is used directly as the config; a string
still resolves to `env.<NODE_ENV>.json` (keyed by context class name). No change to
the file-path behavior.

**Docs.** README + MIGRATIONS_GUIDE corrected: entity fields are builder **methods**
(`id(db){ db.integer().primary().auto(); }`), not constructor object-literals (the
schema builder reads prototype methods and ignores `this.x = {…}` properties); env
JSON files are keyed by the context class name; the context file is named after the
context class so the migration CLI (`enable-migrations AppContext`) can resolve it.

Tests: `test/builder-type-methods.test.js`, `test/env-inline-config.test.js`.

## Tooling — cross-engine integration tests + CI (no package change)

Closes the long-standing verification caveat ("executed on SQLite; MySQL/Postgres verified by code-reading"). Each engine's `bulkInsert` is structurally different (SQLite loops single inserts; MySQL builds one multi-row `VALUES` + `insertId`; Postgres multi-row `VALUES … RETURNING`), so "green on SQLite" does not prove "green on MySQL/Postgres".

- **`test/integration/cross-engine.test.js`** — runs the real write/DDL paths against a live server: batch/single `.set()` parity (1.2.10), multi-row `bulkInsert` + auto-PK retrieval, and an executed `alterColumn` type change (1.2.9). Gated on `MR_TEST_MYSQL_URL` / `MR_TEST_PG_URL`; unset → skipped, so the default `npm test` stays SQLite-only and offline.
- **`.github/workflows/test.yml`** — CI matrix (Node 20/22) with `mysql:8` + `postgres:16` service containers wired to those env vars, so every push executes all three engines. Runs lint + the full suite.
- **`docker-compose.test.yml`** — spin the same databases up locally to run the integration suite on your machine.

None of this ships in the npm tarball (`test/`, `.github/`, compose file are outside the `files` allowlist) — it's repo tooling only, so no version bump.

## v1.2.10 — batch/single insert parity (.set() setters, defaults, timestamps, relationships)

**Bug:** masterrecord had two INSERT write paths that didn't agree. A **single** insert (1 entity) routed through `insertManager`, which applies `.set()` setters, default values, auto timestamps, `belongsTo` FK resolution and validation. A **batch** insert (≥2 entities) called `engine.bulkInsert(entities)` **directly**, bypassing `insertManager` entirely. So saving ≥2 entities at once handed the raw, un-transformed model values straight to the engine — e.g. a field whose `.set()` maps a label to an int (`"operator"→2`) reached an INTEGER column as the string `"operator"`, the engine's type validator threw, and the whole batch **fell back to slow per-row inserts**. Correct data landed (via the fallback), but it was noisy and defeated the batch optimization. The batch path also **silently dropped child-relationship rows** (`hasMany`/`hasOne`/`hasManyThrough`), which only the per-entity path inserts.

**Fix (engine-agnostic — applies to SQLite/MySQL/Postgres):**
- `insertManager` now exposes **`prepareInsertModel(entity)`** — the exact `clearAllProto → validateEntity (normalize: .set/defaults/timestamps) → belongsToInsert` pipeline that `runQueries` uses, minus the execute. `runQueries` was refactored to call it, so single and batch share **one** normalization source of truth.
- The context **batch path now runs every entity through `prepareInsertModel`** before building the bulk INSERT, so the fast path produces byte-for-byte identical column values to the single path (and inserts the clean, *set-once* model — no double transform).
- Entities carrying **assigned child-relationship data** are detected (`_batchEntityHasChildren`, own-keys only so no lazy getter is triggered) and routed through the full single-insert path so their children are inserted instead of dropped. The remaining flat entities still get one fast batched insert.
- The existing fallback-to-per-row-on-error safety net is preserved.

New test: `test/batch-insert-set-transform.test.js` — batch applies `.set()` and uses the fast path (no fallback), single/batch store identical values, `prepareInsertModel` returns a clean set-once model, and the child-routing predicate. Full suite **641/641, 0 lint errors**. Verified executing on SQLite; the fix lives in engine-agnostic code (`context.js` + `insertManager.js`), so all three engines share it.

## v1.2.9 — alterColumn type changes (SQLite rebuild + affinity-aware no-op)

**Bug:** `alterColumn` on SQLite emitted invalid SQL (`near ")"`). SQLite has no `ALTER`/`MODIFY COLUMN`, and `schema.alterColumn`'s builder path was handed an empty/missing table schema, producing `CREATE TABLE x ()`. Additionally, `string→text` is a no-op on SQLite (both TEXT affinity) yet it still attempted a rebuild.

**Fix:**
- **SQLite** `alterColumn` now reconciles the table to its entity definition via `syncTable`'s proven rebuild (rename → recreate with the new schema → copy common columns → drop old). It is a **no-op when the type is unchanged at SQLite's affinity level** (`string→text`, `int→bigint`), and performs a **data-preserving rebuild on a real change** (e.g. `integer→text`).
- **`needRebuildSQLite`** now compares the **resolved SQLite affinity** of the desired vs existing column type, catching *any* real type change. The previous check hardcoded only boolean/string/integer and missed most.
- **MySQL** (`MODIFY COLUMN`) and **Postgres** (`ALTER COLUMN … TYPE`) keep their native type-change DDL — verified to emit correct SQL.
- `alterColumn` now `await this._ensureReady()` (parity with the other schema methods) and throws a clear error if the entity schema can't be resolved on SQLite (instead of emitting broken DDL).

New test: `test/alter-column-type.test.js` — SQLite `string→text` no-op (data intact), SQLite `integer→text` rebuild (column becomes TEXT, rows preserved), and MySQL/Postgres SQL output. Verified executing on SQLite; MySQL/Postgres via SQL-string assertions (no live servers here). Full suite 613/613, 0 lint errors.

## v1.2.8 — batched-insert auto-increment PK handling

**Bug:** the batched-insert path could fail with `Type mismatch for <Entity>.id: Expected integer, got function` for an unset auto-increment primary key, then fall back to individual inserts (which handled it). The INSERT builder (`_buildSQLInsertObjectParameterized`, shared by single + batch inserts) only skipped the auto-PK when its value was `undefined`/`null`. When the unset PK surfaced as its **schema-definition function** (`id(db){…}`, e.g. when the row is a class instance rather than a `.new()` data instance), the builder fell through to the type validator and threw.

**Fix (all three engines):** an auto-increment primary key is database-assigned and is now **never emitted in the INSERT unless the caller set an explicit value** — "unset" is recognized whether it surfaces as `undefined`, `null`, or a function. A function value is treated as never-valid for any column (a leaked schema method/getter) and skipped. Single- and batched-insert paths share the builder, so both behave identically; an explicitly-set PK value is still honored.

New test: `test/bulk-insert-autopk.test.js` — builder excludes a function-valued auto-PK (and an `undefined` one), honors an explicit value, and an end-to-end `bulkCreate` assigns auto IDs across a batch with no fallback. Verified on SQLite; the MySQL/Postgres builders received the identical change.

## v1.2.7 — public engine-agnostic raw-SQL escape hatch (`ctx.query` / `ctx.execute`)

Adds a public, portable raw-SQL API so apps stop reaching into `ctx.db` (the raw, engine-specific driver). `ctx.db.prepare()` is better-sqlite3's synchronous API; mysql2/pg have no `.prepare()`, so code written against `ctx.db` "works on SQLite, breaks on MySQL." The only engine-agnostic path was the private `context._execute` (the migration/DDL path, which logs as a migration and doesn't return rows on SQLite).

- **`ctx.query(sql, params)`** (alias **`ctx.execute(sql, params)`**) — runs raw SQL on SQLite/MySQL/Postgres and returns an **array of row objects** for row-returning statements; executes writes (returns the driver's write result). Placeholders are engine-native (`?` for SQLite/MySQL, `$1,$2,…` for Postgres). Each engine gained a matching `query()` method (SQLite uses `stmt.reader` to pick `all()` vs `run()`; pg normalizes `result.rows`).
- **DX guard (loud-failure parity):** on MySQL/Postgres, `ctx.db.prepare()` (and `.pragma()`) now throw a descriptive error pointing to `ctx.query()` instead of the generic "is not a function". `ctx.db` is never used internally (the engines hold their own pool), so this only affects user-facing access; every real driver method is forwarded untouched. SQLite's `ctx.db` is the real better-sqlite3 handle and is unaffected.

This closes the entire "works on SQLite, breaks on MySQL" class for legitimate raw-SQL cases (e.g. cross-context FK updates the query builder can't express). Prefer the ORM where possible; `ctx.query()` is the escape hatch.

New test: `test/raw-query-escape-hatch.test.js`. Docs: README "Raw SQL Queries" + API reference updated; TROUBLESHOOTING gains a "`ctx.db.prepare is not a function`" entry. Suite green; 0 lint errors.

> Verified executing on SQLite (rows/writes/params). The MySQL/Postgres `query()` and the `ctx.db` guard share the same code shape but aren't run against live servers here.

## v1.2.6 — idempotent addColumn (skip-if-exists)

`schema.addColumn` now **skips if the column already exists**, symmetric with `dropColumn`'s skip-if-gone and `createTable`'s `IF NOT EXISTS`. None of SQLite/MySQL support `ADD COLUMN IF NOT EXISTS`, so it probes the live schema via `getTableInfo` (which throws on a real introspection error — so a genuine failure still aborts loudly; only a clean "already present" result short-circuits, with a `[masterrecord:migration]` skip log).

Effect: re-running a migration, or applying one to a database that already has part of the schema, is now safe — the per-migration guards added in 1.2.3 become belt-and-suspenders rather than load-bearing. (belongsTo FK columns are matched by their `foreignKey` name.)

New test: idempotent-addColumn case in `test/migration-self-contained.test.js`. Suite green; 0 lint errors.

## v1.2.5 — documentation catch-up

Docs-only. Brought `docs/MIGRATIONS_GUIDE.md` up to date with the 1.2.x work that was previously only in this changelog:

- New **Indexes** section (`createIndex` / `createCompositeIndex`, incl. `unique`).
- New **Partial / filtered indexes** section (`where`) with the per-engine matrix (Postgres/SQLite native, MySQL throws).
- New **Reliability & observability** section: self-contained generated migrations, loud-failure semantics (no silent no-ops), and the `[masterrecord:migration]` DDL logging + `MR_SILENT_MIGRATIONS` env var (which was undocumented).

No code changes.

## v1.2.4 — partial / filtered indexes (enterprise parity)

Adds a `where` option to `createIndex` and `createCompositeIndex`, bringing masterrecord to parity with EF Core (`HasFilter`), TypeORM/Sequelize (`where`), Rails (`:where`) and Django (`condition`). The canonical use is **one-default-per-scope** — at most one `is_default = 1` per `scope_id`, enforced by the database:

```javascript
// declarative (context)
this.compositeIndex(Setting, ['scope_id'], { unique: true, where: 'is_default = 1' });

// or in a migration
await this.createCompositeIndex({ tableName: 'Setting', columns: ['scope_id'], indexName: 'one_default', unique: true, where: 'is_default = 1' });
// single-column: await this.createIndex({ tableName, columnName, indexName, unique: true, where });
```

- **PostgreSQL / SQLite:** native partial index (`CREATE [UNIQUE] INDEX … WHERE <predicate>`).
- **MySQL:** has no partial indexes — masterrecord **throws** at migration time with a clear message (rather than silently emitting a non-filtered index that would enforce the wrong constraint). Enforce the invariant in the write path or via a generated column. This matches how EF Core / Rails / Django behave on MySQL.
- `where` flows through the full pipeline: entity `static compositeIndexes`, `context.compositeIndex()`, the snapshot diff, and the generated (self-contained) migration. `compositeIndex()` now also accepts a single column.
- `createIndex` (single column) gained `unique` support along the way.
- `where` is a raw, developer-authored SQL predicate (like identifiers) — not for user input.

New tests: `test/partial-index.test.js` — builder output (PG/SQLite emit `WHERE`, MySQL throws), an end-to-end SQLite test proving a second default per scope is rejected, and a declarative round-trip. Suite green; 0 lint errors.

## v1.2.3 — self-contained incremental migrations (fixes silent addColumn no-op across DBs)

**Bug:** an incremental `addColumn` migration could silently no-op on a second database (column never added, migration still recorded as applied). Reproduced and root-caused on prod MySQL.

**Mechanism:** `update-database` does not run the literal op in the migration file — it calls `buildUpObject(committedSnapshot.schema, currentEntities)` and passes the result as `table` to `up(table)`. The generated `await this.addColumn(table.public_token)` therefore depended on `table.public_token` being populated, which only happens when that column is in the **snapshot↔entities diff** (`item.newColumns`). The committed snapshot is shared and gets advanced by whichever DB you migrate first (e.g. dev); every subsequent DB (e.g. prod) then diffs to **empty** for that column → `table.public_token` is `undefined` → `schema.addColumn(undefined)` hit its silent `if(table){…}` guard → nothing ran, migration marked applied. `createTable` was immune because `buildUpObject` populates every table regardless of diff; only incremental column ops were affected.

**Fixes:**
1. **Self-contained generation.** `add-migration` now bakes the full column spec inline — `await this.addColumn({ tableName, name, type, … })` instead of `await this.addColumn(table.public_token)`. Migrations replay deterministically on every database, independent of snapshot state (the standard Rails/Knex/TypeORM model). Applies to `addColumn` and the symmetric `dropColumn` (incl. up/down).
2. **Fail loudly.** `schema.addColumn` / `dropColumn` now throw a descriptive error on an incomplete/undefined operand ("…snapshot is ahead of this database…") instead of silently skipping — so legacy `table.<col>`-style migrations can never silently lose a column again.
3. **Readiness symmetry.** `addColumn` / `dropColumn` now `await this._ensureReady()` (like `createTable`), and throw if no dialect is active — closing the related (theoretical) async-init gap.

New tests: `test/migration-self-contained.test.js` (generation bakes a literal; self-contained add applies despite an empty diff; loud throw on incomplete operand). Suite green (same single pre-existing failure); 0 lint errors.

> Existing already-generated migrations keep working; if one uses the old `table.<col>` form and hits the empty-diff case, it now **throws loudly** (fix #2) instead of silently skipping — regenerate it to get the self-contained form.

## v1.2.2 — deterministic migration snapshots (no transient `tableName` leak)

The generated `*_contextSnapShot.json` could differ run-to-run for an unchanged schema, producing noisy git diffs and occasional spurious "schema changed" detections.

**Root cause:** `buildUpObject()` attached a transient `tableName` to column objects in place (`columnInfo.new[column].tableName = item.name`). Because `cleanEntities()` shallow-copies, those column objects are shared with the schema serialized into the snapshot — so `tableName` leaked in, but only onto the columns that happened to change that run.

**Fix:**
- `buildUpObject()` now tags a **copy** (`{ ...col, tableName }`) instead of mutating the shared column object — the migration template/query-builder still gets the `tableName` it needs, but the schema definitions stay clean.
- `createSnapShot()` normalizes the schema before writing (strips any transient `tableName` from column defs), so the persisted snapshot is deterministic regardless of upstream mutation.

Result: two consecutive snapshot generations of an unchanged schema are now **byte-identical**. New test: `test/snapshot-determinism.test.js`.

> Note: the related *live-timestamp* non-determinism (a `created_at`-style snapshot value changing each run) is **not** a masterrecord bug — it comes from a model/seed using a JS-evaluated default (`Date.now()`/`new Date()`), which is re-evaluated per context build. Pin it with a SQL default (`default('CURRENT_TIMESTAMP')`) or set it in a `beforeSave` hook.

## v1.2.1 — Postgres multi-schema support (configurable schema / search_path)

Closes the gap noted in 1.2.0: a table living in a schema outside the connection's `search_path` was read as "absent" during migrations. You can now target a schema explicitly:

```javascript
await db.env({ type: 'postgres', /* … */, schema: 'tenant1' });
// or: searchPath: 'tenant1,public'
```

- The schema is applied to **every pooled connection** via libpq's `search_path` startup option (`PostgresSyncConnect` sets `options: '-c search_path=…'`). Introspection (`current_schemas`), migrations/DDL, and runtime queries then all resolve to it — no per-identifier qualification, matching how Knex's `searchPath` works.
- On connect, `CREATE SCHEMA IF NOT EXISTS "<schema>"` runs so a fresh deploy self-creates the schema before any table lands in it.
- `schema: 'x'` expands to search_path `x,public`; use `searchPath` for an explicit ordered list (first entry = where new tables are created).
- Schema/searchPath identifiers are strictly validated (letters/digits/underscore, non-leading digit) — invalid names throw at connect rather than being interpolated into the connection string or `CREATE SCHEMA`.
- Backward compatible: with neither option set, behavior is unchanged.

All Postgres engine connections (initial connect + post-create retry) honor the option; the admin pool used to `CREATE DATABASE` intentionally doesn't need it.

New tests: `test/postgres-search-path.test.js` (resolution + injection-safe validation). Verified by unit test; end-to-end relies on the standard libpq `options` parameter (no live Postgres in CI here).

## v1.2.0 — reliable schema introspection + observable migrations (fixes silent column-skip)

**Bug:** adding a column to an existing table could silently no-op on MySQL/Postgres — the column was never added, with no error. Root cause: `tableExists()` and `getTableInfo()` wrapped everything in `catch (_) { return false / [] }`. Any real introspection failure (a connection/permission/`INFORMATION_SCHEMA` error, or — on Postgres — a `search_path` mismatch) was disguised as *"table absent."* `schema.createTable()` then took its blind `CREATE TABLE IF NOT EXISTS` branch, which is a no-op on an existing table, so `syncTable()` (the code that adds the missing column) never ran. Compounded by migration DDL only being logged when `NODE_ENV !== 'production'`, the whole thing was invisible in prod. SQLite was unaffected in practice because its introspection is a local `PRAGMA` that essentially never errors.

**Fix (all three engines + shared schema layer):**
- **Introspection no longer lies.** `tableExists()` / `getTableInfo()` now distinguish a *genuinely-absent* table (zero rows → `false` / `[]`) from a *real failure* (now **throws** with a descriptive `masterrecord: … introspection failed: …` message). A failed introspection therefore aborts the migration loudly instead of silently routing to a no-op create.
- **Migrations are observable in production.** DDL run via `_execute` is always logged as `[masterrecord:migration] …` (independent of `NODE_ENV`; set `MR_SILENT_MIGRATIONS=true` to opt out). Runtime queries keep their existing dev-only `[SQL]` logging.
- Removed the stale `// todo need to work on add column for mysql` — `addColumn()` already works on every engine and now fails loudly on error.

**Postgres note:** introspection is scoped to the connection's `search_path` (`current_schemas(false)`); a table in a schema outside the search_path still reads as absent. Surfacing/handling non-default schemas is a separate feature, but real errors now throw rather than masquerading as absence.

New tests: `test/schema-sync-introspection.test.js` (createTable syncs a missing column on an existing table; introspection throws on real failure vs `[]`/`false` on genuine absence). Verified on SQLite; the same code paths apply to MySQL/Postgres.

## v1.1.9 — docs: correct the seed-data section

README "Seed Data" docs described a code path that doesn't exist. Corrected to match what `add-migration` actually generates (verified against `Migrations/migrationTemplate.js`):

- Context-level `this.dbset(T).seed({…})` compiles to idempotent **`this.seed('T', …)`** calls — not `table.T.create({…})` (which is not a real method and never emitted).
- **Both** routes (context-level and hand-written `this.seed()`) are idempotent (`INSERT OR IGNORE` / `INSERT IGNORE` / `ON CONFLICT DO NOTHING`); the old docs wrongly claimed context-level seeds were non-idempotent and had to be removed after the first run.
- Removed the false "triggers lifecycle hooks / validators" benefit — generated seeds are raw parameterized INSERTs and do **not** run `beforeSave`/`afterSave`/validators (added a note to use `context.Entity.new()` + `save()` when you need those).
- Fixed the upsert example to the real generated form (`this.context.T.where(...).single()` + `existing.save()` + `this.seed(...)`).

Docs-only; no code changes.

## v1.1.8 — entity internals/methods are non-enumerable (fixes spread/JSON data loss)

**Bug:** entity instances exposed their internals (`__entity`, `__context`, `__ID`, `__dirtyFields`, `__state`, `__name`) and helper methods (`toJSON`, `toObject`, `save`, `delete`, `reload`, `clone`) as **enumerable** own properties (attached by object literal / plain assignment). So spreading or `Object.assign`-ing an entity:

```js
const w = await ctx.Workspace.where(x => x.id == $$, id).single();
const out = { ...w, role: 'owner' };
JSON.stringify(out);   // before: {"id":28,"name":"..."} — `role` silently dropped
```

Two failure modes: (1) the **copied `toJSON`** ran on the plain object and rebuilt output from the original columns only, silently discarding any key the caller added; (2) `__context` (the whole DB context) leaked into the copy and could make `JSON.stringify` throw on its circular structure. `Object.keys(entity)` also returned methods + internals.

**Fix:** internals and helper/hook methods are now defined non-enumerable in both entity-construction paths — `Entity/entityTrackerModel.build()` (queried entities) and `QueryLanguage/queryMethods.new()` (new entities). Column accessors stay enumerable (and the FTS `__rank` column too). `{ ...entity, extra }` now serializes correctly and `Object.keys(entity)` returns only columns.

**Engine coverage:** the fix is in shared, engine-agnostic hydration code — all entities (SQLite, MySQL, Postgres) are built through the same `build()` / `new()`. (Regression test runs on SQLite; the code path is identical for the other engines.)

## v1.1.7 — clear remaining safe lint errors (0 errors)

Follow-up to 1.1.6. ESLint now reports **0 errors** (192 `no-var`/`no-redeclare` warnings remain, intentionally deferred — see below). No runtime behavior changes; full test suite green (same single pre-existing `count-no-from-audit` failure).

- **`no-prototype-builtins` (9):** `obj.hasOwnProperty(k)` → `Object.prototype.hasOwnProperty.call(obj, k)`.
- **`no-case-declarations` (23):** wrapped `switch`-`case` bodies that declare `const`/`let` in blocks (SQLite/MySQL/Postgres engines).
- **`no-unused-vars` (61):** removed genuinely-unused imports/locals (verified safe — e.g. an unused `PostgresEngine` import in `context.js`, which builds the PG engine via `PostgresClient`/`__postgresInit`, and an unused `tools` import in `deleteManager.js`), prefixed unused params/catch bindings with `_`.
- **`eqeqeq` (12):** switched the rule to `'smart'` (permits the `x == null` null-or-undefined idiom) and converted the lambda-DSL string comparisons in `queryScript` to `===`.
- **`prefer-const` (2):** in `queryScript`.

**Deferred (now `warn`, not `error`):** `no-var` (123) and `no-redeclare` (69). These live in legacy var-heavy engine internals; mechanically converting them across the MySQL/Postgres code paths — which the local test run (SQLite only) does not exercise — risks silent regressions. Tracked for a dedicated, individually-verified pass.

## v1.1.6 — lint-driven bug fixes + ESLint tooling

Set up ESLint (flat config, eslint 9 + `globals.node`) with a `lint`/`lint:check` script and ran it across the codebase. Beyond the mechanical `var`→`const`/`let` autofix (safe; full test suite still green), the lint surfaced several genuine bugs, now fixed:

- **CLI rollback-to-target was broken.** The migration rollback handler in `Migrations/cli.js` referenced `contextAbs` without ever defining it (every other handler does `const contextAbs = path.resolve(snapDir, contextSnapshot.contextLocation)`), so the command threw `ReferenceError` the moment it tried to load the context. Added the missing resolution.
- **SQLite multi-field UPDATE could drop SET clauses.** `SQLLiteEngine` had two `case "belongsTo"` blocks in the UPDATE builder (a duplicate-case). The one that won **overwrote** the accumulated `argument` instead of appending — so an UPDATE touching a `belongsTo` field plus other fields would lose the other `SET` assignments. Fixed to append and removed the dead duplicate.
- **`migrations.js` dead/broken branches.** `template()` had `if (item.old === null)` / `if (item.new === null)` blocks referencing an undefined `column`; old/new are always `{}` or an object (never `null`), so they never ran — removed.
- **`MasterValidator` (mastercontroller sibling pattern)** — n/a here; see mastercontroller 2.0.6.
- Removed unreachable `break` statements after `return` in `migrationMySQLQuery.boolType`, a no-op self-assignment in `SQLLiteEngine`, and wrapped an intentional assignment-in-condition in `queryScript` to satisfy `no-cond-assign`.

Runtime behavior is unchanged except where noted (the bug fixes). Test suite: green (same single pre-existing `count-no-from-audit` failure as prior releases).

> Note: a number of non-functional stylistic lint findings remain (legacy `var`/`no-redeclare`-heavy internals). These are being addressed separately to avoid risky mechanical rewrites of engine paths that aren't covered by the local (SQLite-only) test run.

## v1.1.5 — clean npm tarball: add a `files` allowlist

The package had no `files` field, so `npm publish` swept the whole working tree. The 1.1.4 tarball shipped `.claude/settings.local.json` (a local editor-settings file that should never have been published), all 20 `test/*.test.js` files, test fixtures, and the eslint/prettier configs — none of which belong in a consumed package.

- Added a `files` allowlist: top-level `*.js`, `Cache/`, `Entity/`, `QueryLanguage/`, `Migrations/` runtime modules, `docs/`, `CHANGES.md`, `LICENSE` (npm always also includes `readme.md` and `package.json`). `bin` (`Migrations/cli.js`) still ships.
- Excluded `**/*.test.js` (including the colocated `Migrations/pathUtils.test.js`) and the dev configs via `files` negation patterns.
- Added `.claude/` to `.gitignore`.

Result: tarball dropped from publishing ~65 files to 42 — runtime code + docs only. No source/API changes; runtime behavior is identical to 1.1.4.

## v1.1.4 — re-publish: include the entityTrackerModel.js fix that 1.1.3 missed

v1.1.3's commit dropped one of the two files it was supposed to ship — the `Entity/entityTrackerModel.js` change. macOS's case-insensitive filesystem combined with git's case-sensitive index: the file is tracked as `Entity/EntityTrackerModel.js` (capital E), the disk had `entityTrackerModel.js` (lowercase e), and `git add Entity/entityTrackerModel.js` silently no-op'd against the capital-E tracked path.

Effect on 1.1.3: the **loaded-entity** FK crash described in v1.1.3's changelog was NOT actually fixed in the published package. `.new()` entities did get the fix (the queryMethods.js change shipped correctly).

v1.1.4 ships exactly the same intent as v1.1.3, with the tracker file actually included. If you installed 1.1.3, upgrade to 1.1.4.

## v1.1.3 — belongsTo FK column setter on both `.new()` and loaded entities

**Bug:** `belongsTo('Run')` declares a navigation property `Run` and an implicit FK column `run_id`. Two assignment paths existed but only one worked reliably:

| Path                                | Worked before? | Why                                                 |
| ----------------------------------- | -------------- | --------------------------------------------------- |
| `step.Run = id` (any entity)        | ✅             | Setter installed by relationship-models pass        |
| `step.run_id = id` (new entity)     | ⚠️ partial     | Value reached INSERT via fallback, but wasn't tracked as dirty |
| `step.run_id = id` (loaded entity)  | ❌ **crash**   | Tracker setter dereferenced `__entity['run_id'].set` — undefined → TypeError |

The loaded-entity crash forced users into the raw-SQL escape hatch on `context.db` to update FKs.

**Fix:**
- `QueryLanguage/queryMethods.js` `.new()` — for each `belongsTo` field, also install a setter on the FK column name (e.g. `run_id`). Both `step.Run = id` and `step.run_id = id` now produce identical tracked state.
- `Entity/entityTrackerModel.js` `build()` — when the DB-row iterator builds a setter for a column that has no `__entity` entry (the FK column case), guard the `.set` access and canonicalize the dirty-field name to the navigation property's name so the engine UPDATE/INSERT builders' existing belongsTo path picks it up.

Setting the FK column on a loaded entity now correctly emits an UPDATE; setting it on a `.new()` entity correctly marks the field dirty so subsequent saves include it.

3 new tests in `test/belongs-to-fk-setter.test.js` cover the three paths above.

### Known limitation: columns added by a migration after the class is loaded

If a migration adds a column but the entity class file isn't reloaded (Node's import cache is process-lifetime), assignments to the new field on `.new()` instances won't be tracked because `__entity` was built from the stale class. There's no fix possible from inside the library — restart the process after editing the model class. As a stopgap, use `context.db` to run raw SQL.

## v1.1.2 — belongsTo FK type resolution + MySQL/SQLite type-map gaps

**Bug:** `belongsTo()` hardcoded the FK column type to `integer` at entity-definition time, before the parent entity was registered. If the parent's PK was `string` / `bigint` / `uuid`, the FK was still emitted as `INTEGER`. SQLite accepted the mismatch silently (dynamic typing); Postgres and MySQL rejected inserts of string IDs into integer columns.

**Fix:** after every `dbset()` call, walk every registered entity and re-resolve each `belongsTo` column's `type` from its parent's primary-key type. Order-independent (works whether parent or child is registered first), idempotent (running multiple times produces the same result), case-insensitive on the `foreignTable` lookup.

| Parent PK type | SQLite FK | MySQL FK     | Postgres FK |
| -------------- | --------- | ------------ | ----------- |
| `string`       | TEXT      | VARCHAR(255) | VARCHAR(255) |
| `integer`      | INTEGER   | INTEGER      | INTEGER     |
| `bigint`       | INTEGER   | BIGINT       | BIGINT      |
| `uuid`         | TEXT      | VARCHAR(36)  | UUID        |

**Related cleanup in the migration type maps:**

- **MySQL** `typeManager` now handles `bigint`, `uuid`, `int`, `jsonb`, and falls back to `TEXT` for unknown types. Previously these emitted literal `undefined` into the DDL string (e.g. `` `run_id` undefined NOT NULL ``).
- **SQLite** `typeManager` now handles `bigint`, `uuid`, `int`, `float`, `decimal`, `binary`/`blob`, `json`/`jsonb`, `date`/`datetime`/`timestamp` explicitly (collapsing to the appropriate SQLite affinity). Same `TEXT` fallback as before.

17 new tests cover the resolver across all four PK types, both `dbset()` orders, and every engine's emitted DDL.

## v1.1.1 — Documentation

- Documented the v1.1.0 full-text search feature: new [`docs/FULL_TEXT_SEARCH.md`](docs/FULL_TEXT_SEARCH.md), README section, and `.search()` entry in [`docs/METHODS_REFERENCE.md`](docs/METHODS_REFERENCE.md).
- Documented `createFullTextIndex` / `dropFullTextIndex` in [`docs/MIGRATIONS_GUIDE.md`](docs/MIGRATIONS_GUIDE.md).
- Removed stale per-bug postmortem markdown files (kept their fixes; deleted the writeups).

## v1.1.0 — Portable Full-Text Search

A single API that targets each engine's native FTS implementation.

- **Migrations** — `createFullTextIndex({ tableName, columns, indexName?, config? })` and `dropFullTextIndex({ tableName, indexName? })`:
  - **SQLite** — FTS5 external-content virtual table + AFTER INSERT/UPDATE/DELETE triggers
  - **PostgreSQL** — `tsvector` column + GIN index + maintenance trigger (`config` controls `to_tsvector` config, default `'english'`)
  - **MySQL** — `ALTER TABLE … ADD FULLTEXT INDEX`
- **Runtime** — `.search({ in: [columns], query: 'terms' })` fluent method on any dbset. Composes with `.where()`, `.take()`, `.skip()`, `.orderBy()`. Each result row has a `__rank` field; default ordering is rank descending.
- 17 new tests cover DDL output per engine, generated SQL strings, and an end-to-end SQLite ranking test.

## v1.0.8 — Idempotent dropColumn + Postgres getTableInfo

- `dropColumn` is now idempotent across all engines (uses `IF EXISTS` where supported; no-op when the column is already gone).
- PostgreSQL: implemented `getTableInfo()` against `information_schema.columns` so introspection-driven migrations work.

## v1.0.7 — Postgres identifier quoting + cross-engine cleanup

- PostgreSQL: all generated DDL and DML now quotes identifiers (`"camelCase"`, `"updatedAt"`, etc.) so mixed-case entity and column names work. Previously these were lowercased silently by Postgres, breaking queries.
- Removed accidental case transformations from `buildWhere` / `buildAnd` in the SQLite, MySQL, and Postgres engines — field names are now used as declared.
- MySQL: `bulkDelete` honors the entity's actual primary key column instead of hard-coding `id`.

## v1.0.x — Bug fixes

- `.new()` setter with `transform.toDatabase`: object-valued fields were silently dropped on save. Now applied via the field transformer.
- Nested-array property assignment no longer corrupts adjacent fields.
- SQLite engine: absolute paths in `connection` were being concatenated with the project root, producing `/abs//abs/path`. Now passed through unchanged.
- Query builder parity: `ORDER BY`, `LIMIT`, `OFFSET`, `AND`, and `COUNT` are emitted consistently across all three engines. Previously each engine had a different subset of dropped clauses depending on the call path.
- CLI `update-database`: now applies every pending migration via a tracking table, not just the latest file.

## v1.0.0 — ESM only

**BREAKING:** Pure ESM. Requires **Node.js 20+** and `"type": "module"` in the host project's `package.json`. No CommonJS build.

- All sources moved from `require` / `module.exports` to `import` / `export default`.
- Static import of `better-sqlite3` in `context.js` (no more runtime `require(sqlName)`).
- Environment config files and migration snapshot files load via `fs.readFileSync` + `JSON.parse` instead of `require()` — `context.env()` stays synchronous.
- User-authored migration files load via `await import(pathToFileURL(file).href)`. The CJS `Module.prototype.require` aliasing hook is gone; host projects must install `masterrecord` as a local dependency.
- `Migrations/migrationTemplate.js` emits ESM migrations only.
- `context.js` exports the default class plus named error classes (`ContextError`, `ConfigurationError`, `DatabaseConnectionError`, `EntityValidationError`).
- `Cache/QueryCache.js` cleanup timer is `.unref()`'d so it no longer keeps the event loop alive.
- Lint / format configs migrated to flat ESM (`eslint.config.js`, `prettier.config.js`).
- Test suite rewritten on `node --test`.

### Upgrading

1. Node 20 or newer.
2. `"type": "module"` in your `package.json`.
3. `require('masterrecord/…')` → `import X from 'masterrecord/…'`.
4. `module.exports = MyContext` → `export default MyContext`.
5. Add `.js` extensions to all relative imports (ESM requires explicit extensions).
6. Regenerate migration files (or update the top/bottom): `import masterrecord from 'masterrecord';` … `export default <Name>;`.
