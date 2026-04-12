# PostgreSQL Setup for MasterRecord

Complete guide for using PostgreSQL with MasterRecord ORM.

## Installation

```bash
npm install pg@^8.16.3
```

## Basic Setup

### 1. Initialize PostgreSQL Connection

```javascript
import context from 'masterrecord/context';

// Create a new context
const db = new context();

// Configure PostgreSQL connection
await db.env({
    type: 'postgres',  // or 'postgresql'
    host: 'localhost',
    port: 5432,
    database: 'your_database',
    user: 'your_user',
    password: 'your_password',
    max: 20,                        // Maximum pool size
    idleTimeoutMillis: 30000,      // Idle connection timeout
    connectionTimeoutMillis: 2000   // Connection timeout
});
```

### 2. Define Entities

```javascript
const User = db.dbset('User')
    .key('id').auto()
    .field('name').string().notNull()
    .field('email').string().notNull()
    .field('age').integer().nullable()
    .field('created_at').datetime()
    .create();
```

### 3. Query with Parameterized Placeholders

MasterRecord automatically handles PostgreSQL's `$1, $2, $3...` placeholder format:

```javascript
// Single parameter
const user = db.User
    .where(u => u.email == $$, 'john@example.com')
    .single();

// Multiple parameters
const users = db.User
    .where(u => u.age > $$ && u.status == $$, 25, 'active')
    .all();

// OR conditions with single $ placeholder
const results = db.User
    .where(u => u.status == $ || u.status == null, 'active')
    .all();
```

### 4. Insert Records

```javascript
const newUser = db.User.new();
newUser.name = 'Jane Smith';
newUser.email = 'jane@example.com';
newUser.age = 28;
newUser.created_at = new Date();

// Save to database
await db.saveChanges();

// ID is available after saveChanges()
console.log(newUser.id); // PostgreSQL auto-increment ID
```

### 5. Update Records

```javascript
const user = db.User
    .where(u => u.id == $$, 123)
    .single();

user.age = 30;
await db.saveChanges();
```

### 6. Delete Records

```javascript
const user = db.User.findById(123);
db.remove(user);
await db.saveChanges();
```

## Advanced Features

### Transactions

```javascript
import PostgresSyncConnect from 'masterrecord/postgresSyncConnect';

const connection = new PostgresSyncConnect();
await connection.connect(config);

// Execute in transaction
const result = await connection.transaction(async (client) => {
    // Insert
    const userResult = await client.query(
        'INSERT INTO User (name, email) VALUES ($1, $2) RETURNING id',
        ['Bob', 'bob@example.com']
    );

    // Update
    await client.query(
        'UPDATE User SET verified = $1 WHERE id = $2',
        [true, userResult.rows[0].id]
    );

    return userResult.rows[0].id;
});
```

### IN Clauses with .any()

```javascript
// Array parameter
const users = db.User
    .where(u => u.id.any($$), [1, 2, 3, 4, 5])
    .all();

// Comma-separated string (auto-splits)
const ids = '10,20,30,40';
const users = db.User
    .where(u => u.id.any($$), ids)
    .all();
```

### Array Filtering with .includes()

```javascript
const tags = ['javascript', 'node', 'postgres'];
const posts = db.Post
    .where(p => $$.includes(p.category), tags)
    .all();
```

### Find by Primary Key

```javascript
// Convenience method - auto-detects primary key
const user = db.User.findById(123);

// Equivalent to:
const user = db.User
    .where(u => u.id == $$, 123)
    .single();
```

### Pagination

```javascript
// Skip 20, take 10
const users = db.User
    .orderBy('created_at')
    .skip(20)
    .take(10)
    .all();

// PostgreSQL generates: LIMIT 10 OFFSET 20
```

### Joins

```javascript
const userPosts = db.User
    .join('Post', (u, p) => u.id == p.user_id)
    .where(u => u.id == $$, 123)
    .all();
```

### NULL Handling

```javascript
// Find users with no email
const users = db.User
    .where(u => u.email == null)
    .all();

// Find users with email OR age is null
const users = db.User
    .where(u => u.email != null)
    .and(u => u.age == null)
    .all();
```

## Connection Management

### Health Check

```javascript
const health = await connection.healthCheck();

if (health.healthy) {
    console.log('Server time:', health.serverTime);
    console.log('PostgreSQL version:', health.version);
    console.log('Pool size:', health.poolSize);
    console.log('Idle connections:', health.idleCount);
}
```

### Connection Info

```javascript
const info = connection.getConnectionInfo();
console.log(`Connected to ${info.database} at ${info.host}:${info.port}`);
console.log(`Max connections: ${info.maxConnections}`);
```

### Close Connection

```javascript
await connection.close();
```

## Placeholder Syntax Reference

MasterRecord uses double dollar signs (`$$`) for placeholders that get converted to PostgreSQL format:

| MasterRecord Syntax | PostgreSQL SQL | Parameters |
|---------------------|----------------|------------|
| `.where(u => u.id == $$, 5)` | `WHERE id = $1` | `[5]` |
| `.where(u => u.age > $$ && u.status == $$, 25, 'active')` | `WHERE age > $1 AND status = $2` | `[25, 'active']` |
| `.where(u => u.id.any($$), [1,2,3])` | `WHERE id IN ($1, $2, $3)` | `[1, 2, 3]` |

**Single `$` for OR conditions:**
```javascript
.where(u => u.status == $ || u.status == null, 'active')
// Generates: WHERE status = $1 OR status IS NULL
```

## Field Transformers

Custom serialization for complex types:

```javascript
const Post = db.dbset('Post')
    .key('id').auto()
    .field('title').string()
    .field('tags').string().transform({
        toDatabase: (value) => {
            // Array → JSON string
            return Array.isArray(value) ? JSON.stringify(value) : value;
        },
        fromDatabase: (value) => {
            // JSON string → Array
            return typeof value === 'string' ? JSON.parse(value) : value;
        }
    })
    .create();

// Use as array in code
const post = db.Post.new();
post.tags = ['javascript', 'postgres', 'node'];
await db.saveChanges();

// Stored as: '["javascript","postgres","node"]'
// Retrieved as: ['javascript', 'postgres', 'node']
```

## Performance Tips

1. **Use Connection Pooling**: Adjust `max` pool size based on your needs
2. **Parameterized Queries**: Always use `$$` placeholders (automatic SQL injection protection)
3. **Indexes**: Create indexes on frequently queried columns
4. **Pagination**: Use `.skip()` and `.take()` for large result sets
5. **Transactions**: Group related operations in transactions

## Common Issues

### Issue: "Cannot find module 'pg'"
**Solution**: Install pg library: `npm install pg@^8.16.3`

### Issue: "Connection refused"
**Solution**: Ensure PostgreSQL is running on the specified host/port

### Issue: "database does not exist"
**Solution**: Create the database first:
```sql
CREATE DATABASE your_database;
```

### Issue: "password authentication failed"
**Solution**: Check your credentials and pg_hba.conf settings

### Issue: "too many clients"
**Solution**: Reduce `max` pool size or increase PostgreSQL's max_connections

## Migration from MySQL/SQLite

Key differences when migrating to PostgreSQL:

1. **Placeholder Format**:
   - MySQL/SQLite: `?`
   - PostgreSQL: `$1, $2, $3...`
   - MasterRecord handles this automatically with `$$`

2. **Auto-increment**:
   - MySQL: `AUTO_INCREMENT`
   - PostgreSQL: `SERIAL` or `BIGSERIAL`
   - MasterRecord uses `.auto()` for both

3. **Boolean Type**:
   - SQLite: 0/1
   - PostgreSQL: true/false
   - MasterRecord handles type coercion

4. **Date/Time**:
   - Both use Date objects in JavaScript
   - PostgreSQL has more precise timestamp handling

5. **RETURNING Clause**:
   - PostgreSQL requires `RETURNING id` for INSERT
   - MasterRecord adds this automatically

## Testing

Run PostgreSQL tests:

```bash
# Unit tests (no database required)
node test/postgresEngineTest.js

# Integration tests (requires PostgreSQL running)
node test/postgresIntegrationTest.js
```

## Version Compatibility

- **MasterRecord**: 0.3.0+
- **pg (node-postgres)**: 8.16.3+
- **PostgreSQL Server**: 9.6+ (tested with 12+, 13+, 14+)
- **Node.js**: 20+ (ESM-only package)

## Complete Example

```javascript
import context from 'masterrecord/context';

async function main() {
    // Initialize
    const db = new context();
    await db.env({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'myapp',
        user: 'postgres',
        password: 'password',
        max: 20
    });

    // Define entity
    const User = db.dbset('User')
        .key('id').auto()
        .field('name').string().notNull()
        .field('email').string().notNull()
        .field('age').integer()
        .create();

    // Create
    const newUser = db.User.new();
    newUser.name = 'Alice';
    newUser.email = 'alice@example.com';
    newUser.age = 25;
    await db.saveChanges();

    // Read
    const user = db.User.findById(newUser.id);
    console.log(user.name); // "Alice"

    // Update
    user.age = 26;
    await db.saveChanges();

    // Query
    const adults = db.User
        .where(u => u.age >= $$, 18)
        .orderBy('name')
        .all();

    // Delete
    db.remove(user);
    await db.saveChanges();
}

main();
```

## Support

For issues or questions:
- GitHub: [MasterRecord Issues](https://github.com/yourusername/MasterRecord/issues)
- Documentation: [docs/](../docs/)

## License

MIT License - see LICENSE file for details
