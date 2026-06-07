# MasterRecord

[![npm version](https://img.shields.io/npm/v/masterrecord.svg)](https://www.npmjs.com/package/masterrecord)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **ESM only.** As of v1.0, MasterRecord is a pure ESM package. Requires **Node.js 20+** and a host project with `"type": "module"` in `package.json`. There is no CommonJS build.

**MasterRecord** is a lightweight, code-first ORM for Node.js with a fluent query API, comprehensive migrations, and multi-database support. Build type-safe queries with lambda expressions, manage schema changes with CLI-driven migrations, and work seamlessly across MySQL, PostgreSQL, and SQLite.

## Key Features

🔹 **Multi-Database Support** - MySQL, PostgreSQL, SQLite with consistent API
🔹 **Code-First Design** - Define entities in JavaScript, generate schema automatically
🔹 **Fluent Query API** - Lambda-based queries with parameterized placeholders
🔹 **Active Record Pattern** - Entities with `.save()`, `.delete()`, `.reload()` methods
🔹 **Entity Serialization** - `.toObject()` and `.toJSON()` with circular reference protection
🔹 **Lifecycle Hooks** - `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` hooks
🔹 **Business Validation** - Built-in validators (required, email, length, pattern, custom)
🔹 **Bulk Operations** - Efficient `bulkCreate`, `bulkUpdate`, `bulkDelete` APIs
🔹 **Full-Text Search** - Portable `.search()` API on top of SQLite FTS5, Postgres `tsvector`, and MySQL `FULLTEXT`
🔹 **Query Result Caching** - Production-grade in-memory and Redis caching with automatic invalidation
🔹 **Migration System** - CLI-driven migrations with rollback support
🔹 **SQL Injection Protection** - Automatic parameterized queries throughout
🔹 **Field Transformers** - Custom serialization/deserialization for complex types
🔹 **Type Validation** - Runtime type checking and coercion
🔹 **Relationship Mapping** - One-to-many, many-to-one, many-to-many support
🔹 **Seed Data** - Built-in seeding with idempotent operations

## Database Support

| Database   | Version      | Features                                          |
|------------|--------------|---------------------------------------------------|
| PostgreSQL | 9.6+ (12+)   | JSONB, UUID, async/await, connection pooling      |
| MySQL      | 5.7+ (8.0+)  | JSON, async/await, connection pooling, AUTO_INCREMENT |
| SQLite     | 3.x          | Embedded, zero-config, file-based, async API wrapper |

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Database Configuration](#database-configuration)
- [Entity Definitions](#entity-definitions)
- [Querying](#querying)
- [Full-Text Search](#full-text-search)
- [Entity Serialization](#entity-serialization)
  - [.toObject()](#toobjectoptions)
  - [.toJSON()](#tojson)
- [Entity Instance Methods](#entity-instance-methods)
  - [.delete()](#delete)
  - [.reload()](#reload)
  - [.clone()](#clone)
- [Query Helper Methods](#query-helper-methods)
  - [.first()](#first)
  - [.last()](#last)
  - [.exists()](#exists)
  - [.pluck()](#pluckfieldname)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Field Constraints & Indexes](#field-constraints--indexes)
- [Business Logic Validation](#business-logic-validation)
- [Bulk Operations API](#bulk-operations-api)
  - [bulkCreate()](#bulkcreateentityname-data)
  - [bulkUpdate()](#bulkupdateentityname-updates)
  - [bulkDelete()](#bulkdeleteentityname-ids)
- [Composite Indexes](#composite-indexes)
- [Seed Data](#seed-data)
- [Migrations](#migrations)
- [Advanced Features](#advanced-features)
  - [Query Result Caching](#query-result-caching)
  - [Field Transformers](#field-transformers-advanced)
  - [Table Prefixes](#table-prefixes)
  - [Transactions](#transactions-postgresql)
  - [Multi-Context Applications](#multi-context-applications)
  - [Raw SQL Queries](#raw-sql-queries)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Performance Tips](#performance-tips)
- [Security](#security)
- [Best Practices](#best-practices-critical)

---

## ⚠️ Best Practices (CRITICAL)

### 1. Creating Entity Instances

**ALWAYS** use `context.Entity.new()` to create new entity instances:

```javascript
// ✅ CORRECT - Creates proper data instance with getters/setters
const task = this._qaContext.QaTask.new();
const annotation = this._qaContext.QaAnnotation.new();
const project = this._qaContext.QaProject.new();

task.name = "My Task";
task.status = "active";
await db.saveChanges();  // ✅ Saves correctly

// ❌ WRONG - Creates schema definition object with function properties
const task = new QaTask();  // task.name is a FUNCTION, not a property!

task.name = "My Task";  // ❌ Doesn't work - name is a function
await db.saveChanges();  // ❌ Error: "Type mismatch: Expected string, got function"
```

**Why?**
- `new Entity()` creates a **schema definition object** where properties are methods that define the schema
- `context.Entity.new()` creates a **data instance** with proper getters/setters for storing values
- Using `new Entity()` causes runtime errors: `"Type mismatch for Entity.field: Expected integer, got function with value undefined"`

**Error Example:**
```
Error: INSERT failed: Type mismatch for QaTask.name: Expected string, got function with value undefined
    at SQLLiteEngine._buildSQLInsertObjectParameterized
```

**This error means:** You used `new Entity()` instead of `context.Entity.new()`

### 2. Saving Changes - ALWAYS use `await`

**ALWAYS** use `await` when calling `saveChanges()`:

```javascript
// ✅ CORRECT - Waits for database write to complete
await this._qaContext.saveChanges();

// ❌ WRONG - Returns immediately without waiting for database write
this._qaContext.saveChanges();  // Promise never completes!
```

**Why?**
- `saveChanges()` is **async** and returns a Promise
- Without `await`, code continues before database write completes
- Causes **data loss** - appears successful but nothing saves to database
- Results in "phantom saves" - data in memory but not persisted

**Symptoms of missing `await`:**
- API returns success but data not in database
- Queries after save return old/missing data
- Intermittent save failures
- Race conditions

**Repository Pattern - Make Methods Async:**
```javascript
// ✅ CORRECT - Async method with await
async create(entity) {
    this._qaContext.Entity.add(entity);
    await this._qaContext.saveChanges();
    return entity;
}

// ❌ WRONG - Synchronous method calling async saveChanges
create(entity) {
    this._qaContext.Entity.add(entity);
    this._qaContext.saveChanges();  // No await - returns before save completes!
    return entity;  // Returns entity with undefined ID
}
```

### 3. Quick Reference Card

```javascript
// Entity Creation
✅ const user = db.User.new();           // CORRECT
❌ const user = new User();              // WRONG - creates schema object

// Saving Data
✅ await db.saveChanges();               // CORRECT - waits for completion
❌ db.saveChanges();                     // WRONG - fire and forget

// Repository Methods
✅ async create(entity) {                // CORRECT - async method
      await db.saveChanges();
   }
❌ create(entity) {                      // WRONG - sync method
      db.saveChanges();                  // No await!
   }

// Querying (all require await)
✅ const users = await db.User.toList();  // CORRECT
✅ const user = await db.User.findById(1); // CORRECT
❌ const users = db.User.toList();         // WRONG - returns Promise
```

---

## Installation

```bash
# Global installation (recommended for CLI)
npm install -g masterrecord

# Local installation
npm install masterrecord

# With specific database drivers
npm install masterrecord pg           # PostgreSQL
npm install masterrecord mysql2       # MySQL
npm install masterrecord better-sqlite3  # SQLite
```

### Dependencies

MasterRecord includes the following database drivers by default:
- `pg@^8.17.2` - PostgreSQL (async)
- `mysql2@^3.11.5` - MySQL (async with connection pooling)
- `better-sqlite3@^12.6.2` - SQLite (async API wrapper for consistency)

## Two Patterns: Entity Framework & Active Record

MasterRecord supports **both** ORM patterns - choose what feels natural:

### Active Record Style (Recommended for beginners)
```javascript
// Entity saves itself
const user = db.User.findById(1);
user.name = 'Updated';
await user.save();  // ✅ Entity knows how to save
```

### Entity Framework Style (Efficient for batch operations)
```javascript
// Context saves all tracked entities
const user = db.User.findById(1);
user.name = 'Updated';
await db.saveChanges();  // ✅ Batch save
```

**Read more:** [Active Record Pattern Guide](./ACTIVE_RECORD_PATTERN.md) | [Detached Entities Guide](./DETACHED_ENTITIES_GUIDE.md)

---

## Quick Start

### 1. Create a Context

```javascript
// app/models/context.js
import context from 'masterrecord/context';
import User from './User.js';
import Post from './Post.js';

class AppContext extends context {
    constructor() {
        super();

        // Configure database connection
        this.env({
            type: 'postgres',  // or 'mysql', 'sqlite'
            host: 'localhost',
            port: 5432,
            database: 'myapp',
            user: 'postgres',
            password: 'password'
        });

        // Register entities
        this.dbset(User);
        this.dbset(Post);
    }
}

export default AppContext;
```

### 2. Define Entities

```javascript
// app/models/User.js
class User {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };
        this.name = { type: 'string', nullable: false };
        this.email = { type: 'string', nullable: false, unique: true };
        this.age = { type: 'integer', nullable: true };
        this.created_at = { type: 'timestamp', default: 'CURRENT_TIMESTAMP' };
    }
}

export default User;
```

### 3. Run Migrations

```bash
# Enable migrations (one-time setup)
masterrecord enable-migrations AppContext

# Create initial migration
masterrecord add-migration InitialCreate AppContext

# Apply migrations
masterrecord update-database AppContext
```

### 4. Query Your Data

```javascript
import AppContext from './app/models/context.js';
const db = new AppContext();

// Create (Active Record style)
const user = db.User.new();
user.name = 'Alice';
user.email = 'alice@example.com';
user.age = 28;
await user.save();  // Entity saves itself!

// Read with parameterized query
const alice = db.User
    .where(u => u.email == $$, 'alice@example.com')
    .single();

// Update (Active Record style)
alice.age = 29;
await alice.save();  // Entity saves itself!

// Delete
db.remove(alice);
await db.saveChanges();
```

## Database Configuration

### PostgreSQL (Async)

```javascript
class AppContext extends context {
    constructor() {
        super();

        this.env({
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            database: 'myapp',
            user: 'postgres',
            password: 'password',
            max: 20,  // Connection pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000
        });

        this.dbset(User);
    }
}

// Usage requires await
const db = new AppContext();
await db.saveChanges();  // PostgreSQL is async
```

### MySQL (Async with Connection Pooling)

```javascript
class AppContext extends context {
    constructor() {
        super();

        this.env({
            type: 'mysql',
            host: 'localhost',
            port: 3306,
            database: 'myapp',
            user: 'root',
            password: 'password',
            connectionLimit: 10  // Connection pool size (optional)
        });

        this.dbset(User);
    }
}

// Usage requires await (async like PostgreSQL)
const db = new AppContext();
await db.saveChanges();  // MySQL now uses async/await
```

### SQLite (Async API)

```javascript
class AppContext extends context {
    constructor() {
        super();

        this.env({
            type: 'sqlite',
            connection: './data/myapp.db'  // File path
        });

        this.dbset(User);
    }
}

// Usage requires await for consistency across databases
const db = new AppContext();
await db.saveChanges();  // SQLite now has async API wrapper
```

### Environment Files

Store configurations in JSON files:

```json
// config/environments/env.development.json
{
    "type": "postgres",
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "user": "postgres",
    "password": "dev_password"
}
```

```javascript
// Load environment file
class AppContext extends context {
    constructor() {
        super();
        this.env('config/environments');  // Loads env.<NODE_ENV>.json
        this.dbset(User);
    }
}
```

```bash
# Set environment
export NODE_ENV=development
node app.js
```

## Entity Definitions

### Basic Entity

```javascript
class User {
    constructor() {
        // Primary key with auto-increment
        this.id = {
            type: 'integer',
            primary: true,
            auto: true
        };

        // Required string field
        this.name = {
            type: 'string',
            nullable: false
        };

        // Optional field with default
        this.status = {
            type: 'string',
            nullable: true,
            default: 'active'
        };

        // Unique constraint
        this.email = {
            type: 'string',
            unique: true
        };

        // Timestamp
        this.created_at = {
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP'
        };
    }
}
```

### Field Types

| MasterRecord Type | PostgreSQL    | MySQL         | SQLite    |
|-------------------|---------------|---------------|-----------|
| `integer`         | INTEGER       | INT           | INTEGER   |
| `bigint`          | BIGINT        | BIGINT        | INTEGER   |
| `string`          | VARCHAR(255)  | VARCHAR(255)  | TEXT      |
| `text`            | TEXT          | TEXT          | TEXT      |
| `float`           | REAL          | FLOAT         | REAL      |
| `decimal`         | DECIMAL       | DECIMAL       | REAL      |
| `boolean`         | BOOLEAN       | TINYINT       | INTEGER   |
| `date`            | DATE          | DATE          | TEXT      |
| `time`            | TIME          | TIME          | TEXT      |
| `datetime`        | TIMESTAMP     | DATETIME      | TEXT      |
| `timestamp`       | TIMESTAMP     | TIMESTAMP     | TEXT      |
| `json`            | JSON          | JSON          | TEXT      |
| `jsonb`           | JSONB         | JSON          | TEXT      |
| `uuid`            | UUID          | VARCHAR(36)   | TEXT      |
| `binary`          | BYTEA         | BLOB          | BLOB      |

### Relationships

```javascript
class User {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };
        this.name = { type: 'string' };

        // One-to-many: User has many Posts
        this.Posts = {
            type: 'hasMany',
            model: 'Post',
            foreignKey: 'user_id'
        };
    }
}

class Post {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };
        this.title = { type: 'string' };
        this.user_id = { type: 'integer' };

        // Many-to-one: Post belongs to User
        this.User = {
            type: 'belongsTo',
            model: 'User',
            foreignKey: 'user_id'
        };
    }
}
```

### Field Transformers

Store complex JavaScript types in simple database columns:

```javascript
class User {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };

        // Store arrays as JSON strings
        this.tags = {
            type: 'string',
            transform: {
                toDatabase: (value) => {
                    return Array.isArray(value) ? JSON.stringify(value) : value;
                },
                fromDatabase: (value) => {
                    return value ? JSON.parse(value) : [];
                }
            }
        };
    }
}

// Usage is natural
const user = db.User.new();
user.tags = ['admin', 'moderator'];  // Assign array
await db.saveChanges();  // Stored as '["admin","moderator"]'

const loaded = await db.User.findById(user.id);
console.log(loaded.tags);  // ['admin', 'moderator'] - JavaScript array!
```

## Querying

### Basic Queries

```javascript
// Find all (requires await)
const users = await db.User.toList();

// Find by primary key (requires await)
const user = await db.User.findById(123);

// Find single with where clause (requires await)
const alice = await db.User
    .where(u => u.email == $$, 'alice@example.com')
    .single();

// Find multiple with conditions (requires await)
const adults = await db.User
    .where(u => u.age >= $$, 18)
    .toList();
```

### Parameterized Queries

**Always use `$$` placeholders** for SQL injection protection:

```javascript
// Single parameter (requires await)
const user = await db.User.where(u => u.id == $$, 123).single();

// Multiple parameters (requires await)
const results = await db.User
    .where(u => u.age > $$ && u.status == $$, 25, 'active')
    .toList();

// Single $ for OR conditions (requires await)
const results = await db.User
    .where(u => u.status == $ || u.status == null, 'active')
    .toList();
```

### IN Clauses

```javascript
// Array parameter with .includes() (requires await)
const ids = [1, 2, 3, 4, 5];
const users = await db.User
    .where(u => $$.includes(u.id), ids)
    .toList();

// Generated SQL: WHERE id IN ($1, $2, $3, $4, $5)
// PostgreSQL parameters: [1, 2, 3, 4, 5]

// Alternative .any() syntax (requires await)
const users = await db.User
    .where(u => u.id.any($$), [1, 2, 3])
    .toList();

// Comma-separated strings (auto-splits) (requires await)
const users = await db.User
    .where(u => u.id.any($$), "1,2,3,4,5")
    .toList();
```

### Query Chaining

```javascript
let query = db.User;

// Build query dynamically
if (searchTerm) {
    query = query.where(u => u.name.like($$), `%${searchTerm}%`);
}

if (minAge) {
    query = query.where(u => u.age >= $$, minAge);
}

// Add sorting and pagination (requires await)
const users = await query
    .orderBy(u => u.created_at)
    .skip(offset)
    .take(limit)
    .toList();
```

### Ordering

```javascript
// Ascending (requires await)
const users = await db.User
    .orderBy(u => u.name)
    .toList();

// Descending (requires await)
const users = await db.User
    .orderByDescending(u => u.created_at)
    .toList();
```

### Pagination

```javascript
// Skip 20, take 10 (requires await)
const users = await db.User
    .orderBy(u => u.id)
    .skip(20)
    .take(10)
    .toList();

// Page-based pagination (requires await)
const page = 2;
const pageSize = 10;
const users = await db.User
    .skip(page * pageSize)
    .take(pageSize)
    .toList();
```

### Counting

```javascript
// Count all (requires await)
const total = await db.User.count();

// Count with conditions (requires await)
const activeCount = await db.User
    .where(u => u.status == $$, 'active')
    .count();
```

### Complex Queries

```javascript
// Multiple conditions with OR (requires await)
const results = await db.User
    .where(u => (u.status == 'active' || u.status == 'pending') && u.age >= $$, 18)
    .orderBy(u => u.name)
    .toList();

// Nullable checks (requires await)
const usersWithoutEmail = await db.User
    .where(u => u.email == null)
    .toList();

// LIKE queries (requires await)
const matching = await db.User
    .where(u => u.name.like($$), '%john%')
    .toList();
```

## Full-Text Search

Portable full-text search that runs on each engine's native FTS implementation: FTS5 on SQLite, `tsvector` + GIN on PostgreSQL, `FULLTEXT INDEX` on MySQL. Use it when `LIKE` isn't enough — when you want stemming, tokenization, multi-word queries, and ranking.

### Set up the index in a migration

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

### Query

```javascript
const docs = await db.MemoryDoc
    .search({ in: ['title', 'body'], query: 'auth login' })
    .where(d => d.workspace_id == $$, workspaceId)
    .take(10)
    .toList();

// Each row has a __rank field; default ordering is rank descending.
for (const d of docs) console.log(d.__rank, d.title);
```

`.search()` composes with `.where()`, `.take()`, `.skip()`, and `.orderBy()`. Engine-specific query syntax (FTS5's `NEAR` / prefix, Postgres `to_tsquery` operators, MySQL boolean mode), ranking semantics, and engine caveats are documented in [docs/FULL_TEXT_SEARCH.md](./docs/FULL_TEXT_SEARCH.md).

## Migrations

### CLI Commands

```bash
# Enable migrations (one-time per context)
masterrecord enable-migrations AppContext

# Create a migration
masterrecord add-migration MigrationName AppContext

# Apply migrations
masterrecord update-database AppContext

# List migrations
masterrecord get-migrations AppContext

# Multi-context commands
masterrecord enable-migrations-all          # Enable for all contexts
masterrecord add-migration-all Init         # Create migration for all
masterrecord update-database-all            # Apply all pending migrations
```

### Migration File Structure

```javascript
// db/migrations/20250111_143052_CreateUser.js
import masterrecord from 'masterrecord';

class CreateUser extends masterrecord.schema {
    constructor(context) {
        super(context);
    }

    // IMPORTANT: Migrations must be async
    async up(table) {
        await this.init(table);

        // Create table
        await this.createTable(table.User);

        // Seed initial data
        this.seed('User', {
            name: 'Admin',
            email: 'admin@example.com',
            role: 'admin'
        });
    }

    async down(table) {
        await this.init(table);

        // Rollback
        await this.dropTable(table.User);
    }
}

export default CreateUser;
```

### Migration Operations

```javascript
class MyMigration extends masterrecord.schema {
    async up(table) {
        this.init(table);

        // Create table (requires await)
        await this.createTable(table.User);

        // Add column
        schema.addColumn({
            tableName: 'User',
            name: 'phone',
            type: 'string'
        });

        // Alter column
        schema.alterColumn({
            tableName: 'User',
            table: {
                name: 'age',
                type: 'integer',
                nullable: false,
                default: 0
            }
        });

        // Rename column
        schema.renameColumn({
            tableName: 'User',
            name: 'old_name',
            newName: 'new_name'
        });

        // Drop column
        schema.dropColumn({
            tableName: 'User',
            name: 'deprecated_field'
        });

        // Drop table
        schema.dropTable(table.OldTable);
    },

    down: function(table, schema) {
        // Reverse operations
    }
};
```

### Seed Data

```javascript
import masterrecord from 'masterrecord';

class SeedUsers extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.createTable(table.User);

        // Single record
        this.seed('User', {
            name: 'Admin',
            email: 'admin@example.com'
        });

        // Multiple records (efficient bulk insert)
        this.bulkSeed('User', [
            { name: 'Alice', email: 'alice@example.com', age: 25 },
            { name: 'Bob', email: 'bob@example.com', age: 30 },
            { name: 'Charlie', email: 'charlie@example.com', age: 35 }
        ]);
    }

    async down(table) {
        await this.init(table);
        await this.dropTable(table.User);
    }
}

export default SeedUsers;
```

**Seed data is idempotent** - re-running migrations won't create duplicates:
- SQLite: `INSERT OR IGNORE`
- MySQL: `INSERT IGNORE`
- PostgreSQL: `INSERT ... ON CONFLICT DO NOTHING`

## Advanced Features

### Type Validation

MasterRecord validates and coerces field types at runtime:

```javascript
const user = db.User.new();
user.age = "25";  // String assigned to integer field
await db.saveChanges();
// ⚠️  Console: Auto-converting string "25" to integer 25

user.age = "invalid";
await db.saveChanges();
// ❌ Error: Field User.age must be an integer, got string "invalid"
```

### Field Transformers (Advanced)

```javascript
class Post {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };

        // Store array as JSON
        this.tags = {
            type: 'string',
            transform: {
                toDatabase: (v) => Array.isArray(v) ? JSON.stringify(v) : v,
                fromDatabase: (v) => v ? JSON.parse(v) : []
            }
        };

        // PostgreSQL JSONB (native JSON support)
        this.metadata = {
            type: 'jsonb',  // PostgreSQL only
            transform: {
                toDatabase: (v) => JSON.stringify(v || {}),
                fromDatabase: (v) => typeof v === 'string' ? JSON.parse(v) : v
            }
        };
    }
}
```

### Table Prefixes

Useful for multi-tenant applications or plugin systems:

```javascript
class AppContext extends context {
    constructor() {
        super();

        this.tablePrefix = 'myapp_';  // Set before dbset()
        this.env('config/environments');

        this.dbset(User);  // Creates table: myapp_User
        this.dbset(Post);  // Creates table: myapp_Post
    }
}
```

### Transactions (PostgreSQL)

```javascript
import PostgresSyncConnect from 'masterrecord/postgresSyncConnect';

const connection = new PostgresSyncConnect();
await connection.connect(config);

const result = await connection.transaction(async (client) => {
    // Insert user
    const userResult = await client.query(
        'INSERT INTO User (name, email) VALUES ($1, $2) RETURNING id',
        ['Alice', 'alice@example.com']
    );

    // Insert related record
    await client.query(
        'INSERT INTO Profile (user_id, bio) VALUES ($1, $2)',
        [userResult.rows[0].id, 'Software Engineer']
    );

    return userResult.rows[0].id;
});

// Automatically commits on success, rolls back on error
```

### Query Result Caching

MasterRecord includes a **production-grade two-level caching system** similar to Entity Framework and Hibernate. The cache dramatically improves performance by storing query results and automatically invalidating them when data changes.

#### How It Works

```
┌─────────────────────────────────────────────────────┐
│              First-Level Cache (Identity Map)       │
│  - Request-scoped entity tracking                   │
│  - O(1) entity lookup                               │
│  - Already in MasterRecord                          │
└─────────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│       Second-Level Cache (Query Result Cache)       │
│  - Application-wide query result storage            │
│  - Automatic invalidation on data changes           │
│  - In-memory (development) or Redis (production)    │
└─────────────────────────────────────────────────────┘
```

#### Basic Usage (Opt-In, Request-Scoped)

Caching is **opt-in** and **request-scoped** like Active Record. Use `.cache()` to enable caching, and call `endRequest()` to clear:

```javascript
const db = new AppContext();

// DEFAULT: No caching (always hits database)
const user = db.User.findById(1);  // DB query
const user2 = db.User.findById(1);  // DB query again (no cache)

// OPT-IN: Enable caching with .cache()
const categories = await db.Categories.cache().toList();  // DB query, cached
const categories2 = await db.Categories.cache().toList();  // Cache hit! (instant)

// Update invalidates cache automatically
const cat = await db.Categories.findById(1);
cat.name = "Updated";
await db.saveChanges();  // Cache for Categories table cleared

// End request (clears cache - like Active Record)
db.endRequest();  // Cache cleared for next request
```

**Web Application Pattern (Recommended):**
```javascript
// Express middleware - automatic request-scoped caching
app.use((req, res, next) => {
    req.db = new AppContext();

    // Clear cache when response finishes (like Active Record)
    res.on('finish', () => {
        req.db.endRequest();  // Clears query cache
    });

    next();
});

// In your routes
app.get('/categories', async (req, res) => {
    // Cache is fresh for this request
    const categories = await req.db.Categories.cache().toList();
    res.json(categories);
    // Cache auto-cleared after response
});
```

#### Configuration

Configure caching via environment variables:

```bash
# Development (.env)
QUERY_CACHE_TTL=5000               # TTL in milliseconds (5000ms = 5 seconds - request-scoped)
QUERY_CACHE_SIZE=1000              # Max cache entries (default: 1000)
QUERY_CACHE_ENABLED=true           # Enable/disable globally (default: true)

# Production (.env)
QUERY_CACHE_TTL=5                  # Redis uses seconds (5 seconds default)
REDIS_URL=redis://localhost:6379  # Use Redis for distributed caching
```

**Note:**
- Cache is **opt-in per query** using `.cache()`
- Default TTL is **5 seconds** (request-scoped like Active Record)
- Call `db.endRequest()` to clear cache manually (recommended in middleware)
- Environment variables control the cache system globally

#### Enable Caching for Specific Queries

Use `.cache()` for frequently accessed, rarely changed data:

```javascript
// DEFAULT: Always hits database (safe)
const liveData = await db.Analytics
    .where(a => a.date == $$, today)
    .toList();  // No caching (default)

// OPT-IN: Cache reference data
const categories = await db.Categories.cache().toList();  // Cached for 5 seconds (default TTL)
const settings = await db.Settings.cache().toList();  // Cached
const countries = await db.Countries.cache().toList();  // Cached

// When to use .cache():
// ✅ Reference data (categories, settings, countries)
// ✅ Rarely changing data (roles, permissions)
// ✅ Expensive aggregations with stable results
// ❌ User-specific data
// ❌ Real-time data
// ❌ Financial/critical data
```

#### Manual Cache Control

```javascript
const db = new AppContext();

// Check cache performance
const stats = db.getCacheStats();
console.log(stats);
// {
//   size: 45,
//   maxSize: 1000,
//   hits: 234,
//   misses: 67,
//   hitRate: '77.74%',
//   enabled: true
// }

// Clear cache manually
db.clearQueryCache();

// Disable caching temporarily
db.setQueryCacheEnabled(false);
const freshData = await db.User.toList();
db.setQueryCacheEnabled(true);
```

#### Redis-Based Distributed Caching (Production)

For multi-process or clustered deployments, use Redis:

```javascript
import { createClient } from 'redis';
import RedisQueryCache from 'masterrecord/Cache/RedisQueryCache';

class AppContext extends context {
    constructor() {
        super();

        // Use Redis cache in production
        if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
            const redisClient = redis.createClient(process.env.REDIS_URL);
            this._queryCache = new RedisQueryCache(redisClient, {
                ttl: 300,  // 5 minutes (seconds for Redis)
                prefix: 'myapp:'
            });
        }
        // In-memory cache used automatically in development

        this.dbset(User);
    }
}
```

**Benefits of Redis cache:**
- Shared across processes (horizontally scalable)
- Pub/sub invalidation (cache stays consistent)
- Two-level cache (L1 in-memory + L2 Redis)
- Automatic failover to database on Redis errors

#### Cache Invalidation Strategy

MasterRecord automatically invalidates cache entries when data changes:

```javascript
// Query with caching enabled
const categories = await db.Categories.cache().toList();  // DB query, cached

// Any modification to Categories table invalidates ALL cached Category queries
const cat = await db.Categories.findById(1);
cat.name = "Updated";
await db.saveChanges();  // Invalidates all cached Categories queries

// Next cached query hits database (fresh data)
const categoriesAgain = await db.Categories.cache().toList();  // DB query (cache cleared)

// Non-cached queries are unaffected (always fresh)
const users = await db.User.toList();  // No .cache() = always DB query

// Queries for OTHER tables' caches are unaffected
const settings = await db.Settings.cache().toList();  // Still cached (different table)
```

**Invalidation rules:**
- `INSERT` invalidates all queries for that table
- `UPDATE` invalidates all queries for that table
- `DELETE` invalidates all queries for that table
- Queries for other tables are not affected

#### Performance Impact

Expected performance improvements:

| Scenario | Without Cache | With Cache | Improvement |
|----------|---------------|------------|-------------|
| Single query (100 calls) | 100 DB queries | 1 DB + 99 cache | **99% faster** |
| List query (50 calls) | 50 DB queries | 1 DB + 49 cache | **98% faster** |
| Reference data (1000 calls) | 1000 DB queries | 1 DB + 999 cache | **99.9% faster** |
| Mixed operations | Baseline | 70-90% hit rate | **3-10x faster** |

**Memory usage:** ~1KB per cached query (1000 entries ≈ 1MB)

#### Best Practices

**DO use .cache():**
```javascript
// Reference data (rarely changes)
const categories = await db.Categories.cache().toList();
const settings = await db.Settings.cache().toList();
const countries = await db.Countries.cache().toList();

// Expensive aggregations (stable results)
const totalRevenue = await db.Orders
    .where(o => o.year == $$, 2024)
    .cache()
    .count();
```

**DON'T use .cache():**
```javascript
// User-specific data (default is safe - no caching)
const user = await db.User.findById(userId);  // Always fresh

// Real-time data (default is safe)
const liveOrders = await db.Orders
    .where(o => o.status == $$, 'pending')
    .toList();  // Always fresh

// Financial transactions (default is safe)
const balance = await db.Transactions
    .where(t => t.user_id == $$, userId)
    .toList();  // Always fresh

// User-specific sensitive data (default is safe)
const permissions = await db.UserPermissions
    .where(p => p.user_id == $$, userId)
    .toList();  // Always fresh
```

#### Monitoring Cache Performance

```javascript
// Log cache stats periodically
setInterval(() => {
    const stats = db.getCacheStats();
    console.log(`Cache: ${stats.hitRate} hit rate, ${stats.size}/${stats.maxSize} entries`);
}, 60000);

// Watch for low hit rates (< 50% might indicate poor cache strategy)
if (parseFloat(stats.hitRate) < 50) {
    console.warn('Cache hit rate is low, consider tuning cache TTL or size');
}
```

#### Request-Scoped Caching (Like Active Record)

MasterRecord's caching is designed to work like Active Record - **cache within a request, clear after**:

```javascript
// Express middleware pattern (recommended)
app.use((req, res, next) => {
    req.db = new AppContext();

    // Automatically clear cache when request ends
    res.on('finish', () => {
        req.db.endRequest();  // Like Active Record's cache clearing
    });

    next();
});

// In routes - cache is fresh per request
app.get('/api/categories', async (req, res) => {
    // First call in this request - DB query
    const categories = await req.db.Categories.cache().toList();

    // Second call in same request - cache hit
    const categoriesAgain = await req.db.Categories.cache().toList();

    res.json(categories);
    // After response, cache is automatically cleared
});

// Next request starts with empty cache (fresh)
```

**Why request-scoped?**
- ✅ Like Active Record - familiar pattern
- ✅ No stale data across requests
- ✅ Cache only lives during request processing
- ✅ Automatic cleanup

#### Important: Shared Cache Behavior

**The cache is shared across all context instances of the same class.** This ensures consistency within a request:

```javascript
const db1 = new AppContext();
const db2 = new AppContext();

// Context 1: Cache data with .cache()
const categories1 = await db1.Categories.cache().toList();  // DB query, cached

// Context 2: Sees cached data
const categories2 = await db2.Categories.cache().toList();  // Cache hit!

// Context 2: Updates invalidate cache for BOTH contexts
const cat = await db2.Categories.findById(1);
cat.name = "Updated";
await db2.saveChanges();  // Invalidates shared cache

// Context 1: Sees fresh data
const categories3 = await db1.Categories.cache().toList();  // Cache miss, fresh data
console.log(categories3[0].name);  // "Updated"
```

**Why shared cache?**
- ✅ Prevents stale data across multiple context instances
- ✅ Ensures all parts of your application see consistent data
- ✅ Reduces memory usage (one cache instead of many)
- ✅ Correct behavior for single-database applications (most use cases)

### Multi-Context Applications

Manage multiple databases in one application:

```javascript
// contexts/userContext.js
class UserContext extends context {
    constructor() {
        super();
        this.env({ type: 'postgres', database: 'users_db', ... });
        this.dbset(User);
        this.dbset(Profile);
    }
}

// contexts/analyticsContext.js
class AnalyticsContext extends context {
    constructor() {
        super();
        this.env({ type: 'postgres', database: 'analytics_db', ... });
        this.dbset(Event);
        this.dbset(Metric);
    }
}

// Usage
const userDb = new UserContext();
const analyticsDb = new AnalyticsContext();

const user = await userDb.User.findById(123);
const event = analyticsDb.Event.new();
event.log('user_login', user.id);
await analyticsDb.saveChanges();
```

```bash
# Migrate all contexts at once
masterrecord update-database-all
```

### Raw SQL Queries

For SQL the query builder can't express, use the **engine-agnostic** escape hatch `db.query(sql, params)` (alias `db.execute(sql, params)`). It works the same on SQLite, MySQL, and PostgreSQL and returns an **array of row objects** for row-returning statements:

```javascript
// SELECT → array of rows (all engines)
const users = await db.query(
    'SELECT * FROM "User" WHERE age > $1 AND status = $2',   // Postgres: $1,$2
    [25, 'active']
);
// SQLite / MySQL use ? placeholders:
const users = await db.query('SELECT * FROM User WHERE age > ? AND status = ?', [25, 'active']);

// Writes — reads naturally as execute() (works on every engine)
await db.execute('UPDATE Step SET run_id = ? WHERE id = ?', ['run_x', 1]);
```

> **Do not reach into `db.db`.** That is the *raw, engine-specific driver* — `db.db.prepare()` is better-sqlite3's synchronous API and does **not** exist on mysql2/pg, so code written against it works on SQLite and breaks on MySQL/Postgres. (On a non-SQLite engine, `db.db.prepare()` now throws a descriptive error pointing you here.) Prefer the ORM (`db.User.where(...).toList()`); use `db.query()` only when you must.

Placeholders are engine-native (`?` for SQLite/MySQL, `$1,$2,…` for Postgres) — `query()` passes them straight through, so a raw statement is as portable as the SQL you write. For fully portable code, prefer the query builder.

## API Reference

### Context Methods

```javascript
// Entity registration
context.dbset(EntityClass)
context.dbset(EntityClass, 'custom_table_name')

// Save changes (all databases now async)
await context.saveChanges()  // PostgreSQL, MySQL, SQLite (all async)

// Add/Remove entities
context.EntityName.add(entity)
context.remove(entity)

// Attach detached entities (like Entity Framework's Update())
context.attach(entity)                        // Attach and mark as modified
context.attach(entity, { field: value })      // Attach with specific changes
context.attachAll([entity1, entity2])         // Attach multiple entities
await context.update('Entity', id, changes)   // Update by primary key

// Engine-agnostic raw SQL (escape hatch — prefer the query builder)
await context.query(sql, params)              // raw SQL → array of rows (all engines)
await context.execute(sql, params)            // alias; reads naturally for writes

// Cache management
context.getCacheStats()              // Get cache statistics
context.clearQueryCache()            // Clear all cached queries
context.endRequest()                 // End request and clear cache (like Active Record)
context.setQueryCacheEnabled(bool)   // Enable/disable caching
```

### Query Methods

```javascript
// Chainable query builders (do not execute query)
.where(query, ...params)         // Add WHERE condition
.and(query, ...params)           // Add AND condition
.orderBy(field)                  // Sort ascending
.orderByDescending(field)        // Sort descending
.skip(number)                    // Skip N records
.take(number)                    // Limit to N records
.include(relationship)           // Eager load
.cache()                         // Enable caching for this query (opt-in)

// Terminal methods (execute query - ALL REQUIRE AWAIT)
await .toList()                  // Return array of all records
await .single()                  // Return one or null
await .first()                   // Return first or null
await .count()                   // Return count
await .any()                     // Return boolean

// Convenience methods (REQUIRE AWAIT)
await .findById(id)              // Find by primary key
.new()                           // Create new entity instance (synchronous)

// Entity methods (Active Record style - REQUIRE AWAIT)
await entity.save()              // Save this entity (and all tracked changes)
await entity.delete()            // Delete this entity
await entity.reload()            // Reload from database, discarding changes
entity.clone()                   // Create a copy for duplication (synchronous)
entity.toObject(options)         // Convert to plain JavaScript object (synchronous)
entity.toJSON()                  // JSON.stringify compatibility (synchronous)
```

---

## Entity Serialization

### .toObject(options)

Convert a MasterRecord entity to a plain JavaScript object, removing all internal properties and handling circular references automatically.

**Parameters:**
- `options.includeRelationships` (boolean, default: `true`) - Include related entities
- `options.depth` (number, default: `1`) - Maximum depth for relationship traversal

**Examples:**

```javascript
// Basic usage - get plain object
const user = await db.User.findById(1);
const plain = user.toObject();
console.log(plain);
// { id: 1, name: 'Alice', email: 'alice@example.com', age: 28 }

// Include relationships
const userWithPosts = user.toObject({ includeRelationships: true });
console.log(userWithPosts);
// {
//   id: 1,
//   name: 'Alice',
//   Posts: [
//     { id: 10, title: 'First Post', content: '...' },
//     { id: 11, title: 'Second Post', content: '...' }
//   ]
// }

// Control relationship depth
const deep = user.toObject({ includeRelationships: true, depth: 3 });

// Exclude relationships
const shallow = user.toObject({ includeRelationships: false });
```

**Circular Reference Protection:**

`.toObject()` automatically prevents infinite loops from circular references:

```javascript
// Scenario: User → Posts → User creates a cycle
const user = await db.User.findById(1);
await user.Posts;  // Load posts relationship

const plain = user.toObject({ includeRelationships: true, depth: 2 });
// Circular references marked as:
// { __circular: true, __entityName: 'User', id: 1 }
```

**Why It's Needed:**

MasterRecord entities have internal properties that cause `JSON.stringify()` to fail:

```javascript
const user = await db.User.findById(1);

// ❌ FAILS: TypeError: Converting circular structure to JSON
JSON.stringify(user);

// ✅ WORKS: Use toObject() or toJSON()
const plain = user.toObject();
JSON.stringify(plain);  // Success!
```

### .toJSON()

Used automatically by `JSON.stringify()` and Express `res.json()`. Returns the same as `.toObject({ includeRelationships: false })`.

**Examples:**

```javascript
// JSON.stringify automatically calls toJSON()
const user = await db.User.findById(1);
const json = JSON.stringify(user);
console.log(json);
// '{"id":1,"name":"Alice","email":"alice@example.com"}'

// Express automatically uses toJSON()
app.get('/api/users/:id', async (req, res) => {
    const user = await db.User.findById(req.params.id);
    res.json(user);  // ✅ Works automatically!
});

// Array of entities
app.get('/api/users', async (req, res) => {
    const users = await db.User.toList();
    res.json(users);  // ✅ Each entity's toJSON() called automatically
});
```

---

## Entity Instance Methods

### .delete()

Delete an entity without manually calling `context.remove()` and `context.saveChanges()`.

**Example:**

```javascript
// Before
const user = await db.User.findById(1);
db.remove(user);
await db.saveChanges();

// After (Active Record style)
const user = await db.User.findById(1);
await user.delete();  // ✅ Entity deletes itself
```

**Cascade Deletion:**

If your entity has cascade delete rules, they will be applied automatically:

```javascript
class User {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };

        // Posts will be deleted when user is deleted
        this.Posts = {
            type: 'hasMany',
            model: 'Post',
            foreignKey: 'user_id',
            cascade: true  // Enable cascade delete
        };
    }
}

const user = await db.User.findById(1);
await user.delete();  // ✅ Also deletes related Posts automatically
```

### .reload()

Refresh an entity from the database, discarding any unsaved changes.

**Example:**

```javascript
const user = await db.User.findById(1);
console.log(user.name);  // 'Alice'

user.name = 'Modified';
console.log(user.name);  // 'Modified'

await user.reload();  // ✅ Fetch fresh data from database
console.log(user.name);  // 'Alice' - changes discarded
```

**Use Cases:**
- Discard unsaved changes
- Refresh stale data after external updates
- Synchronize after concurrent modifications
- Reset entity to clean state

### .clone()

Create a copy of an entity for duplication (primary key excluded).

**Example:**

```javascript
const user = await db.User.findById(1);
const duplicate = user.clone();

duplicate.name = 'Copy of ' + user.name;
duplicate.email = 'copy@example.com';

await duplicate.save();
console.log(duplicate.id);  // ✅ New ID (different from original)
```

**Notes:**
- Primary key is automatically excluded
- Relationships are not cloned (set manually if needed)
- Useful for templates and duplicating records

---

## Query Helper Methods

### .first()

Get the first record ordered by primary key.

**Example:**

```javascript
// Automatically orders by primary key
const firstUser = await db.User.first();

// With custom order (respects existing orderBy)
const newestUser = await db.User
    .orderByDescending(u => u.created_at)
    .first();

// With conditions
const firstActive = await db.User
    .where(u => u.status == $$, 'active')
    .first();
```

### .last()

Get the last record ordered by primary key (descending).

**Example:**

```javascript
const lastUser = await db.User.last();

// With custom order
const oldestUser = await db.User
    .orderBy(u => u.created_at)
    .last();
```

### .exists()

Check if any records match the query (returns boolean).

**Example:**

```javascript
// Before
const count = await db.User
    .where(u => u.email == $$, 'test@example.com')
    .count();
const exists = count > 0;

// After
const exists = await db.User
    .where(u => u.email == $$, 'test@example.com')
    .exists();

if (exists) {
    throw new Error('Email already registered');
}

// Check if any users exist
const hasUsers = await db.User.exists();
if (!hasUsers) {
    // Create default admin user
}
```

### .pluck(fieldName)

Extract a single column as an array.

**Example:**

```javascript
// Get all active user emails
const emails = await db.User
    .where(u => u.status == $$, 'active')
    .pluck('email');
console.log(emails);
// ['alice@example.com', 'bob@example.com', 'charlie@example.com']

// Get all user IDs
const ids = await db.User.pluck('id');
console.log(ids);  // [1, 2, 3, 4, 5]

// With sorting
const recentEmails = await db.User
    .orderByDescending(u => u.created_at)
    .take(10)
    .pluck('email');
```

---

## Lifecycle Hooks

Add lifecycle hooks to your entity definitions to execute logic before/after database operations.

**Available Hooks:**
- `beforeSave()` - Execute before insert or update
- `afterSave()` - Execute after insert or update
- `beforeDelete()` - Execute before deletion
- `afterDelete()` - Execute after deletion

**Example:**

```javascript
import bcrypt from 'bcrypt';

class User {
    constructor() {
        this.id = { type: 'integer', primary: true, auto: true };
        this.email = { type: 'string' };
        this.password = { type: 'string' };
        this.created_at = { type: 'timestamp' };
        this.updated_at = { type: 'timestamp' };
        this.role = { type: 'string' };
    }

    // Hash password before saving
    beforeSave() {
        // Only hash if password was changed
        if (this.__dirtyFields.includes('password')) {
            this.password = bcrypt.hashSync(this.password, 10);
        }
    }

    // Set timestamps automatically
    beforeSave() {
        if (this.__state === 'insert') {
            this.created_at = new Date();
        }
        this.updated_at = new Date();
    }

    // Log after successful save
    afterSave() {
        console.log(`User ${this.id} saved successfully`);
    }

    // Prevent deleting admin users
    beforeDelete() {
        if (this.role === 'admin') {
            throw new Error('Cannot delete admin user');
        }
    }

    // Cleanup related data after deletion
    async afterDelete() {
        console.log(`User ${this.id} deleted, cleaning up related data...`);
        // Cleanup logic here (e.g., delete user files, clear cache)
    }
}
```

**Usage:**

```javascript
// Hooks execute automatically during save
const user = db.User.new();
user.email = 'alice@example.com';
user.password = 'plain-text-password';
await user.save();
// ✅ beforeSave() hashes password automatically
// ✅ afterSave() logs success message

// Load and update
const user = await db.User.findById(1);
user.email = 'newemail@example.com';
await user.save();
// ✅ beforeSave() sets updated_at timestamp
// ✅ Password not re-hashed (not in dirtyFields)

// Hooks can prevent operations
const admin = await db.User.where(u => u.role == $$, 'admin').single();
try {
    await admin.delete();
} catch (error) {
    console.log(error.message);  // "Cannot delete admin user"
}
// ✅ beforeDelete() prevented deletion
```

**Hook Execution Order:**

```javascript
// Insert:
// 1. beforeSave()
// 2. SQL INSERT
// 3. afterSave()

// Update:
// 1. beforeSave()
// 2. SQL UPDATE
// 3. afterSave()

// Delete:
// 1. beforeDelete()
// 2. SQL DELETE
// 3. afterDelete()
```

**Notes:**
- Hooks can be async (use `async` keyword)
- Exceptions in `before*` hooks prevent the operation
- Hooks execute for each entity during batch operations
- Access entity state via `this.__state` ('insert', 'modified', 'delete')
- Access changed fields via `this.__dirtyFields` array

---

## Field Constraints & Indexes

Define database constraints and performance indexes using the fluent API:

```javascript
class User {
    id(db) {
        db.integer().primary().auto();
    }

    email(db) {
        db.string()
          .notNullable()
          .unique()
          .index();  // Creates performance index
    }

    username(db) {
        db.string()
          .notNullable()
          .index('idx_username_custom');  // Custom index name
    }

    status(db) {
        db.string().nullable();
    }

    created_at(db) {
        db.timestamp().default('CURRENT_TIMESTAMP');
    }
}
```

### Available Constraint Methods

- `.notNullable()` - Column cannot be NULL
- `.nullable()` - Column can be NULL (default)
- `.unique()` - Unique constraint (enforces uniqueness at DB level)
- `.index()` - Creates performance index (auto-generated name: `idx_tablename_columnname`)
- `.index('custom_name')` - Creates index with custom name
- `.primary()` - Primary key (automatically indexed)
- `.default(value)` - Default value

### Index vs Unique Constraint

**Understanding the difference:**

- `.unique()` creates a UNIQUE constraint (prevents duplicate values, enforces data integrity)
- `.index()` creates a performance index (improves query speed, allows duplicates)
- You can use both together: `.unique().index()` creates a unique index for both integrity and performance

**Examples:**

```javascript
// Email must be unique (no performance index)
email(db) {
    db.string().notNullable().unique();
}

// Username indexed for fast lookups (allows duplicates)
username(db) {
    db.string().notNullable().index();
}

// Email with both unique constraint AND performance index
email(db) {
    db.string().notNullable().unique().index();
}
```

### Automatic Index Migration

When you add `.index()` to a field, MasterRecord automatically generates migration code:

```javascript
// In your entity
class User {
    email(db) {
        db.string().notNullable().index();
    }
}

// Generated migration (automatic)
class Migration_20250101 extends masterrecord.schema {
    async up(table) {
        this.init(table);
        this.createIndex({
            tableName: 'User',
            columnName: 'email',
            indexName: 'idx_user_email'
        });
    }

    async down(table) {
        this.init(table);
        this.dropIndex({
            tableName: 'User',
            columnName: 'email',
            indexName: 'idx_user_email'
        });
    }
}
```

**Rollback support:**

Migrations automatically include rollback logic. Running `masterrecord migrate down` will drop all indexes created by that migration.

---

## Composite Indexes

Create multi-column indexes for queries that filter or sort on multiple columns together.

### API - Two Ways to Define

**Option A: Entity Class (Recommended for core indexes)**

```javascript
class CreditLedger {
    id(db) {
        db.integer().primary().auto();
    }

    organization_id(db) {
        db.integer().notNullable();
    }

    created_at(db) {
        db.timestamp().default('CURRENT_TIMESTAMP');
    }

    resource_type(db) {
        db.string().notNullable();
    }

    resource_id(db) {
        db.integer().notNullable();
    }

    // Define composite indexes in entity
    static compositeIndexes = [
        // Simple array - auto-generates name
        ['organization_id', 'created_at'],
        ['resource_type', 'resource_id'],

        // With custom name
        {
            columns: ['status', 'created_at'],
            name: 'idx_status_timeline'
        },

        // Unique composite index
        {
            columns: ['email', 'tenant_id'],
            unique: true
        }
    ];
}
```

**Option C: Context-Level (For environment-specific or centralized schema)**

```javascript
class AppContext extends context {
    onConfig() {
        this.dbset(CreditLedger);

        // Define composite indexes in context
        this.compositeIndex(CreditLedger, ['organization_id', 'created_at']);
        this.compositeIndex(CreditLedger, ['resource_type', 'resource_id']);
        this.compositeIndex(CreditLedger, ['status', 'created_at'], {
            name: 'idx_status_timeline'
        });
        this.compositeIndex(CreditLedger, ['email', 'tenant_id'], {
            unique: true
        });

        // Can also use table name as string
        this.compositeIndex('CreditLedger', ['user_id', 'created_at']);
    }
}
```

**Combined Usage (Best of Both)**

```javascript
class User {
    email(db) { db.string(); }
    tenant_id(db) { db.integer(); }
    last_name(db) { db.string(); }
    first_name(db) { db.string(); }

    // Core indexes in entity
    static compositeIndexes = [
        ['last_name', 'first_name']
    ];
}

class AppContext extends context {
    onConfig() {
        this.dbset(User);

        // Add tenant-specific index for multi-tenant deployments
        if (process.env.MULTI_TENANT === 'true') {
            this.compositeIndex(User, ['tenant_id', 'email'], { unique: true });
        }

        // Add performance index for production
        if (process.env.NODE_ENV === 'production') {
            this.compositeIndex(User, ['tenant_id', 'last_name']);
        }
    }
}
```

### When to Use Composite Indexes

Composite indexes are most effective for queries that:
1. **Filter on multiple columns**: `WHERE org_id = ? AND status = ?`
2. **Filter and sort**: `WHERE status = ? ORDER BY created_at`
3. **Enforce uniqueness**: Unique constraint on multiple columns together

**Example queries that benefit:**

```javascript
// Benefits from composite index (organization_id, created_at)
const ledger = await db.CreditLedger
    .where(c => c.organization_id == $$, orgId)
    .orderBy(c => c.created_at)
    .toList();

// Benefits from composite index (resource_type, resource_id)
const entry = await db.CreditLedger
    .where(c => c.resource_type == $$ && c.resource_id == $$, 'Order', 123)
    .single();
```

### Column Order Matters

The order of columns in a composite index affects query performance:

```javascript
static compositeIndexes = [
    // Index: (status, created_at)
    ['status', 'created_at']
];

// ✅ FAST: Uses index efficiently
// WHERE status = ? ORDER BY created_at
await db.Orders
    .where(o => o.status == $$, 'pending')
    .orderBy(o => o.created_at)
    .toList();

// ⚠️ SLOWER: Can only use first column
// WHERE created_at > ?
await db.Orders
    .where(o => o.created_at > $$, yesterday)
    .toList();
```

**Rule of thumb:** Put the most selective (filtered) columns first, then sort columns.

### Automatic Migration Generation

```javascript
// Your entity definition triggers migration
class CreditLedger {
    organization_id(db) { db.integer(); }
    created_at(db) { db.timestamp(); }

    static compositeIndexes = [
        ['organization_id', 'created_at']
    ];
}

// Generated migration (automatic)
class Migration_20250101 extends masterrecord.schema {
    async up(table) {
        this.init(table);
        this.createCompositeIndex({
            tableName: 'CreditLedger',
            columns: ['organization_id', 'created_at'],
            indexName: 'idx_creditleger_organization_id_created_at',
            unique: false
        });
    }

    async down(table) {
        this.init(table);
        this.dropCompositeIndex({
            tableName: 'CreditLedger',
            columns: ['organization_id', 'created_at'],
            indexName: 'idx_creditleger_organization_id_created_at',
            unique: false
        });
    }
}
```

### Single vs Composite Indexes

```javascript
class User {
    email(db) {
        db.string().index();  // Single-column index
    }

    first_name(db) {
        db.string();  // Part of composite below
    }

    last_name(db) {
        db.string();  // Part of composite below
    }

    static compositeIndexes = [
        // Composite index for name lookups
        ['last_name', 'first_name']
    ];
}
```

**When to use single vs composite:**
- **Single index**: Column queried independently (`WHERE email = ?`)
- **Composite index**: Columns queried together (`WHERE last_name = ? AND first_name = ?`)

### Partial / Filtered Indexes

Add a `where` predicate to index on (and enforce uniqueness over) only the rows that match — the same capability as EF Core's `HasFilter`, TypeORM/Sequelize `where`, Rails `:where`, and Django `condition`.

The canonical use is **one-default-per-scope** — at most one `is_default = 1` row per `scope_id`, enforced by the database:

```javascript
// Declaratively, on the context:
class AppContext extends context {
    onConfig() {
        this.dbset(Setting);
        this.compositeIndex(Setting, ['scope_id'], {
            unique: true,
            where: 'is_default = 1',   // raw SQL predicate
            name: 'one_default_per_scope',
        });
    }
}

// Or in a hand-written migration:
await this.createCompositeIndex({
    tableName: 'Setting',
    columns: ['scope_id'],
    indexName: 'one_default_per_scope',
    unique: true,
    where: 'is_default = 1',
});
// single-column form: this.createIndex({ tableName, columnName, indexName, unique: true, where })
```

Other common uses: unique email among non-deleted rows (`where: 'deleted_at IS NULL'`), indexing only active records (`where: 'status = \'active\''`).

| Engine | Behavior |
| --- | --- |
| PostgreSQL | native partial index (`CREATE UNIQUE INDEX … WHERE …`) |
| SQLite | native partial index (3.8+) |
| MySQL | **not supported** — MySQL has no partial indexes. masterrecord **throws** at migration time (rather than silently creating a non-filtered index that would enforce the wrong constraint). Enforce the invariant in the write path (a transactional clear-then-set) or use a generated column. |

> `where` is a **raw SQL predicate** authored by you (like table/column names), not a place for user input.

---

## Seed Data

Define seed data in your context file that automatically generates migration code using the ORM.

### Context-Level Seed API (Recommended)

```javascript
class AppContext extends context {
    onConfig() {
        // Single seed record
        this.dbset(User).seed({
            user_name: 'admin',
            first_name: 'System',
            last_name: 'Administrator',
            email: 'admin@bookbag.ai',
            system_role: 'system_admin',
            admin_type: 'engineering',
            onboarding_completed: 1,
            availability_status: 'online'
        });

        // Chain multiple records
        this.dbset(Post)
            .seed({ title: 'Welcome', content: 'Hello world', author_id: 1 })
            .seed({ title: 'Getting Started', content: 'Tutorial', author_id: 1 });

        // Bulk seed with array
        this.dbset(Category).seed([
            { name: 'Technology', slug: 'tech' },
            { name: 'Business', slug: 'biz' },
            { name: 'Science', slug: 'science' }
        ]);
    }
}
```

### Automatic Migration Generation

When you define seed data on the context, `add-migration` compiles it into idempotent `this.seed(...)` calls in the generated migration:

```javascript
// Your context definition triggers this migration
class Migration_20250205_123456 extends masterrecord.schema {
    async up(table) {
        await this.init(table);

        // Generated idempotent seed calls — INSERT OR IGNORE (SQLite) /
        // INSERT IGNORE (MySQL) / ON CONFLICT DO NOTHING (PostgreSQL)
        await this.seed('User', {
            user_name: 'admin',
            first_name: 'System',
            last_name: 'Administrator',
            email: 'admin@bookbag.ai',
            system_role: 'system_admin',
            admin_type: 'engineering',
            onboarding_completed: 1,
            availability_status: 'online'
        });

        await this.seed('Post', { title: 'Welcome', content: 'Hello world', author_id: 1 });
        await this.seed('Post', { title: 'Getting Started', content: 'Tutorial', author_id: 1 });
    }

    async down(table) {
        await this.init(table);
        // Seed data typically not removed in down migrations
    }
}
```

### Benefits of context-level seed

1. **Declarative**: seed data lives with your context definition and is versioned alongside the schema.
2. **Idempotent**: the generated `this.seed()` calls use the engine's insert-or-ignore form, so re-running migrations never duplicates rows or errors on an existing key.
3. **Environment-aware**: scope seeds with `.when(env)`, and use upsert / `seedFactory` for generated data.

> **Note:** generated seeds are raw parameterized INSERTs (via `this.seed()`), so they do **not** run entity lifecycle hooks (`beforeSave`/`afterSave`) or validators. If you need those to run on seeded rows, insert them through `context.Entity.new()` + `save()` in application code instead.

### Manual Seed Methods (Advanced)

For more control, use raw SQL seed methods directly in migrations:

```javascript
class Migration_20250205_123456 extends masterrecord.schema {
    async up(table) {
        this.init(table);

        // Single record with raw SQL
        this.seed('User', {
            user_name: 'admin',
            email: 'admin@bookbag.ai'
        });

        // Bulk insert with raw SQL (more performant for large datasets)
        this.bulkSeed('Category', [
            { name: 'Technology', slug: 'tech' },
            { name: 'Business', slug: 'biz' },
            { name: 'Science', slug: 'science' }
        ]);
    }
}
```

**When to use manual seed methods:**
- Large datasets (1000+ records) - `bulkSeed()` is more performant
- Need raw SQL control
- Don't need lifecycle hooks or validation

### Idempotency

**Both** routes are idempotent — context-level seed compiles to `this.seed()`, and `this.seed()` emits the engine's insert-or-ignore form:
- SQLite: `INSERT OR IGNORE INTO`
- MySQL: `INSERT IGNORE INTO`
- PostgreSQL: `INSERT ... ON CONFLICT DO NOTHING`

Re-running a migration never creates duplicates or throws on an existing primary key, so you do **not** need to remove seed data after the first run.

```javascript
// Context-level (declarative) — generated into a this.seed() migration
this.dbset(User).seed({ id: 1, name: 'admin' });

// Manual (in a migration) — identical idempotent behavior
class Migration_xyz extends masterrecord.schema {
    async up(table) {
        await this.init(table);
        await this.seed('User', { id: 1, name: 'admin' }); // safe to re-run
    }
}
```

Idempotency relies on a primary key or unique constraint on the target table — that's what the engine's ignore/conflict clause keys on.

### Best Practices

1. **Use context-level seed** for declarative bootstrap data (admin users, default categories, lookup tables) you want versioned with the schema.
2. **Use manual `this.seed()` / `this.bulkSeed()`** when you want the seed written explicitly in a specific migration; `bulkSeed` is one INSERT, so prefer it for large datasets.
3. **Both are idempotent** — safe to leave in place and re-run; no need to delete after the first deploy.
4. **Keep seed data minimal** - only essential bootstrap data.
5. **Use fixtures/factories** for test data, not seed methods.
6. **Don't delete seed data** in down migrations (can cause referential integrity issues).
7. If you need lifecycle hooks/validators to run on seeded rows, insert via `context.Entity.new()` + `save()` in app code rather than `seed()`.

### Example: Multi-Tenant Seed Data

```javascript
class AppContext extends context {
    onConfig() {
        this.dbset(User);
        this.dbset(Tenant);
        this.dbset(Permission);

        // Seed default tenant
        this.dbset(Tenant).seed({
            name: 'Default Organization',
            slug: 'default',
            is_active: 1
        });

        // Seed system admin
        this.dbset(User).seed({
            email: 'admin@system.com',
            tenant_id: 1,
            role: 'system_admin'
        });

        // Seed default permissions
        this.dbset(Permission).seed([
            { name: 'users.read', description: 'Read users' },
            { name: 'users.write', description: 'Create/update users' },
            { name: 'users.delete', description: 'Delete users' }
        ]);
    }
}
```

---

## Advanced Seed Data Features

MasterRecord provides 5 enterprise-grade seed data enhancements for production-ready data management:

### 1. Down Migrations - Automatic Rollback

Enable automatic cleanup of seed data in down migrations:

```javascript
class AppContext extends context {
    onConfig() {
        // Enable down migration generation
        this.seedConfig({
            generateDownMigrations: true,  // Default: false
            downStrategy: 'delete',        // 'delete' | 'skip'
            onRollbackError: 'warn'        // 'warn' | 'throw' | 'ignore'
        });

        this.dbset(User).seed({ id: 1, name: 'admin', email: 'admin@example.com' });
    }
}
```

**Generated Migration:**
```javascript
async up(table) {
    await this.init(table);
    await this.seed('User', { id: 1, name: 'admin', email: 'admin@example.com' });
}

async down(table) {
    await this.init(table);
    // Auto-generated rollback (reverse order for FK safety)
    try {
        const record = await this.context.User.findById(1);
        if (record) await record.delete();
    } catch (e) {
        console.warn('Seed rollback: User id=1 not found');
    }
}
```

**Use Cases:**
- Development environments where you frequently rollback migrations
- Testing scenarios requiring clean database state
- Staged deployments where rollback may be necessary

**Note:** Production environments typically don't rollback seed data due to referential integrity concerns.

---

### 2. Conditional Seeding - Environment-Based Data

Seed different data based on environment:

```javascript
class AppContext extends context {
    onConfig() {
        // Development/test only seed data
        this.dbset(User)
            .seed({ name: 'Test User', email: 'test@example.com' })
            .when('development', 'test');

        // Production-only seed data
        this.dbset(Config)
            .seed({ key: 'api_endpoint', value: 'https://api.production.com' })
            .when('production');

        // Multiple environments
        this.dbset(Feature)
            .seed({ name: 'beta_feature', enabled: true })
            .when('staging', 'production');
    }
}
```

**How It Works:**
- Migration code is filtered at **generation time** (not runtime)
- Only seed data matching current environment is included in migration
- Cleaner migrations, no runtime overhead

**Environment Detection:**
- Uses `process.env.NODE_ENV` or `process.env.master`
- Defaults to 'development' if not set
- Supports multiple environments per seed

---

### 3. Automatic Dependency Ordering

Seeds are automatically ordered based on foreign key relationships:

```javascript
class AppContext extends context {
    onConfig() {
        // Order doesn't matter - automatically sorted!
        this.dbset(Post).seed({
            title: 'Welcome',
            user_id: 1  // Foreign key to User
        });

        this.dbset(User).seed({
            id: 1,
            name: 'admin'
        });

        // Generated migration will seed User BEFORE Post
    }
}
```

**How It Works:**
- Analyzes `belongsTo` relationships in entity definitions
- Builds dependency graph using topological sort (Kahn's algorithm)
- Parents are always seeded before children
- Detects circular dependencies and warns

**Circular Dependency Handling:**
```javascript
this.seedConfig({
    detectCircularDependencies: true,
    circularStrategy: 'warn'  // 'warn' | 'throw' | 'ignore'
});
```

**Benefits:**
- Prevents foreign key constraint violations
- No manual ordering required
- Works with complex multi-level dependencies
- Junction tables (many-to-many) handled automatically

---

### 4. Seed Factories - Parameterized Data Generation

Generate multiple seed records with variations:

```javascript
class AppContext extends context {
    onConfig() {
        // Inline factory with generator function
        this.dbset(User).seedFactory(10, i => ({
            name: `User ${i}`,
            email: `user${i}@example.com`,
            role: 'member',
            created_at: Date.now()
        }));

        // External factory class
        this.dbset(User).seed(UserFactory.admin({
            email: 'custom@example.com'
        }));
    }
}

// External factory pattern
class UserFactory {
    static admin(overrides = {}) {
        return {
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'admin',
            is_active: true,
            ...overrides
        };
    }

    static members(count) {
        return Array.from({ length: count }, (_, i) => ({
            name: `Member ${i}`,
            email: `member${i}@example.com`,
            role: 'member'
        }));
    }
}
```

**Generated Migration (Optimized):**
```javascript
// Bulk insert with loop (10+ records)
const factoryRecords = [
    {"name":"User 0","email":"user0@example.com","role":"member"},
    {"name":"User 1","email":"user1@example.com","role":"member"},
    // ... 8 more
];
for (const record of factoryRecords) {
    await this.seed('User', record);
}
```

**Use Cases:**
- Generate test users for development
- Create sample data for demos
- Populate lookup tables with variations
- Bulk seed with consistent patterns

**Faker Integration (Optional):**
```javascript
import { faker } from '@faker-js/faker';

this.dbset(User).seedFactory(100, i => ({
    name: faker.person.fullName(),
    email: faker.internet.email(),
    bio: faker.lorem.paragraph()
}));
```

---

### 5. Upsert - Update if Exists, Insert if Not

Create idempotent seed data that can run multiple times:

```javascript
class AppContext extends context {
    onConfig() {
        // Upsert by primary key
        this.dbset(User)
            .seed({ id: 1, name: 'admin', email: 'admin@example.com' })
            .upsert();

        // Upsert by custom field (business key)
        this.dbset(User)
            .seed({ email: 'admin@example.com', name: 'Administrator' })
            .upsert({ conflictKey: 'email' });

        // Partial update (only update specific fields)
        this.dbset(Config)
            .seed({ key: 'api_url', value: 'https://new-api.com', updated_at: Date.now() })
            .upsert({
                conflictKey: 'key',
                updateFields: ['value', 'updated_at']  // Don't update other fields
            });

        // Context-level default (all seeds become upserts)
        this.seedConfig({
            defaultStrategy: 'upsert'
        });
    }
}
```

**Generated Migration:**
```javascript
async up(table) {
    await this.init(table);

    // Check-then-update pattern (database-agnostic)
    {
        const existing = await this.context.User.where(r => r.email == 'admin@example.com').single();
        if (existing) {
            existing.name = 'Administrator';
            await existing.save();
        } else {
            await this.seed('User', { email: 'admin@example.com', name: 'Administrator' });
        }
    }
}
```

**Use Cases:**
- Configuration tables that need updates
- Master data that changes over time
- Idempotent migrations (can run multiple times safely)
- CI/CD pipelines where migrations may re-run

**Benefits:**
- Database-agnostic (works on SQLite, MySQL, PostgreSQL)
- Triggers ORM lifecycle hooks (`beforeSave`, `afterSave`)
- Type-safe and validated
- Prevents duplicate key errors

---

### Advanced Example - All Features Together

```javascript
class AppContext extends context {
    constructor() {
        super();
        this.env('./config');

        // Global seed configuration
        this.seedConfig({
            generateDownMigrations: true,     // Enable rollback
            defaultStrategy: 'upsert',        // Idempotent by default
            detectCircularDependencies: true, // Warn on cycles
            circularStrategy: 'warn'
        });

        // Define entities
        this.dbset(User);
        this.dbset(Organization);
        this.dbset(Post);
        this.dbset(Category);

        // Seed with all features combined
        this.dbset(Organization)
            .seed([
                { id: 1, name: 'Default Org', slug: 'default' },
                { id: 2, name: 'Partner Org', slug: 'partner' }
            ])
            .upsert({ conflictKey: 'slug' });

        this.dbset(User)
            .seedFactory(5, i => ({
                id: i + 1,
                name: `Admin ${i}`,
                email: `admin${i}@example.com`,
                org_id: 1,  // Foreign key (dependency)
                role: 'admin'
            }))
            .when('development', 'test')  // Only in dev/test
            .upsert({ conflictKey: 'email' });

        this.dbset(Category)
            .seed([
                { name: 'Technology' },
                { name: 'Business' },
                { name: 'Science' }
            ])
            .upsert();

        this.dbset(Post)
            .seedFactory(10, i => ({
                title: `Sample Post ${i}`,
                content: 'Lorem ipsum...',
                user_id: 1,      // Depends on User
                category_id: 1   // Depends on Category
            }))
            .when('development');
    }
}
```

**What Happens:**
1. **Dependency ordering**: Organization → User → Category → Post (automatic)
2. **Conditional filtering**: User and Post seeds only in dev/test
3. **Upsert safety**: Won't fail on duplicate keys
4. **Factory generation**: 5 users and 10 posts created with variations
5. **Rollback support**: Down migration deletes in reverse order

---

### Seed Configuration API

```javascript
// In context constructor
this.seedConfig({
    generateDownMigrations: false,     // Enable/disable rollback generation
    downStrategy: 'delete',            // 'delete' | 'skip'
    defaultStrategy: 'insert',         // 'insert' | 'upsert'
    detectCircularDependencies: true,  // Detect circular FK references
    circularStrategy: 'warn',          // 'warn' | 'throw' | 'ignore'
    deleteByPrimaryKey: true,          // Use PK for down migrations
    onRollbackError: 'warn'            // 'warn' | 'throw' | 'ignore'
});
```

### Enhanced Seed Methods

```javascript
// Context-level seed API (extended)
this.dbset(EntityName).seed(data)                              // Basic seed
    .seed(moreData)                                            // Chainable
    .seedFactory(count, generatorFn)                           // Factory pattern
    .when(...environments)                                     // Conditional
    .upsert({ conflictKey, updateFields })                     // Upsert mode

// Examples
this.dbset(User)
    .seed({ name: 'admin' })                                   // Single record
    .seed([{ name: 'user1' }, { name: 'user2' }])             // Array
    .seedFactory(10, i => ({ name: `User ${i}` }))            // Factory
    .when('development', 'test')                               // Conditional
    .upsert({ conflictKey: 'email' });                         // Upsert
```

---

## Business Logic Validation

Add validators to your entity definitions for automatic validation on property assignment.

**Built-in Validators:**
- `required(message)` - Field must have a value
- `email(message)` - Must be valid email format
- `minLength(length, message)` - Minimum string length
- `maxLength(length, message)` - Maximum string length
- `pattern(regex, message)` - Must match regex pattern
- `min(value, message)` - Minimum numeric value
- `max(value, message)` - Maximum numeric value
- `custom(fn, message)` - Custom validation function

**Example:**

```javascript
class User {
    id(db) {
        db.integer().primary().auto();
    }

    name(db) {
        db.string()
          .required('Name is required')
          .minLength(3, 'Name must be at least 3 characters')
          .maxLength(50, 'Name cannot exceed 50 characters');
    }

    email(db) {
        db.string()
          .required('Email is required')
          .email('Must be a valid email address');
    }

    password(db) {
        db.string()
          .required('Password is required')
          .minLength(8, 'Password must be at least 8 characters')
          .maxLength(100);
    }

    username(db) {
        db.string()
          .required()
          .pattern(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');
    }

    age(db) {
        db.integer()
          .min(18, 'Must be at least 18 years old')
          .max(120, 'Age cannot exceed 120');
    }

    status(db) {
        db.string()
          .custom((value) => {
              return ['active', 'inactive', 'pending'].includes(value);
          }, 'Status must be active, inactive, or pending');
    }
}
```

**Validation Execution:**

Validators run automatically when you assign values:

```javascript
const user = db.User.new();

// ❌ Validation fails immediately
try {
    user.email = 'invalid-email';
} catch (error) {
    console.log(error.message);
    // "Validation failed: Must be a valid email address"
}

// ✅ Valid value accepted
user.email = 'valid@example.com';  // OK

// ❌ Length validation
try {
    user.password = 'short';
} catch (error) {
    console.log(error.message);
    // "Validation failed: Password must be at least 8 characters"
}

// ✅ Valid password
user.password = 'secure-password-123';  // OK

// ❌ Custom validation
try {
    user.status = 'invalid-status';
} catch (error) {
    console.log(error.message);
    // "Validation failed: Status must be active, inactive, or pending"
}

// ✅ Valid status
user.status = 'active';  // OK

// Save (all fields already validated)
await user.save();
```

**Validator Chaining:**

Validators can be chained together:

```javascript
email(db) {
    db.string()
      .required('Email is required')      // ← First validator
      .email('Invalid email format')      // ← Second validator
      .minLength(5, 'Email too short')    // ← Third validator
      .maxLength(100, 'Email too long');  // ← Fourth validator
}
```

**Custom Validation:**

```javascript
discount(db) {
    db.integer()
      .min(0, 'Discount cannot be negative')
      .max(100, 'Discount cannot exceed 100%')
      .custom((value) => {
          // Only allow multiples of 5
          return value % 5 === 0;
      }, 'Discount must be a multiple of 5');
}

// Usage
product.discount = 7;   // ❌ Throws: "Discount must be a multiple of 5"
product.discount = 10;  // ✅ OK
```

**Nullable Fields:**

Required validation respects nullable fields:

```javascript
bio(db) {
    db.string()
      .maxLength(500, 'Bio cannot exceed 500 characters');
    // No .required() = field is optional
}

// Both are valid
user.bio = null;  // ✅ OK (nullable)
user.bio = 'Short bio';  // ✅ OK (with value)
user.bio = 'a'.repeat(501);  // ❌ Throws: "Bio cannot exceed 500 characters"
```

---

## Bulk Operations API

Efficiently create, update, or delete multiple entities in a single operation.

**Available Methods:**
- `context.bulkCreate(entityName, data)` - Create multiple entities
- `context.bulkUpdate(entityName, updates)` - Update multiple entities
- `context.bulkDelete(entityName, ids)` - Delete multiple entities

### bulkCreate(entityName, data)

Create multiple entities efficiently in a batch operation.

**Example:**

```javascript
// Create 5 users at once
const users = await db.bulkCreate('User', [
    { name: 'Alice', email: 'alice@example.com', status: 'active' },
    { name: 'Bob', email: 'bob@example.com', status: 'active' },
    { name: 'Charlie', email: 'charlie@example.com', status: 'inactive' },
    { name: 'Dave', email: 'dave@example.com', status: 'active' },
    { name: 'Eve', email: 'eve@example.com', status: 'pending' }
]);

console.log(users.length);  // 5
console.log(users[0].id);   // 1 (auto-increment IDs assigned)
console.log(users[4].id);   // 5

// Entities are returned in the same order
console.log(users.map(u => u.name));
// ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve']
```

**Performance:**

```javascript
// ❌ SLOW: Multiple individual inserts
for (const data of users) {
    const user = db.User.new();
    user.name = data.name;
    user.email = data.email;
    await user.save();  // Separate database call
}

// ✅ FAST: Single bulk insert
await db.bulkCreate('User', users);  // One database call
```

### bulkUpdate(entityName, updates)

Update multiple entities by their primary keys.

**Example:**

```javascript
// Update multiple users' status
await db.bulkUpdate('User', [
    { id: 1, status: 'inactive' },
    { id: 2, status: 'inactive' },
    { id: 4, status: 'inactive' }
]);

// Verify updates
const user1 = await db.User.findById(1);
console.log(user1.status);  // 'inactive'

// Other fields unchanged
console.log(user1.name);   // Original name preserved
console.log(user1.email);  // Original email preserved
```

**Partial Updates:**

Only the fields you specify are updated:

```javascript
// Update only email for multiple users
await db.bulkUpdate('User', [
    { id: 1, email: 'newemail1@example.com' },
    { id: 2, email: 'newemail2@example.com' }
]);

// name, status, age, etc. remain unchanged
```

### bulkDelete(entityName, ids)

Delete multiple entities by their primary keys.

**Example:**

```javascript
// Delete multiple users by ID
await db.bulkDelete('User', [3, 5, 7]);

// Verify deletion
const user3 = await db.User.findById(3);
console.log(user3);  // null

const remaining = await db.User.toList();
console.log(remaining.length);  // Total users minus 3
```

**Non-Existent IDs:**

Bulk delete handles non-existent IDs gracefully:

```javascript
// Some IDs don't exist
await db.bulkDelete('User', [999, 1000, 1001]);
// ✅ No error thrown - operation completes successfully
```

**Error Handling:**

```javascript
// Empty array throws error
try {
    await db.bulkCreate('User', []);
} catch (error) {
    console.log(error.message);
    // "bulkCreate requires a non-empty array of data"
}

// Invalid entity name throws error
try {
    await db.bulkUpdate('NonExistentEntity', [{ id: 1 }]);
} catch (error) {
    console.log(error.message);
    // "Entity NonExistentEntity not found"
}
```

**Lifecycle Hooks:**

Bulk operations execute lifecycle hooks for each entity:

```javascript
class User {
    beforeSave() {
        console.log(`Saving user: ${this.name}`);
    }
}

await db.bulkCreate('User', [
    { name: 'Alice' },
    { name: 'Bob' }
]);
// Console output:
// Saving user: Alice
// Saving user: Bob
```

---

### Migration Methods

```javascript
// In migration up/down functions
schema.createTable(table.EntityName)
schema.dropTable(table.EntityName)
schema.addColumn({ tableName, name, type })
schema.dropColumn({ tableName, name })
schema.alterColumn({ tableName, table: { name, type, nullable, default } })
schema.renameColumn({ tableName, name, newName })
schema.seed(tableName, data)
schema.bulkSeed(tableName, dataArray)
```

## Examples

### Complete CRUD Example

```javascript
import AppContext from './app/models/context.js';

async function demo() {
    const db = new AppContext();

    // CREATE
    const user = db.User.new();
    user.name = 'Alice';
    user.email = 'alice@example.com';
    user.age = 28;
    await db.saveChanges();
    console.log('Created user:', user.id);

    // READ
    const alice = db.User
        .where(u => u.email == $$, 'alice@example.com')
        .single();
    console.log('Found user:', alice.name);

    // UPDATE
    alice.age = 29;
    await db.saveChanges();
    console.log('Updated age to:', alice.age);

    // DELETE
    db.remove(alice);
    await db.saveChanges();
    console.log('User deleted');
}

demo();
```

### Pagination Example

```javascript
async function getUsers(page = 0, pageSize = 10) {
    const db = new AppContext();

    const users = await db.User
        .where(u => u.status == $$, 'active')
        .orderBy(u => u.created_at)
        .skip(page * pageSize)
        .take(pageSize)
        .toList();

    const total = await db.User
        .where(u => u.status == $$, 'active')
        .count();

    return {
        users,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
    };
}
```

### Search with Filters

```javascript
async function searchUsers(filters) {
    const db = new AppContext();
    let query = db.User;

    // Apply filters dynamically
    if (filters.name) {
        query = query.where(u => u.name.like($$), `%${filters.name}%`);
    }

    if (filters.minAge) {
        query = query.where(u => u.age >= $$, filters.minAge);
    }

    if (filters.status) {
        query = query.where(u => u.status == $$, filters.status);
    }

    // Add sorting
    const sortField = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';

    if (sortOrder === 'asc') {
        query = query.orderBy(sortField);
    } else {
        query = query.orderByDescending(sortField);
    }

    // Add pagination
    if (filters.page && filters.pageSize) {
        query = query
            .skip(filters.page * filters.pageSize)
            .take(filters.pageSize);
    }

    return await query.toList();
}
```

### Relationship Example

```javascript
class BlogContext extends context {
    constructor() {
        super();
        this.env('config/environments');
        this.dbset(Author);
        this.dbset(Post);
    }
}

// Create author with posts
const db = new BlogContext();

const author = db.Author.new();
author.name = 'John Doe';
await db.saveChanges();

const post = db.Post.new();
post.title = 'My First Post';
post.content = 'Hello World!';
post.author_id = author.id;
await db.saveChanges();

// Query with relationships
const posts = await db.Post
    .where(p => p.author_id == $$, author.id)
    .toList();

console.log(`${author.name} has ${posts.length} posts`);
```

## Performance Tips

### 1. Use Query Caching Selectively

```javascript
// ✅ GOOD: Cache reference data that rarely changes
const categories = await db.Categories.cache().toList();  // Opt-in caching
const settings = await db.Settings.cache().toList();

// ✅ GOOD: Queries without .cache() are always fresh (safe default)
const user1 = await db.User.findById(123);  // Always DB query (no cache)
const user2 = await db.User.findById(123);  // Always DB query (no cache)

// ✅ GOOD: Cache expensive queries with stable results
const revenue2024 = await db.Orders
    .where(o => o.year == $$, 2024)
    .cache()  // Historical data doesn't change
    .count();

// Monitor cache performance
const stats = db.getCacheStats();
console.log(`Cache hit rate: ${stats.hitRate}`);  // Target: > 70%
```

### 2. Use Bulk Operations

```javascript
// ❌ BAD: Multiple inserts
for (const item of items) {
    const entity = db.Entity.new();
    entity.data = item;
    await db.saveChanges();
}

// ✅ GOOD: Single bulk insert
for (const item of items) {
    const entity = db.Entity.new();
    entity.data = item;
}
await db.saveChanges();  // Batch insert
```

### 3. Use Indexes

**Single-column indexes:**

```javascript
class User {
    email(db) {
        db.string().index();  // Single column
    }
}
```

**Composite indexes for multi-column queries:**

```javascript
class Order {
    user_id(db) { db.integer(); }
    status(db) { db.string(); }
    created_at(db) { db.timestamp(); }

    static compositeIndexes = [
        // For: WHERE user_id = ? AND status = ?
        ['user_id', 'status'],

        // For: WHERE status = ? ORDER BY created_at
        ['status', 'created_at']
    ];
}
```

**Best practices:**
- Index foreign keys for join performance
- Use composite indexes for queries with multiple WHERE conditions
- Column order matters: most selective (filtered) columns first
- Don't over-index - each index adds write overhead
- Primary keys are automatically indexed

### 4. Limit Result Sets

```javascript
// ✅ GOOD: Limit results
const recentUsers = await db.User
    .orderByDescending(u => u.created_at)
    .take(100)
    .toList();

// ❌ BAD: Load everything
const allUsers = await db.User.toList();
```

### 5. Use Connection Pooling (PostgreSQL)

```javascript
this.env({
    type: 'postgres',
    max: 20,  // Pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});
```

## Security

### SQL Injection Protection

MasterRecord uses **parameterized queries throughout** to prevent SQL injection:

```javascript
// ✅ SAFE: Parameterized
const user = await db.User.where(u => u.name == $$, userInput).single();

// ❌ UNSAFE: Never do this
// const query = `SELECT * FROM User WHERE name = '${userInput}'`;
```

All operations use parameterized queries:
- SELECT queries
- INSERT operations
- UPDATE operations
- DELETE operations
- IN clauses
- LIKE patterns

### Input Validation

While SQL injection is prevented, always validate business logic:

```javascript
// Validate input before querying
async function getUser(userId) {
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('Invalid user ID');
    }

    return await db.User.findById(userId);
}
```

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Error: Cannot find module 'pg'
npm install pg@^8.17.2

# Error: Connection refused
# Check PostgreSQL is running: sudo service postgresql status

# Error: Database does not exist
createdb myapp

# Error: Authentication failed
# Check pg_hba.conf and user permissions
```

### MySQL Connection Issues

```bash
# Error: ER_NOT_SUPPORTED_AUTH_MODE
# Use mysql_native_password for MySQL 8.0+
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';

# Error: ER_ACCESS_DENIED_ERROR
# Check user permissions
GRANT ALL PRIVILEGES ON myapp.* TO 'user'@'localhost';
```

### Migration Issues

```bash
# Cannot find context file
# Ensure you're running from project root
cd /path/to/project
masterrecord update-database AppContext

# No migrations found
# Check migrations directory exists
ls app/models/db/migrations/

# Type errors in migration
# Check entity definitions match database types
```

### Common Errors

```javascript
// Error: "expected N value(s) for '$', but received M"
// Solution: Match placeholder count with parameters
db.User.where(u => u.age > $$ && u.status == $$, 25, 'active');
//         Two $$ placeholders         ↑    ↑  Two parameters

// Error: "Cannot create IN clause with empty array"
// Solution: Check array has values before querying
const ids = [1, 2, 3];
if (ids.length > 0) {
    db.User.where(u => $$.includes(u.id), ids).toList();
}

// Error: "Field X cannot be null"
// Solution: Entity defines field as non-nullable
user.name = null;  // Error if name is { nullable: false }
```

## Changelog

See [CHANGES.md](./CHANGES.md) for the full version history.
