# MasterRecord Migrations Guide

Complete guide for database migrations and seed data with support for MySQL, SQLite, and PostgreSQL.

## Table of Contents
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Database Support](#database-support)
- [Creating Migrations](#creating-migrations)
- [Seed Data](#seed-data)
- [Migration Commands](#migration-commands)
- [Examples](#examples)

## Overview

MasterRecord migrations allow you to:
- Create and modify database tables
- Track schema changes over time
- Seed initial or test data
- Roll back changes when needed
- Work consistently across MySQL, SQLite, and PostgreSQL

## Quick Start

### 1. Setup Your Context

```javascript
// app/models/context.js
const context = require('masterrecord/context');

class AppContext extends context {
    constructor() {
        super();
    }
}

module.exports = AppContext;
```

### 2. Create Your First Migration

```bash
# Run from your project root
masterrecord add-migration InitialCreate context
```

This creates a new migration file in `app/models/db/migrations/`

### 3. Define Your Schema

```javascript
// migrations/20250111_InitialCreate.js
module.exports = {
    up: function(table, schema) {
        // Create Users table
        schema.createTable(table.User);

        // Create Posts table
        schema.createTable(table.Post);

        // Add seed data
        schema.seed('User', [
            { name: 'Admin', email: 'admin@example.com', role: 'admin' },
            { name: 'User', email: 'user@example.com', role: 'user' }
        ]);
    },

    down: function(table, schema) {
        schema.dropTable(table.Post);
        schema.dropTable(table.User);
    }
};
```

### 4. Run Migrations

```bash
masterrecord migrate context
```

## Database Support

### PostgreSQL (NEW!)
Full PostgreSQL support with:
- SERIAL/BIGSERIAL for auto-increment
- Native BOOLEAN type
- JSON and JSONB support
- UUID support
- Parameterized queries ($1, $2, $3...)
- ON CONFLICT DO NOTHING for idempotent seeds

### MySQL
Complete MySQL support with:
- AUTO_INCREMENT
- TINYINT for booleans (0/1)
- JSON support
- INSERT IGNORE for idempotent seeds

### SQLite
Full SQLite support with:
- AUTOINCREMENT
- INTEGER for booleans (0/1)
- INSERT OR IGNORE for idempotent seeds

## Creating Migrations

### Basic Table Creation

```javascript
module.exports = {
    up: function(table, schema) {
        // table.TableName contains the entity definition
        schema.createTable(table.User);
    },

    down: function(table, schema) {
        schema.dropTable(table.User);
    }
};
```

### Adding Columns

```javascript
module.exports = {
    up: function(table, schema) {
        schema.addColumn({
            tableName: 'User',
            name: 'phone_number',
            type: 'string'
        });
    },

    down: function(table, schema) {
        schema.dropColumn({
            tableName: 'User',
            name: 'phone_number'
        });
    }
};
```

### Modifying Columns

```javascript
module.exports = {
    up: function(table, schema) {
        schema.alterColumn({
            tableName: 'User',
            table: {
                name: 'age',
                type: 'integer',
                nullable: false,
                default: 0
            }
        });
    },

    down: function(table, schema) {
        schema.alterColumn({
            tableName: 'User',
            table: {
                name: 'age',
                type: 'integer',
                nullable: true
            }
        });
    }
};
```

### Renaming Columns

```javascript
module.exports = {
    up: function(table, schema) {
        schema.renameColumn({
            tableName: 'User',
            name: 'username',
            newName: 'user_name'
        });
    },

    down: function(table, schema) {
        schema.renameColumn({
            tableName: 'User',
            name: 'user_name',
            newName: 'username'
        });
    }
};
```

## Seed Data

### Simple Seeding

```javascript
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.Role);

        // Seed individual records
        schema.seed('Role', {
            name: 'Admin',
            description: 'Administrator role'
        });

        schema.seed('Role', {
            name: 'User',
            description: 'Regular user role'
        });
    },

    down: function(table, schema) {
        schema.dropTable(table.Role);
    }
};
```

### Bulk Seeding (More Efficient)

```javascript
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.User);

        // Bulk insert multiple records at once
        schema.bulkSeed('User', [
            { name: 'Alice', email: 'alice@example.com', age: 25 },
            { name: 'Bob', email: 'bob@example.com', age: 30 },
            { name: 'Charlie', email: 'charlie@example.com', age: 35 },
            { name: 'Diana', email: 'diana@example.com', age: 28 }
        ]);
    },

    down: function(table, schema) {
        schema.dropTable(table.User);
    }
};
```

### Idempotent Seeds

Seeds are automatically idempotent (can run multiple times safely):

**SQLite**: Uses `INSERT OR IGNORE`
**MySQL**: Uses `INSERT IGNORE`
**PostgreSQL**: Uses `INSERT ... ON CONFLICT DO NOTHING`

**Note**: Idempotent seeding requires a unique constraint or primary key.

### Conditional Seeding

```javascript
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.Setting);

        // Only seed if running on specific database
        if(schema.context.isPostgres){
            schema.seed('Setting', {
                key: 'postgres_feature',
                value: 'enabled'
            });
        }

        if(schema.context.isMySQL){
            schema.seed('Setting', {
                key: 'mysql_feature',
                value: 'enabled'
            });
        }
    },

    down: function(table, schema) {
        schema.dropTable(table.Setting);
    }
};
```

## Migration Commands

### Create a New Migration

```bash
masterrecord add-migration <MigrationName> <ContextName>
```

Example:
```bash
masterrecord add-migration AddUserProfile context
```

### Run Migrations

```bash
masterrecord migrate <ContextName>
```

### Check Migration Status

Migrations are tracked in the snapshot file:
```
app/models/db/migrations/context_contextSnapShot.json
```

## Examples

### Example 1: E-Commerce Database

```javascript
// migrations/20250111_CreateECommerce.js
module.exports = {
    up: function(table, schema) {
        // Create tables
        schema.createTable(table.User);
        schema.createTable(table.Product);
        schema.createTable(table.Order);
        schema.createTable(table.OrderItem);

        // Seed categories
        schema.bulkSeed('Category', [
            { name: 'Electronics', slug: 'electronics' },
            { name: 'Clothing', slug: 'clothing' },
            { name: 'Books', slug: 'books' }
        ]);

        // Seed admin user
        schema.seed('User', {
            name: 'Admin',
            email: 'admin@shop.com',
            role: 'admin',
            created_at: new Date()
        });

        // Seed sample products
        schema.bulkSeed('Product', [
            {
                name: 'Laptop',
                price: 999.99,
                category_id: 1,
                stock: 50
            },
            {
                name: 'T-Shirt',
                price: 19.99,
                category_id: 2,
                stock: 200
            }
        ]);
    },

    down: function(table, schema) {
        schema.dropTable(table.OrderItem);
        schema.dropTable(table.Order);
        schema.dropTable(table.Product);
        schema.dropTable(table.Category);
        schema.dropTable(table.User);
    }
};
```

### Example 2: Blog with PostgreSQL-Specific Features

```javascript
// migrations/20250111_CreateBlog.js
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.Author);
        schema.createTable(table.Post);
        schema.createTable(table.Comment);

        // PostgreSQL-specific: JSON metadata
        if(schema.context.isPostgres){
            schema.addColumn({
                tableName: 'Post',
                name: 'metadata',
                type: 'jsonb'  // PostgreSQL binary JSON
            });

            schema.addColumn({
                tableName: 'Post',
                name: 'post_id',
                type: 'uuid'   // PostgreSQL native UUID
            });
        }

        // Seed authors
        schema.bulkSeed('Author', [
            { name: 'John Doe', email: 'john@blog.com', bio: 'Tech blogger' },
            { name: 'Jane Smith', email: 'jane@blog.com', bio: 'Travel writer' }
        ]);

        // Seed initial posts
        schema.seed('Post', {
            title: 'Welcome to Our Blog',
            content: 'This is our first post!',
            author_id: 1,
            published: true,
            created_at: new Date()
        });
    },

    down: function(table, schema) {
        schema.dropTable(table.Comment);
        schema.dropTable(table.Post);
        schema.dropTable(table.Author);
    }
};
```

### Example 3: Multi-Database Migration

```javascript
// migrations/20250111_AddUserPreferences.js
module.exports = {
    up: function(table, schema) {
        // Works across all databases
        schema.addColumn({
            tableName: 'User',
            name: 'preferences',
            type: 'text'  // JSON stored as text for compatibility
        });

        // Database-specific optimizations
        if(schema.context.isPostgres){
            // PostgreSQL: Use native JSONB for better performance
            schema.alterColumn({
                tableName: 'User',
                table: {
                    name: 'preferences',
                    type: 'jsonb'
                }
            });
        }

        // Seed default preferences
        const defaultPrefs = JSON.stringify({
            theme: 'light',
            notifications: true,
            language: 'en'
        });

        schema.seed('User', {
            name: 'Demo User',
            email: 'demo@example.com',
            preferences: defaultPrefs
        });
    },

    down: function(table, schema) {
        schema.dropColumn({
            tableName: 'User',
            name: 'preferences'
        });
    }
};
```

## Database-Specific Features

### PostgreSQL Features

```javascript
module.exports = {
    up: function(table, schema) {
        if(schema.context.isPostgres){
            // JSONB for better JSON performance
            schema.addColumn({
                tableName: 'User',
                name: 'settings',
                type: 'jsonb'
            });

            // Native UUID support
            schema.addColumn({
                tableName: 'User',
                name: 'uuid',
                type: 'uuid'
            });

            // Native BOOLEAN type
            schema.addColumn({
                tableName: 'User',
                name: 'active',
                type: 'boolean',
                default: true
            });

            // BYTEA for binary data
            schema.addColumn({
                tableName: 'User',
                name: 'avatar',
                type: 'binary'  // Maps to BYTEA in PostgreSQL
            });
        }
    },

    down: function(table, schema) {
        // Cleanup
    }
};
```

### MySQL Features

```javascript
module.exports = {
    up: function(table, schema) {
        if(schema.context.isMySQL){
            // JSON type
            schema.addColumn({
                tableName: 'User',
                name: 'settings',
                type: 'json'
            });

            // TINYINT for booleans (0/1)
            schema.addColumn({
                tableName: 'User',
                name: 'active',
                type: 'boolean'  // Maps to TINYINT
            });

            // AUTO_INCREMENT
            // (handled automatically for primary keys)
        }
    },

    down: function(table, schema) {
        // Cleanup
    }
};
```

### SQLite Features

```javascript
module.exports = {
    up: function(table, schema) {
        if(schema.context.isSQLite){
            // TEXT for everything
            // INTEGER for booleans (0/1)
            // AUTOINCREMENT for primary keys

            // SQLite requires table rebuild for certain alterations
            // MasterRecord handles this automatically
        }
    },

    down: function(table, schema) {
        // Cleanup
    }
};
```

## Best Practices

### 1. Always Provide Down Migrations

```javascript
// ✅ GOOD
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.User);
    },
    down: function(table, schema) {
        schema.dropTable(table.User);
    }
};

// ❌ BAD
module.exports = {
    up: function(table, schema) {
        schema.createTable(table.User);
    },
    down: function(table, schema) {
        // Empty - can't rollback!
    }
};
```

### 2. Use Bulk Seeding for Multiple Records

```javascript
// ✅ GOOD - Single query
schema.bulkSeed('User', [
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' }
]);

// ❌ BAD - Multiple queries
schema.seed('User', { name: 'Alice', email: 'alice@example.com' });
schema.seed('User', { name: 'Bob', email: 'bob@example.com' });
```

### 3. Test Migrations on All Databases

If your app supports multiple databases, test migrations on each:

```bash
# Test on SQLite
DATABASE_TYPE=sqlite masterrecord migrate context

# Test on MySQL
DATABASE_TYPE=mysql masterrecord migrate context

# Test on PostgreSQL
DATABASE_TYPE=postgres masterrecord migrate context
```

### 4. Keep Migrations Small and Focused

```javascript
// ✅ GOOD - One logical change
// Migration: AddUserPhoneNumber
schema.addColumn({
    tableName: 'User',
    name: 'phone',
    type: 'string'
});

// ❌ BAD - Too many unrelated changes
schema.addColumn({ tableName: 'User', name: 'phone', type: 'string' });
schema.addColumn({ tableName: 'Post', name: 'views', type: 'integer' });
schema.createTable(table.Comment);
schema.seed('Setting', { key: 'version', value: '2.0' });
```

### 5. Use Timestamps for Migration Names

MasterRecord automatically adds timestamps to migration files:
```
20250111_143052_CreateUserTable.js
20250111_150023_AddUserEmail.js
```

This ensures migrations run in the correct order.

## Troubleshooting

### Migration Not Found

**Error**: "Cannot find migration file"

**Solution**: Ensure migration is in the correct directory:
```
app/models/db/migrations/
```

### Context Not Found

**Error**: "Cannot find context"

**Solution**: Provide full path or context name:
```bash
masterrecord migrate context
# or
masterrecord migrate ./app/models/context.js
```

### Seed Data Not Idempotent

**Error**: Duplicate key violations on repeated migrations

**Solution**: Ensure tables have primary keys or unique constraints:
```javascript
schema.createTable(table.User); // User entity must have primary key
schema.seed('User', { id: 1, name: 'Admin' }); // Include PK in seed
```

### PostgreSQL Permission Errors

**Error**: "permission denied for table"

**Solution**: Ensure your PostgreSQL user has appropriate permissions:
```sql
GRANT ALL PRIVILEGES ON DATABASE mydb TO myuser;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO myuser;
```

## Version Compatibility

- **MasterRecord**: 0.3.0+
- **PostgreSQL**: 9.6+ (tested with 12+, 13+, 14+, 15+, 16+)
- **MySQL**: 5.7+ (tested with 8.0+)
- **SQLite**: 3.x (any recent version)
- **Node.js**: 14+ (async/await support required)

## Additional Resources

- [PostgreSQL Setup Guide](./POSTGRESQL_SETUP.md)
- [Entity Definitions](./ENTITIES.md)
- [MasterRecord API Reference](./API_REFERENCE.md)

## License

MIT License - see LICENSE file for details
