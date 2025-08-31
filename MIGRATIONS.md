### Migrations and Server Update Guide

This project ships a CLI, exposed as `masterrecord`, to manage database migrations. Below are the steps to enable migrations, create migrations, apply them, and update your running server.

### 1) Install the CLI (local repo checkout)

- From the project root, install the CLI globally:
```bash
npm install -g ./
```

After install, the `masterrecord` command becomes available in your shell.

### 2) Prepare your Context and Environment

- Ensure your app has a Context class that extends `context` and configures a DB connection (SQLite or MySQL) using either `useSqlite()` or `useMySql()`.
- Set the environment via the `master` env var when running commands, e.g. `master=development` or `master=production`.
- Provide environment JSON at `env.<ENV>.json` reachable from your app root, keyed by your Context class name. Example for SQLite:
```json
{
  "AppContext": {
    "type": "better-sqlite3",
    "connection": "/db/app.sqlite"
  }
}
```
Example for MySQL:
```json
{
  "AppContext": {
    "type": "mysql",
    "host": "localhost",
    "user": "root",
    "password": "secret",
    "database": "app_db"
  }
}
```

### 3) Enable migrations (one-time per Context)

- Run from the project root where your Context file lives. Use the Context file name (without extension) as the argument.
```bash
master=development masterrecord enable-migrations AppContext
```
This creates `db/migrations/<context>_contextSnapShot.json` and the `db/migrations` directory.

### 4) Create a migration

- After you change your entity models, generate a migration file:
```bash
master=development masterrecord add-migration <MigrationName> AppContext
```
This writes a new file to `db/migrations/<timestamp>_<MigrationName>_migration.js`.

### 5) Apply migrations to the database

- Apply only the latest pending migration:
```bash
master=development masterrecord update-database AppContext
```
- Apply all migrations from the beginning (useful for a clean DB):
```bash
master=development masterrecord update-database-restart AppContext
```
- List migration files (debug/inspection):
```bash
master=development masterrecord get-migrations AppContext
```

Notes:
- The CLI searches for `<context>_contextSnapShot.json` under `db/migrations` relative to your current working directory.
- For MySQL, ensure your credentials allow DDL. For SQLite, the data directory is created if missing.

### 6) Updating the running server

General flow to roll out schema changes:
- Stop the server or put it into maintenance mode (optional but recommended for non-backward-compatible changes).
- Pull the latest code (containing updated models and generated migration files).
- Run migrations against the target environment:
```bash
master=production masterrecord update-database AppContext
```
- Restart your server/process manager (e.g., `pm2 restart <app>`, `docker compose up -d`, or your platform’s restart command).

Backward-compatible rollout tip:
- If possible, deploy additive changes first (new tables/columns), release app code that begins using them, then later clean up/removal migrations.

### Troubleshooting

- Cannot find Context file: ensure you run commands from the app root and pass the correct Context file name used when defining your class (case-insensitive in the snapshot, but supply the same name you used).
- Cannot connect to DB: confirm `master=<env>` is set and `env.<env>.json` exists with correct credentials and paths.
- MySQL type mismatches: the migration engine maps MasterRecord types to SQL types; verify your entity field `type` values are correct.


