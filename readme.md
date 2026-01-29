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
| MySQL      | 5.7+ (8.0+)  | JSON, transactions, AUTO_INCREMENT                |
| SQLite     | 3.x          | Embedded, zero-config, file-based                 |

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
- `pg@^8.16.3` - PostgreSQL
- `sync-mysql2@^1.0.8` - MySQL
- `better-sqlite3@^12.6.0` - SQLite

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
masterrecord migrate AppContext
```

### 4. Query Your Data

```javascript
const AppContext = require('./app/models/context');
const db = new AppContext();

// Create
const user = db.User.new();
user.name = 'Alice';
user.email = 'alice@example.com';
user.age = 28;
await db.saveChanges();

// Read with parameterized query
const alice = db.User
    .where(u => u.email == $$, 'alice@example.com')
    .single();

// Update
alice.age = 29;
await db.saveChanges();

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

### MySQL (Synchronous)

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
            password: 'password'
        });

        this.dbset(User);
    }
}

// Usage is synchronous
const db = new AppContext();
db.saveChanges();  // No await needed
```

### SQLite (Synchronous)

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

const loaded = db.User.findById(user.id);
console.log(loaded.tags);  // ['admin', 'moderator'] - JavaScript array!
```

## Querying

### Basic Queries

```javascript
// Find all
const users = db.User.all();

// Find by primary key
const user = db.User.findById(123);

// Find single with where clause
const alice = db.User
    .where(u => u.email == $$, 'alice@example.com')
    .single();

// Find multiple with conditions
const adults = db.User
    .where(u => u.age >= $$, 18)
    .toList();
```

### Parameterized Queries

**Always use `$$` placeholders** for SQL injection protection:

```javascript
// Single parameter
const user = db.User.where(u => u.id == $$, 123).single();

// Multiple parameters
const results = db.User
    .where(u => u.age > $$ && u.status == $$, 25, 'active')
    .toList();

// Single $ for OR conditions
const results = db.User
    .where(u => u.status == $ || u.status == null, 'active')
    .toList();
```

### IN Clauses

```javascript
// Array parameter with .includes()
const ids = [1, 2, 3, 4, 5];
const users = db.User
    .where(u => $$.includes(u.id), ids)
    .toList();

// Generated SQL: WHERE id IN ($1, $2, $3, $4, $5)
// PostgreSQL parameters: [1, 2, 3, 4, 5]

// Alternative .any() syntax
const users = db.User
    .where(u => u.id.any($$), [1, 2, 3])
    .toList();

// Comma-separated strings (auto-splits)
const users = db.User
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

// Add sorting and pagination
const users = query
    .orderBy(u => u.created_at)
    .skip(offset)
    .take(limit)
    .toList();
```

### Ordering

```javascript
// Ascending
const users = db.User
    .orderBy(u => u.name)
    .toList();

// Descending
const users = db.User
    .orderByDescending(u => u.created_at)
    .toList();
```

### Pagination

```javascript
// Skip 20, take 10
const users = db.User
    .orderBy(u => u.id)
    .skip(20)
    .take(10)
    .toList();

// Page-based pagination
const page = 2;
const pageSize = 10;
const users = db.User
    .skip(page * pageSize)
    .take(pageSize)
    .toList();
```

### Counting

```javascript
// Count all
const total = db.User.count();

// Count with conditions
const activeCount = db.User
    .where(u => u.status == $$, 'active')
    .count();
```

### Complex Queries

```javascript
// Multiple conditions with OR
const results = db.User
    .where(u => (u.status == 'active' || u.status == 'pending') && u.age >= $$, 18)
    .orderBy(u => u.name)
    .toList();

// Nullable checks
const usersWithoutEmail = db.User
    .where(u => u.email == null)
    .toList();

// LIKE queries
const matching = db.User
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
masterrecord migrate AppContext

# Apply all migrations from scratch
masterrecord migrate-restart AppContext

# List migrations
masterrecord get-migrations AppContext

# Multi-context commands
masterrecord enable-migrations-all          # Enable for all contexts
masterrecord add-migration-all Init         # Create migration for all
masterrecord migrate-all                    # Apply all pending migrations
```

### Migration File Structure

```javascript
// db/migrations/20250111_143052_CreateUser.js
module.exports = {
    up: function(table, schema) {
        // Create table
        schema.createTable(table.User);

        // Seed initial data
        schema.seed('User', {
            name: 'Admin',
            email: 'admin@example.com',
            role: 'admin'
        });
    },

    down: function(table, schema) {
        // Rollback
        schema.dropTable(table.User);
    }
};
```

### Migration Operations

```javascript
module.exports = {
    up: function(table, schema) {
        // Create table
        schema.createTable(table.User);

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

#### Basic Usage (Default Behavior)

Caching is **enabled by default** and requires zero configuration:

```javascript
const db = new AppContext();

// First query hits database (cache miss)
const user = db.User.where(u => u.id == $$, 1).single();

// Second identical query hits cache (99%+ faster)
const user2 = db.User.where(u => u.id == $$, 1).single();

// Update invalidates cache automatically
user2.name = "Updated";
db.saveChanges();  // Cache for User table cleared

// Next query hits database again (cache miss)
const user3 = db.User.where(u => u.id == $$, 1).single();
```

#### Configuration

Configure caching via environment variables:

```bash
# Development (.env)
QUERY_CACHE_ENABLED=true           # Enable/disable (default: true)
QUERY_CACHE_TTL=300000             # TTL in milliseconds (default: 5 minutes)
QUERY_CACHE_SIZE=1000              # Max cache entries (default: 1000)

# Production (.env)
QUERY_CACHE_ENABLED=true
QUERY_CACHE_TTL=300                # Redis uses seconds
REDIS_URL=redis://localhost:6379  # Use Redis for distributed caching
```

#### Disable Caching for Specific Queries

Use `.noCache()` for real-time data that shouldn't be cached:

```javascript
// Always hit database (never cached)
const liveData = db.Analytics
    .where(a => a.date == $$, today)
    .noCache()  // Skip cache
    .toList();

// Reference data (highly cacheable)
const categories = db.Categories.toList();  // Cached for 5 minutes
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
const freshData = db.User.toList();
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
// Query is cached
const users = db.User.where(u => u.active == true).toList();

// Any modification to User table invalidates ALL User queries
const user = db.User.findById(1);
user.name = "Updated";
db.saveChanges();  // Invalidates all cached User queries

// Next query hits database (fresh data)
const usersAgain = db.User.where(u => u.active == true).toList();

// Queries for OTHER tables are unaffected
const posts = db.Post.toList();  // Still cached
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

**DO cache:**
```javascript
// Reference data (rarely changes)
const categories = db.Categories.toList();
const settings = db.Settings.toList();

// Read-heavy data (user profiles)
const user = db.User.findById(userId);

// Expensive aggregations
const stats = db.Orders
    .where(o => o.status == $$, 'completed')
    .count();
```

**DON'T cache:**
```javascript
// Real-time data (always needs fresh results)
const liveOrders = db.Orders
    .where(o => o.status == $$, 'pending')
    .noCache()
    .toList();

// Financial transactions (critical accuracy)
const balance = db.Transactions
    .where(t => t.user_id == $$, userId)
    .noCache()
    .toList();

// User-specific sensitive data (security concern)
const permissions = db.UserPermissions
    .where(p => p.user_id == $$, userId)
    .noCache()
    .toList();
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

const user = userDb.User.findById(123);
analyticsDb.Event.new().log('user_login', user.id);
await analyticsDb.saveChanges();
```

```bash
# Migrate all contexts at once
masterrecord migrate-all
```

### Raw SQL Queries

When you need full control:

```javascript
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

// Save changes
await context.saveChanges()  // PostgreSQL (async)
context.saveChanges()        // MySQL/SQLite (sync)

// Add/Remove entities
context.EntityName.add(entity)
context.remove(entity)

// Cache management
context.getCacheStats()              // Get cache statistics
context.clearQueryCache()            // Clear all cached queries
context.setQueryCacheEnabled(bool)   // Enable/disable caching
```

### Query Methods

```javascript
// Chainable query builders
.where(query, ...params)         // Add WHERE condition
.and(query, ...params)           // Add AND condition
.orderBy(field)                  // Sort ascending
.orderByDescending(field)        // Sort descending
.skip(number)                    // Skip N records
.take(number)                    // Limit to N records
.include(relationship)           // Eager load
.noCache()                       // Disable caching for this query

// Terminal methods (execute query)
.toList()                        // Return array
.single()                        // Return one or null
.first()                         // Return first or null
.count()                         // Return count
.any()                           // Return boolean
.all()                           // Return all records

// Convenience methods
.findById(id)                    // Find by primary key
.new()                           // Create new entity instance
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

    const users = db.User
        .where(u => u.status == $$, 'active')
        .orderBy(u => u.created_at)
        .skip(page * pageSize)
        .take(pageSize)
        .toList();

    const total = db.User
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

    return query.toList();
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
const posts = db.Post
    .where(p => p.author_id == $$, author.id)
    .toList();

console.log(`${author.name} has ${posts.length} posts`);
```

## Performance Tips

### 1. Leverage Query Caching

```javascript
// ✅ GOOD: Cache reference data
const categories = db.Categories.toList();  // Cached automatically

// ✅ GOOD: Reuse queries (cache hits)
const user1 = db.User.findById(123);  // DB query
const user2 = db.User.findById(123);  // Cache hit (instant)

// ✅ GOOD: Disable cache for real-time data
const liveOrders = db.Orders.where(o => o.status == 'pending').noCache().toList();

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
const recentUsers = db.User
    .orderByDescending(u => u.created_at)
    .take(100)
    .toList();

// ❌ BAD: Load everything
const allUsers = db.User.all();
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
const user = db.User.where(u => u.name == $$, userInput).single();

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
function getUser(userId) {
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('Invalid user ID');
    }

    return db.User.findById(userId);
}
```

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Error: Cannot find module 'pg'
npm install pg@^8.16.3

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
masterrecord migrate AppContext

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
| MasterRecord  | 0.3.0+        | Current version with PostgreSQL support  |
| Node.js       | 14+           | Async/await support required             |
| PostgreSQL    | 9.6+ (12+)    | Tested with 12, 13, 14, 15, 16          |
| MySQL         | 5.7+ (8.0+)   | Tested with 8.0+                        |
| SQLite        | 3.x           | Any recent version                       |
| pg            | 8.16.3+       | PostgreSQL driver                        |
| sync-mysql2   | 1.0.8+        | MySQL driver                            |
| better-sqlite3| 12.6.0+       | SQLite driver                           |

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

**MasterRecord** - Code-first ORM for Node.js with multi-database support
