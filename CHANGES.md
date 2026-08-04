# MasterRecord Changelog

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
