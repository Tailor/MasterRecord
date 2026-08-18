# Security & Production Guide

MasterRecord is designed to be safe by default. This page documents the guarantees, the sharp edges, and the settings you should turn on for a production / enterprise deployment across SQLite, MySQL, and Postgres.

## 1. Query parameterization (SQL injection)

**Always pass runtime values through the `$$` (or `$`) placeholder** — never interpolate them into the lambda string yourself.

```js
// ✅ SAFE — the value is bound as a parameter (?, $1) on every engine
ctx.User.where(u => u.email == $$, req.body.email).toList();
ctx.User.where(u => $$.includes(u.id), req.query.ids).toList();   // IN (...)
ctx.User.where(u => u.name.like($$), `${term}%`).toList();        // LIKE

// ❌ UNSAFE — you built SQL from untrusted input by hand
ctx.User.where(`u => u.email == '${req.body.email}'`).toList();
```

Values bound via `$$` / `$` go through prepared-statement parameters (`?` on SQLite/MySQL, `$1,$2,…` on Postgres) and are type-validated (`only primitives, null, Date, Buffer`). The lambda parser also restricts column names to word characters and operators to a fixed set, and every engine re-asserts the operator against an allowlist before emitting SQL.

Inline literals (e.g. `u => u.status == "active"`) are single-quote-escaped (`'` → `''`) as defense-in-depth, but the placeholder path above is the contract for anything user-supplied.

## 2. Pagination values (`.take()` / `.skip()`)

`LIMIT` / `OFFSET` **cannot** be parameterized on any engine, so pagination is a classic injection point. MasterRecord validates these for you:

```js
ctx.User.take(req.query.limit).skip(req.query.offset).toList();
```

- A non-negative integer (or a clean numeric string like `'25'`) is accepted.
- Anything else (a value that appends extra SQL after the number, `-1`, `1.5`, `NaN`) **throws** before it can reach the SQL string — both at the `.take()`/`.skip()` setter and again at the engine boundary.

Clamp `limit` to a sane maximum in your own code to avoid unbounded result sets.

## 3. Raw SQL

There are two raw escape hatches — know which one you're using:

```js
// ✅ Parameterized and portable — prefer this for anything with user input.
await ctx.query('SELECT * FROM "User" WHERE email = $1', [email]);   // Postgres
await ctx.query('SELECT * FROM User WHERE email = ?', [email]);       // SQLite/MySQL

// ⚠️ Verbatim — the string is executed as-is (no binding). NEVER interpolate
//    untrusted input into it.
ctx.User.raw('SELECT * FROM User WHERE active = 1').toList();
```

`ctx.query(sql, params)` / `ctx.execute(sql, params)` bind their parameters. The query-builder `.raw(sql)` runs the string verbatim — treat it like writing SQL by hand.

## 4. Atomic writes

`saveChanges()` wraps **all** tracked inserts/updates/deletes in a single transaction on every engine (SQLite, MySQL, Postgres). If any statement fails, the entire batch is rolled back — you never get partial data. No extra code required:

```js
ctx.Order.add(order);
ctx.LineItem.add(item1);
ctx.LineItem.add(item2);
await ctx.saveChanges();   // all-or-nothing
```

(Internally, the bulk-write fast paths are savepoint-protected so a fallback to per-row writes still works inside the enclosing transaction.)

## 5. Transport encryption (TLS/SSL)

**MySQL and Postgres connect in plaintext unless you supply an `ssl` option.** For any non-local database, enable TLS in your environment config:

```jsonc
// Postgres — managed provider with a CA cert
{ "AppCtx": { "type": "pg", "host": "…", "database": "…", "user": "…", "password": "…",
              "ssl": { "rejectUnauthorized": true, "ca": "<PEM>" } } }

// MySQL — verify the server certificate
{ "AppCtx": { "type": "mysql", "host": "…", "database": "…", "user": "…", "password": "…",
              "ssl": { "rejectUnauthorized": true } } }
```

MasterRecord never forces `rejectUnauthorized: false`; whatever you pass in `ssl` is handed to the underlying driver (`mysql2` / `pg`) unchanged. Do **not** disable certificate verification in production.

SQLite is a local file — protect it with filesystem permissions and disk encryption.

## 6. Credentials

- Connection passwords are never logged. `getConnectionInfo()` deliberately omits the password.
- Keep DB credentials in environment config / secrets, not in source.
- In production set `NODE_ENV=production` to silence per-query SQL logging (runtime SQL is only logged outside production or when `LOG_SQL=true`).

## 7. Schema / migration identifiers

DDL identifiers (table, column, index names) can't be parameterized, and migrations are developer-authored code, so MasterRecord treats them as trusted. **Do not build entity, table, column, or index names — or index `where` predicates — from untrusted input.** Database names passed to the auto-create bootstrap are validated against a strict pattern before use.

---

Found a security issue? Please report it privately to the maintainer rather than opening a public issue.
