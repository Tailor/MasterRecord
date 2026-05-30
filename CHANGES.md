# MasterRecord Changelog

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
