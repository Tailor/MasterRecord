# MasterRecord Migrations Guide

Complete guide for database migrations and seed data with MySQL, SQLite, and PostgreSQL.

> **ESM only.** MasterRecord v1.0+ is a pure ESM package. Every example below uses `import`/`export default` syntax. Your host project must have `"type": "module"` in its `package.json`.

## Table of Contents
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Database Support](#database-support)
- [Creating Migrations](#creating-migrations)
- [Seed Data](#seed-data)
- [Migration Commands](#migration-commands)
- [Examples](#examples)

## Overview

MasterRecord migrations let you:
- Create and modify database tables from code-first entity definitions
- Track schema changes over time with automatic snapshots
- Seed initial or test data with idempotent inserts
- Roll back changes when needed
- Work consistently across MySQL, SQLite, and PostgreSQL

## Quick Start

### 1. Set up your context

```javascript
// app/models/context.js
import context from 'masterrecord/context';
import User from './User.js';
import Post from './Post.js';

class AppContext extends context {
    constructor() {
        super();
        this.env('config/environments');
        this.dbset(User);
        this.dbset(Post);
    }
}

export default AppContext;
```

### 2. Enable migrations (one-time)

```bash
masterrecord enable-migrations AppContext
```

This creates a snapshot file at `app/models/db/migrations/appcontext_contextSnapShot.json`.

### 3. Generate a migration

```bash
masterrecord add-migration InitialCreate AppContext
```

MasterRecord diffs the current entity definitions against the snapshot and emits a migration file at `app/models/db/migrations/<timestamp>_InitialCreate_migration.js`.

### 4. Review the generated migration

```javascript
// app/models/db/migrations/1700000000000_InitialCreate_migration.js
import masterrecord from 'masterrecord';

class InitialCreate extends masterrecord.schema {
    constructor(context) {
        super(context);
    }

    async up(table) {
        await this.init(table);
        await this.createTable(table.User);
        await this.createTable(table.Post);
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.Post);
        await this.dropTable(table.User);
    }
}

export default InitialCreate;
```

### 5. Apply migrations

```bash
masterrecord update-database AppContext
```

## Database Support

### PostgreSQL
- SERIAL / BIGSERIAL auto-increment
- Native BOOLEAN, UUID, JSONB
- Parameterized queries (`$1`, `$2`, …)
- `ON CONFLICT DO NOTHING` for idempotent seeds

### MySQL
- `AUTO_INCREMENT` primary keys
- TINYINT for booleans (0/1)
- JSON column type
- `INSERT IGNORE` for idempotent seeds

### SQLite
- `AUTOINCREMENT` primary keys
- INTEGER for booleans (0/1)
- `INSERT OR IGNORE` for idempotent seeds

## Creating Migrations

Migration files are classes that extend `masterrecord.schema`. They must implement `async up(table)` and `async down(table)` methods. Always call `await this.init(table)` first inside each method.

### Creating a table

```javascript
import masterrecord from 'masterrecord';

class CreateUsers extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.User);
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.User);
    }
}

export default CreateUsers;
```

### Adding columns

```javascript
import masterrecord from 'masterrecord';

class AddPhoneToUser extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.addColumn({
            tableName: 'User',
            name: 'phone_number',
            type: 'string',
        });
    }

    async down(table) {
        await this.init(table);
        await this.dropColumn({ tableName: 'User', name: 'phone_number' });
    }
}

export default AddPhoneToUser;
```

### Modifying columns

```javascript
import masterrecord from 'masterrecord';

class MakeAgeRequired extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.alterColumn({
            tableName: 'User',
            table: { name: 'age', type: 'integer', nullable: false, default: 0 },
        });
    }

    async down(table) {
        await this.init(table);
        await this.alterColumn({
            tableName: 'User',
            table: { name: 'age', type: 'integer', nullable: true },
        });
    }
}

export default MakeAgeRequired;
```

### Full-text search indexes

Create and drop portable FTS indexes. Each engine emits its native equivalent — FTS5 virtual table + triggers on SQLite, `tsvector` column + GIN index + maintenance trigger on PostgreSQL, `FULLTEXT INDEX` on MySQL.

```javascript
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

`createFullTextIndex(info)` accepts:
- `tableName` (string, required)
- `columns` (string[], required) — columns to index
- `indexName` (string, optional) — overrides the generated name (`idx_<table>_fts`)
- `config` (string, optional) — Postgres-only `to_tsvector` config (defaults to `'english'`)

Runtime querying uses the matching `.search({ in, query })` dbset method — see [FULL_TEXT_SEARCH.md](FULL_TEXT_SEARCH.md) for engine-specific query syntax and ranking caveats.

### Renaming columns

```javascript
import masterrecord from 'masterrecord';

class RenameUsernameColumn extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.renameColumn({ tableName: 'User', name: 'username', newName: 'user_name' });
    }

    async down(table) {
        await this.init(table);
        await this.renameColumn({ tableName: 'User', name: 'user_name', newName: 'username' });
    }
}

export default RenameUsernameColumn;
```

## Seed Data

### Single-row seeding

```javascript
import masterrecord from 'masterrecord';

class SeedRoles extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.Role);

        this.seed('Role', { name: 'Admin', description: 'Administrator role' });
        this.seed('Role', { name: 'User', description: 'Regular user role' });
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.Role);
    }
}

export default SeedRoles;
```

### Bulk seeding (preferred)

```javascript
import masterrecord from 'masterrecord';

class SeedUsers extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.User);

        this.bulkSeed('User', [
            { name: 'Alice', email: 'alice@example.com', age: 25 },
            { name: 'Bob', email: 'bob@example.com', age: 30 },
            { name: 'Charlie', email: 'charlie@example.com', age: 35 },
        ]);
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.User);
    }
}

export default SeedUsers;
```

Seeds are idempotent — re-running a migration won't create duplicate rows, because MasterRecord emits the database-native "insert or ignore" form (`INSERT OR IGNORE`, `INSERT IGNORE`, or `ON CONFLICT DO NOTHING`). This requires a unique constraint or primary key on the target table.

### Conditional seeding by database

```javascript
import masterrecord from 'masterrecord';

class SeedSettings extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.Setting);

        if (this.context.isPostgres) {
            this.seed('Setting', { key: 'postgres_feature', value: 'enabled' });
        }
        if (this.context.isMySQL) {
            this.seed('Setting', { key: 'mysql_feature', value: 'enabled' });
        }
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.Setting);
    }
}

export default SeedSettings;
```

## Migration Commands

```bash
# Enable migrations for a context (creates snapshot)
masterrecord enable-migrations <ContextName>

# Generate a new migration from a diff of current entities vs snapshot
masterrecord add-migration <MigrationName> <ContextName>

# Apply all pending migrations
masterrecord update-database <ContextName>

# Operate on every context in the project at once
masterrecord enable-migrations-all
masterrecord add-migration-all <MigrationName>
masterrecord update-database-all
```

Migration state is tracked in `<contextname>_contextSnapShot.json` alongside the migration files.

## Examples

### Example: E-commerce schema

```javascript
// app/models/db/migrations/1700000000000_CreateECommerce_migration.js
import masterrecord from 'masterrecord';

class CreateECommerce extends masterrecord.schema {
    async up(table) {
        await this.init(table);

        await this.createTable(table.User);
        await this.createTable(table.Category);
        await this.createTable(table.Product);
        await this.createTable(table.Order);
        await this.createTable(table.OrderItem);

        this.bulkSeed('Category', [
            { name: 'Electronics', slug: 'electronics' },
            { name: 'Clothing', slug: 'clothing' },
            { name: 'Books', slug: 'books' },
        ]);

        this.seed('User', {
            name: 'Admin',
            email: 'admin@shop.com',
            role: 'admin',
        });

        this.bulkSeed('Product', [
            { name: 'Laptop', price: 999.99, category_id: 1, stock: 50 },
            { name: 'T-Shirt', price: 19.99, category_id: 2, stock: 200 },
        ]);
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.OrderItem);
        await this.dropTable(table.Order);
        await this.dropTable(table.Product);
        await this.dropTable(table.Category);
        await this.dropTable(table.User);
    }
}

export default CreateECommerce;
```

### Example: Multi-database-aware migration

```javascript
import masterrecord from 'masterrecord';

class AddUserPreferences extends masterrecord.schema {
    async up(table) {
        await this.init(table);

        // Works across all databases
        await this.addColumn({
            tableName: 'User',
            name: 'preferences',
            type: 'text',
        });

        // PostgreSQL: upgrade to native JSONB
        if (this.context.isPostgres) {
            await this.alterColumn({
                tableName: 'User',
                table: { name: 'preferences', type: 'jsonb' },
            });
        }

        this.seed('User', {
            name: 'Demo User',
            email: 'demo@example.com',
            preferences: JSON.stringify({ theme: 'light', notifications: true, language: 'en' }),
        });
    }

    async down(table) {
        await this.init(table);
        await this.dropColumn({ tableName: 'User', name: 'preferences' });
    }
}

export default AddUserPreferences;
```

## Best practices

1. **Always provide a `down` migration.** Even if it just reverses `createTable` with `dropTable`. It pays off the first time a migration needs to be rolled back.
2. **Prefer `bulkSeed` over multiple `seed` calls.** It's one INSERT instead of N.
3. **Test migrations on every target database.** If your app supports MySQL and Postgres, run both sets of migrations in CI.
4. **Keep migrations small and focused.** One logical change per migration file.
5. **Never edit an already-applied migration.** Create a new migration that corrects or rolls back the earlier one.
