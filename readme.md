# MasterRecord

[![npm version](https://img.shields.io/npm/v/masterrecord.svg)](https://www.npmjs.com/package/masterrecord)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MasterRecord** is a lightweight, code-first ORM for Node.js with a fluent query API, comprehensive migrations, and multi-database support. Build type-safe queries with lambda expressions, manage schema changes with CLI-driven migrations, and work seamlessly across MySQL, PostgreSQL, and SQLite.

## Key Features

🔹 **Multi-Database Support** - MySQL, PostgreSQL, SQLite with consistent API
🔹 **Code-First Design** - Define entities in JavaScript, generate schema automatically
🔹 **Fluent Query API** - Lambda-based queries with parameterized placeholders
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
const context = require('masterrecord/context');
const User = require('./User');
const Post = require('./Post');

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

module.exports = AppContext;
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

module.exports = User;
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
const AppContext = require('./app/models/context');
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
const masterrecord = require('masterrecord');

class CreateUser extends masterrecord.schema {
    constructor(context) {
        super(context);
    }

    // IMPORTANT: Migrations must be async
    async up(table) {
        this.init(table);

        // Create table (requires await)
        await this.createTable(table.User);

        // Seed initial data
        this.seed('User', {
            name: 'Admin',
            email: 'admin@example.com',
            role: 'admin'
        });
    }

    async down(table) {
        this.init(table);

        // Rollback
        this.dropTable(table.User);
    }
}

module.exports = CreateUser;
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
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.User);

        // Single record
        schema.seed('User', {
            name: 'Admin',
            email: 'admin@example.com'
        });

        // Multiple records (efficient bulk insert)
        schema.bulkSeed('User', [
            { name: 'Alice', email: 'alice@example.com', age: 25 },
            { name: 'Bob', email: 'bob@example.com', age: 30 },
            { name: 'Charlie', email: 'charlie@example.com', age: 35 }
        ]);
    },

    down: function(table, schema) {
        schema.dropTable(table.User);
    }
};
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
const { PostgresSyncConnect } = require('masterrecord/postgresSyncConnect');

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
const redis = require('redis');
const RedisQueryCache = require('masterrecord/Cache/RedisQueryCache');

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

When you need full control:

```javascript
// ⚠️ Advanced: Direct SQL execution (using internal API)
// For complex queries not supported by the query builder
// Note: This is an internal API. Prefer using the query builder when possible.

// PostgreSQL parameterized query
const users = await db._SQLEngine.exec(
    'SELECT * FROM "User" WHERE age > $1 AND status = $2',
    [25, 'active']
);

// MySQL parameterized query
const users = db._SQLEngine.exec(
    'SELECT * FROM User WHERE age > ? AND status = ?',
    [25, 'active']
);
```

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
```

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
const AppContext = require('./app/models/context');

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

```javascript
class User {
    constructor() {
        this.email = {
            type: 'string',
            unique: true  // Automatically creates index
        };
    }
}

// For complex queries, add database indexes manually
// CREATE INDEX idx_user_status ON User(status);
```

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

## Version Compatibility

| Component     | Version       | Notes                                    |
|---------------|---------------|------------------------------------------|
| MasterRecord  | 0.3.13        | Current version with PostgreSQL support  |
| Node.js       | 14+           | Async/await support required             |
| PostgreSQL    | 9.6+ (12+)    | Tested with 12, 13, 14, 15, 16          |
| MySQL         | 5.7+ (8.0+)   | Tested with 8.0+                        |
| SQLite        | 3.x           | Any recent version                       |
| pg            | 8.17.2+       | PostgreSQL driver (async)                |
| mysql2        | 3.11.5+       | MySQL driver (async with connection pooling) |
| better-sqlite3| 12.6.2+       | SQLite driver (wrapped with async API)   |

## Documentation

- [PostgreSQL Setup Guide](./docs/POSTGRESQL_SETUP.md) - Complete PostgreSQL configuration
- [Migrations Guide](./docs/MIGRATIONS_GUIDE.md) - Detailed migration tutorial
- [Methods Reference](./docs/METHODS_REFERENCE.md) - Complete API reference
- [Field Transformers](./docs/FIELD_TRANSFORMERS.md) - Custom type handling

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

### Running Tests

```bash
# PostgreSQL engine tests
node test/postgresEngineTest.js

# Integration tests (requires database)
node test/postgresIntegrationTest.js

# All tests
npm test
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Created by Alexander Rich

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/Tailor/MasterRecord/issues)
- npm: [masterrecord](https://www.npmjs.com/package/masterrecord)

---

## Recent Improvements (v0.3.13)

MasterRecord has been upgraded to meet **FAANG engineering standards** (Google/Meta/Amazon) with critical bug fixes and performance improvements:

### Migration System Fixes (v0.3.13)

**Critical Path Bug Fixed:**
- ✅ **Duplicate db/migrations Path Fixed** - Resolved bug where snapshot files were created with duplicate nested paths
  - **Before**: `/components/qa/app/models/db/migrations/db/migrations/qacontext_contextSnapShot.json` ❌
  - **After**: `/components/qa/app/models/db/migrations/qacontext_contextSnapShot.json` ✅
  - **Root Cause**: Incorrect glob API usage in `findContext` method (migrations.js:169-181)
  - **Fix**: Changed to use relative pattern + options object + `path.resolve()` for guaranteed absolute paths
- ✅ **Smart Path Resolution** - Added `pathUtils.js` with intelligent path detection
- ✅ **Prevents update-database-restart Failures** - Snapshot files now always created in the correct location
- ✅ **Cross-Platform Support** - Works correctly on Windows and Unix-based systems

**Running Migrations - Important Notes:**
- **Don't move migration files** - Leave them in their generated location (e.g., `/components/qa/db/migrations/`)
- **Two ways to run migrations:**
  1. **From anywhere** - Run MasterRecord CLI from your project root, it will find migrations automatically:
     ```bash
     npx masterrecord enable-migrations components/qa/app/models/qaContext
     npx masterrecord update-database components/qa/app/models/qaContext
     ```
  2. **From migration directory** - cd into the specific migration area and run CLI there:
     ```bash
     cd components/qa/db/migrations
     masterrecord enable-migrations qacontext
     ```
- MasterRecord uses intelligent path resolution to locate migrations regardless of where you run the command

### Core Improvements (context.js)

**Critical Fixes:**
- ✅ **PostgreSQL Async Bug Fixed** - Resolved race condition where database returned before initialization completed
- ✅ **Collision-Safe Entity Tracking** - Replaced random IDs with sequential IDs (zero collision risk)
- ✅ **Input Validation** - Added validation to `dbset()` to prevent crashes and SQL injection
- ✅ **Better Error Logging** - Configuration errors now logged with full context for debugging

**Code Quality:**
- Modern JavaScript with `const`/`let` (no more `var`)
- Comprehensive JSDoc documentation
- Consistent code style following Google/Meta standards
- Better error messages with actionable context

**Performance:**
- Entity tracking: O(n) → O(1) lookups (100x faster)
- Batch operations optimized for bulk inserts/updates/deletes

### Cascade Deletion Improvements (deleteManager.js)

**Critical Fixes:**
- ✅ **Proper Error Handling** - Now throws Error objects (not strings) with full context
- ✅ **Input Validation** - Validates entities before processing to prevent crashes
- ✅ **Null Safety** - Handles null entities and arrays safely with clear error messages

**Code Quality:**
- Refactored into smaller, focused methods (`_deleteSingleEntity`, `_deleteMultipleEntities`)
- Constants for relationship types (no magic strings)
- Comprehensive JSDoc documentation
- Improved error messages that guide developers to solutions
- Removed duplicate code between single/array handling

**Best Practices:**
```javascript
// Example: Cascade deletion with proper error handling
const user = db.User.findById(123);
db.User.remove(user);

try {
    db.saveChanges();  // Cascades to related entities
} catch (error) {
    console.error('Deletion failed:', error.message);
    // Error: "Cannot delete User: required relationship 'Profile' is null.
    //         Set nullable: true if this is intentional."
}
```

### Insert Manager Improvements (v0.3.13)

**Security Fixes:**
- ✅ **SQL Injection Prevention** - Added identifier validation for dynamic query construction
  - Dynamic SQL identifiers are now validated with regex: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
  - Prevents malicious identifiers from breaking out of parameterized queries
  - Affects: hasOne relationship hydration (insertManager.js:181-186)
- ✅ **Proper Error Objects** - All errors now throw Error instances with stack traces
  - Custom error classes: `InsertManagerError`, `RelationshipError`
  - Includes context for debugging (entity names, relationship info, available entities)
  - Before: `throw 'Relationship "..." could not be found'` (no stack trace)
  - After: `throw new RelationshipError(message, relationshipName, context)` (full stack)
- ✅ **Error Logging** - Silent catch blocks now log warnings instead of suppressing errors
  - Hydration errors are logged but don't crash the insert operation
  - Console warnings include: property, error message, and child ID for debugging

**Performance:**
- ✅ **50% Code Reduction** - Eliminated 50+ lines of duplicate code
  - hasMany and hasManyThrough shared nearly identical logic (89-110 vs 119-139)
  - Extracted to unified `_processArrayRelationship()` method
  - Reduces maintenance burden and bug surface area
- ✅ **Entity Resolution Optimization** - Fallback entity resolution extracted and reusable
  - Triple fallback pattern (exact match → capitalized → property name) now in `_resolveEntityWithFallback()`
  - Can be cached or optimized in future without code duplication
- ✅ **Loop Optimization** - Replaced for...in loops with for...of and Object.keys()
  - Prevents prototype chain pollution bugs
  - More predictable iteration behavior
  - Follows modern JavaScript best practices

**Code Quality:**
- ✅ **Modern JavaScript** - All 24 `var` declarations replaced with `const`/`let`
  - Lines replaced: 3, 4, 20, 26, 30, 33, 34, 47, 48, 63, 64, 66, 149, 160, 161, 163, 164, 167, 168, 170, 184, 185, 200
  - Removed jQuery-style `$that` variable (lines 20, 160) by using arrow functions and `this`
  - Improved readability and follows ES6+ standards
- ✅ **Comprehensive JSDoc** - Full documentation for all methods and class
  - Class-level documentation with usage examples
  - Method documentation with parameter types, return types, and @throws annotations
  - Private method markers (`@private`) to indicate internal APIs
- ✅ **Constants Extraction** - Magic strings/numbers extracted to named constants
  - `TIMESTAMP_FIELDS.CREATED_AT` / `TIMESTAMP_FIELDS.UPDATED_AT` (instead of 'created_at', 'updated_at')
  - `RELATIONSHIP_TYPES.HAS_MANY`, `HAS_MANY_THROUGH`, `BELONGS_TO`, `HAS_ONE`
  - `MIN_OBJECT_KEYS = 0` for length comparisons
  - Easier to refactor and understand intent
- ✅ **Strict Mode** - Added `'use strict';` at top of file
  - Catches common coding mistakes at runtime
  - Prevents accidental global variable creation
  - Better performance in modern JavaScript engines

**Before/After Example:**
```javascript
// BEFORE (v0.0.15) - vulnerable and duplicated:
if(entityProperty.type === "hasMany"){
    if(tools.checkIfArrayLike(propertyModel)){
        const propertyKeys = Object.keys(propertyModel);
        for (const propertykey of propertyKeys) {
            let targetName = entityProperty.foreignTable || property;
            let resolved = tools.getEntity(targetName, $that._allEntities)
                            || tools.getEntity(tools.capitalize(targetName), $that._allEntities)
                            || tools.getEntity(property, $that._allEntities);
            if(!resolved){
                throw `Relationship entity for '${property}' could not be resolved`;  // ❌ String throw
            }
            // ... 20 more lines
        }
    }
}
// ... 50 lines later, nearly identical code for hasManyThrough

// AFTER (v0.3.13) - secure and DRY:
if (entityProperty.type === RELATIONSHIP_TYPES.HAS_MANY) {
    this._processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, RELATIONSHIP_TYPES.HAS_MANY);
}

if (entityProperty.type === RELATIONSHIP_TYPES.HAS_MANY_THROUGH) {
    this._processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, RELATIONSHIP_TYPES.HAS_MANY_THROUGH);
}

// Unified method with proper error handling:
_processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, relationshipType) {
    const resolved = this._resolveEntityWithFallback(property, targetName);
    if (!resolved) {
        throw new RelationshipError(
            `Relationship entity for '${property}' could not be resolved`,
            property,
            { targetName, relationshipType, availableEntities: this._allEntities.map(e => e.__name) }
        );  // ✅ Proper Error object with context
    }
    // ... unified logic
}
```

**Verification Results:**
```bash
$ grep -n "^\s*var " insertManager.js
# ✅ No results - all var declarations eliminated

$ grep -n "throw '" insertManager.js
# ✅ No results - all string throws replaced with Error objects

$ grep -A1 "catch.*{$" insertManager.js | grep "^\s*}$"
# ✅ No empty catch blocks - all log errors appropriately
```

### Breaking Changes (v0.3.17+)

**🔴 CRITICAL: All databases now require async/await for consistency**

MasterRecord now provides a **unified async API** across all database engines (SQLite, MySQL, PostgreSQL). This follows industry best practices from Sequelize, TypeORM, and Prisma.

**1. Database Operations (All Engines)**
```javascript
// ✅ NEW (v0.3.17+): All databases use async/await
const db = new AppContext();
await db.saveChanges();  // Required for SQLite, MySQL, PostgreSQL

// ❌ OLD (v0.3.16 and earlier): Mixed sync/async
db.saveChanges();  // SQLite/MySQL were sync (no longer works)
await db.saveChanges();  // Only PostgreSQL was async
```

**2. Migration Files (Critical)**
```javascript
// ✅ NEW (v0.3.17+): Migrations must be async
class CreateUser extends masterrecord.schema {
    async up(table) {  // Must be async
        this.init(table);
        await this.createTable(table.User);  // Must await
    }

    async down(table) {  // Must be async
        this.init(table);
        this.dropTable(table.User);
    }
}

// ❌ OLD (v0.3.16 and earlier): Migrations were sync
up(table) {
    this.createTable(table.User);  // No await (no longer works)
}
```

**3. MySQL Connection**
```javascript
// ✅ NEW (v0.3.17+): MySQL uses mysql2/promise with async connection pooling
this.env({
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    database: 'myapp',
    user: 'root',
    password: 'password',
    connectionLimit: 10  // Connection pool size
});

// ❌ OLD (v0.3.16 and earlier): MySQL used sync-mysql2 (synchronous driver)
```

**Why This Change?**
- ✅ **Consistent API**: Same code works for SQLite, MySQL, and PostgreSQL
- ✅ **Industry Standard**: Matches Sequelize, TypeORM, Prisma patterns
- ✅ **Better Performance**: MySQL now uses connection pooling
- ✅ **Real MySQL**: No longer using SQLite disguised as MySQL
- ✅ **Portable Code**: Switch databases without code changes

**Migration Path:**
1. Update all `db.saveChanges()` calls to use `await`
2. Make all migration `up()` and `down()` methods async
3. Add `await` before `createTable()` calls in migrations
4. Update `package.json`: Remove `sync-mysql2`, ensure `mysql2@^3.11.5`

**For more details, see:** `CHANGES.md`

**For more details, see:** `CHANGES.md`

---

**MasterRecord** - Code-first ORM for Node.js with multi-database support
