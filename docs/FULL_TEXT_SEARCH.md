# Full-Text Search

> Available since **v1.1.0**.

MasterRecord ships a portable full-text search API that runs on top of each engine's native FTS implementation:

| Engine     | Implementation                                                  |
| ---------- | --------------------------------------------------------------- |
| SQLite     | FTS5 external-content virtual table + AFTER INSERT/UPDATE/DELETE triggers |
| PostgreSQL | `tsvector` column + GIN index + maintenance trigger             |
| MySQL      | `FULLTEXT INDEX`                                                |

Your migration and query code stays the same across all three. The setup details, the rank algorithm (BM25 vs `ts_rank` vs MySQL relevance), and the query-syntax details (FTS5's `NEAR`, Postgres `&|<->`, MySQL natural-language mode) all live inside MasterRecord.

---

## Why not just use `.like()`?

`LIKE` does a literal substring match without ranking, stemming, or tokenization. For "the user typed a few words, show the best matches first" you want FTS. Here's the practical difference:

| Need                                                | `.like()`   | `.search()` |
| --------------------------------------------------- | ----------- | ----------- |
| Find rows containing this exact substring           | ✅          | ✅          |
| Prefix match (`auth*`)                              | ✅ (`auth%`) | ✅          |
| Match `authentication` when searching `auth`        | ❌          | ✅          |
| Match `auth login` regardless of word order         | ❌          | ✅          |
| Rank results by relevance                           | ❌          | ✅          |
| Fast on large tables                                | ❌ (scan)   | ✅ (index)  |

If you want simple substring filtering, stay with `.like()`. If you want a search box, use `.search()`.

---

## Setup — in a migration

Declare the index alongside `createTable`:

```js
import masterrecord from 'masterrecord';

class AddMemoryDocFts extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.MemoryDoc);
        await this.createFullTextIndex({
            tableName: 'MemoryDoc',
            columns: ['title', 'body'],
        });
    }

    async down(table) {
        await this.init(table);
        await this.dropFullTextIndex({ tableName: 'MemoryDoc' });
        await this.dropTable(table.MemoryDoc);
    }
}

export default AddMemoryDocFts;
```

### `createFullTextIndex(info)`

| Option       | Type     | Required | Description                                                                                |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------ |
| `tableName`  | string   | yes      | Source table.                                                                              |
| `columns`    | string[] | yes      | Columns to index, in order.                                                                |
| `indexName`  | string   | no       | Override the generated index name (`idx_<table>_fts` by default).                          |
| `config`     | string   | no       | Postgres-only `to_tsvector` config (defaults to `'english'`). Ignored on SQLite and MySQL. |

Per-engine effect:

- **SQLite** — creates `<TableName>_fts` virtual table with `content=<TableName>, content_rowid=id`, plus AFTER INSERT/UPDATE/DELETE sync triggers. The FTS table mirrors the source automatically.
- **Postgres** — adds a `__tsv tsvector` column, backfills it from existing rows, creates a GIN index, and installs a BEFORE INSERT/UPDATE trigger that keeps `__tsv` in sync with the listed columns.
- **MySQL** — `ALTER TABLE … ADD FULLTEXT INDEX (col1, col2)`. MySQL maintains the index automatically; no triggers needed.

### `dropFullTextIndex(info)`

| Option      | Type   | Required | Description                                  |
| ----------- | ------ | -------- | -------------------------------------------- |
| `tableName` | string | yes      | Source table.                                |
| `indexName` | string | no       | Override if you set a custom name on create. |

Reverses everything `createFullTextIndex` did. Safe to re-run on missing infrastructure (`IF EXISTS` clauses everywhere).

---

## Querying — at runtime

```js
const docs = await ctx.MemoryDoc
    .search({ in: ['title', 'body'], query: 'auth login' })
    .toList();

// Each row exposes a __rank field
for (const d of docs) {
    console.log(d.__rank, d.title);
}
```

### `.search(opts)`

| Option  | Type     | Required | Description                                                             |
| ------- | -------- | -------- | ----------------------------------------------------------------------- |
| `in`    | string[] | yes      | Columns to search. Must be a subset of what `createFullTextIndex` indexed. |
| `query` | string   | yes      | Search terms. Engine-specific syntax (see below).                       |

Returns a chainable query builder, just like `.where()`. Each returned row gets a `__rank` field; results are ordered by rank descending by default.

### Composition

`.search()` composes with `.where()`, `.take()`, `.skip()`, `.orderBy()`. The search predicate ANDs with `.where()` conditions:

```js
// Workspace-scoped FTS, paginated, top 10
const page = await ctx.MemoryDoc
    .search({ in: ['title', 'body'], query: 'auth login' })
    .where(d => d.workspace_id == ctx.$$, workspaceId)
    .take(10)
    .skip(20)
    .toList();
```

If you chain your own `.orderBy()`, it replaces the default rank ordering:

```js
// Most-recently-updated first, regardless of rank
const docs = await ctx.MemoryDoc
    .search({ in: ['title', 'body'], query: 'auth' })
    .orderByDescending(d => d.updated_at)
    .toList();
```

---

## Engine-specific query syntax

The `query` string is passed through to the engine's native FTS operator, so syntax differs:

| Engine     | Operator                                        | Common syntax                                        |
| ---------- | ----------------------------------------------- | ---------------------------------------------------- |
| SQLite     | `MATCH 'terms'`                                 | `auth*` (prefix), `auth NEAR login`, `"exact phrase"` |
| PostgreSQL | `@@ plainto_tsquery('terms')`                   | Plain words. For operators use `to_tsquery` syntax: `auth & login`, `auth | login` |
| MySQL      | `MATCH(...) AGAINST(? IN NATURAL LANGUAGE MODE)` | Plain words. `+auth -login`, `"exact phrase"` in boolean mode (default is NLM) |

> **The ranking *score* and exact ordering will differ across engines** — BM25 is not the same as `ts_rank` is not the same as MySQL relevance. Within a single engine the ordering is stable and meaningful; across engines it's best-effort.

If your app's correctness depends on matching specific tokens or operator semantics, pick an engine and stay on it.

---

## Reading rank

Every row returned from a `.search()` query has a `__rank` field added:

```js
const rows = await ctx.MemoryDoc
    .search({ in: ['title', 'body'], query: 'auth' })
    .toList();
console.log(rows[0].__rank); // numeric
```

The scale differs per engine — Postgres and MySQL return positive values where higher means more relevant; SQLite's BM25 returns negative values where lower (more negative) means more relevant. **You should not compare rank values across engines.** Within a single query they're consistent for sorting.

---

## Patterns

### Auto-complete / search-as-you-type

Use a prefix query — supported on SQLite (`auth*`) and Postgres (`auth:*` with `to_tsquery`; with `plainto_tsquery` it's plain stemming). MySQL natural-language mode doesn't do prefix matching; switch to boolean mode if you need it.

For broadly portable behavior with `plainto_tsquery` semantics, just pass the prefix:

```js
ctx.MemoryDoc.search({ in: ['title'], query: 'auth' }).take(10).toList();
```

### Scoped search

Combine `.search()` with `.where()` on a tenant column:

```js
ctx.MemoryDoc
    .search({ in: ['title', 'body'], query })
    .where(d => d.workspace_id == ctx.$$, workspaceId)
    .toList();
```

### Pagination

`.search()` + `.skip().take()` work together. Rank is stable per query, so paging is safe as long as the underlying data doesn't change between requests.

### Returning rank to the UI

`__rank` is a regular column on the result row. Serialize it as you would any field:

```js
const results = await ctx.MemoryDoc.search({ in: ['title', 'body'], query }).toList();
return results.map(d => ({ id: d.id, title: d.title, score: d.__rank }));
```

---

## Caveats

- **The columns passed to `.search({ in: [...] })` must be a subset of what `createFullTextIndex({ columns: [...] })` declared.** If you index `[title, body]` and search `in: ['summary']`, the engine will reject the query (SQLite/Postgres) or return nothing (MySQL).
- **MySQL FULLTEXT requires InnoDB ≥ 5.6** (or MyISAM). Older versions need a different table engine.
- **Postgres requires a `to_tsvector`-compatible config.** Default is `'english'`. Pass `config: 'simple'` for no stemming, or any other Postgres config you've configured.
- **Don't search before populating.** On SQLite the FTS table is filled by INSERT triggers — rows that exist before `createFullTextIndex` are NOT indexed unless you re-insert them. On Postgres, the migration backfills the `tsvector` column automatically. On MySQL, FULLTEXT indexes existing rows when the index is created.

---

## When NOT to use this

Both runtime search and the schema setup add complexity. Skip them if:

- You only need substring matching → use `.like()`.
- Your dataset is tiny and a full table scan is fine.
- You need cross-language or fuzzy matching beyond what BM25/`ts_rank` provide — reach for a dedicated search engine (Meilisearch, Elastic, Typesense) and integrate it as a separate service.
