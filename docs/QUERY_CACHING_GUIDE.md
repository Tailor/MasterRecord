# Query Caching Guide - Like Active Record

MasterRecord's query caching works like **Active Record** in Rails:
- **Opt-in** with `.cache()`
- **Request-scoped** (cleared after each request)
- **Automatic invalidation** on data changes

---

## Quick Start

### 1. Express Middleware (Recommended)

```javascript
import express from 'express';
import AppContext from './models/AppContext.js';

const app = express();

// Middleware: Create context per request, auto-clear cache
app.use((req, res, next) => {
    req.db = new AppContext();

    // Clear cache when request ends (like Active Record)
    res.on('finish', () => {
        req.db.endRequest();
    });

    next();
});

// Routes
app.get('/api/categories', async (req, res) => {
    // Opt-in caching with .cache()
    const categories = await req.db.Categories.cache().toList();
    res.json(categories);
    // Cache auto-cleared after response
});

app.get('/api/users/:id', (req, res) => {
    // No .cache() = always fresh (default)
    const user = req.db.User.findById(req.params.id);
    res.json(user);
});

app.listen(3000);
```

---

## How It Works

### Default Behavior (No Caching)

```javascript
// Without .cache() - always hits database
const user1 = db.User.findById(1);  // DB query
const user2 = db.User.findById(1);  // DB query again (no cache)
```

### Opt-In Caching

```javascript
// With .cache() - caches result
const categories1 = db.Categories.cache().toList();  // DB query, cached
const categories2 = db.Categories.cache().toList();  // Cache hit!
```

### Request-Scoped (Auto-Clear)

```javascript
// Request 1
app.get('/route1', (req, res) => {
    const cats = req.db.Categories.cache().toList();  // DB query
    res.json(cats);
    // Cache cleared after response
});

// Request 2 - starts with empty cache
app.get('/route2', (req, res) => {
    const cats = req.db.Categories.cache().toList();  // DB query again (fresh)
    res.json(cats);
});
```

---

## When to Use `.cache()`

### ✅ DO use .cache() for:

```javascript
// Reference data (rarely changes)
const categories = db.Categories.cache().toList();
const countries = db.Countries.cache().toList();
const settings = db.Settings.cache().toList();

// Expensive aggregations (within a request)
const totalOrders = db.Orders
    .where(o => o.status == $$, 'completed')
    .cache()
    .count();

// Lookup tables
const roles = db.Roles.cache().toList();
const permissions = db.Permissions.cache().toList();
```

### ❌ DON'T use .cache() for:

```javascript
// User-specific data (default is safe)
const user = db.User.findById(userId);  // No .cache()

// Real-time data
const liveOrders = db.Orders
    .where(o => o.status == $$, 'pending')
    .toList();  // No .cache()

// Financial/sensitive data
const transactions = db.Transactions
    .where(t => t.user_id == $$, userId)
    .toList();  // No .cache()
```

---

## Complete Examples

### Example 1: E-Commerce API

```javascript
import express from 'express';
import AppContext from './models/AppContext.js';

const app = express();

// Middleware: Request-scoped caching
app.use((req, res, next) => {
    req.db = new AppContext();
    res.on('finish', () => req.db.endRequest());
    next();
});

// Categories - cache (rarely changes)
app.get('/api/categories', (req, res) => {
    const categories = req.db.Categories
        .cache()  // Cache for this request
        .toList();
    res.json(categories);
});

// Products - cache (within request)
app.get('/api/products', (req, res) => {
    const products = req.db.Products
        .where(p => p.active == true)
        .cache()  // Cache for this request
        .toList();
    res.json(products);
});

// User profile - NO cache (user-specific)
app.get('/api/profile', (req, res) => {
    const user = req.db.User.findById(req.user.id);  // No .cache()
    res.json(user);
});

// Cart - NO cache (real-time)
app.get('/api/cart', (req, res) => {
    const cart = req.db.Cart
        .where(c => c.user_id == $$, req.user.id)
        .toList();  // No .cache()
    res.json(cart);
});

app.listen(3000);
```

### Example 2: Admin Dashboard

```javascript
app.get('/admin/dashboard', async (req, res) => {
    const db = new AppContext();

    // Multiple queries with caching
    const stats = {
        // Cache expensive aggregations
        totalUsers: db.User.cache().count(),
        totalOrders: db.Orders.cache().count(),

        // Cache reference data
        categories: db.Categories.cache().toList(),

        // No cache for real-time data
        recentOrders: db.Orders
            .orderByDescending(o => o.created_at)
            .take(10)
            .toList()  // No .cache() - always fresh
    };

    res.render('dashboard', stats);

    // Clear cache after response
    db.endRequest();
});
```

### Example 3: Background Job

```javascript
// Cron job - process orders
cron.schedule('*/5 * * * *', async () => {
    const db = new AppContext();

    // Get pending orders (no cache - real-time)
    const orders = db.Orders
        .where(o => o.status == $$, 'pending')
        .toList();  // No .cache()

    for (const order of orders) {
        await processOrder(order);
        order.status = 'processed';
    }

    await db.saveChanges();  // Invalidates cache

    // Clear cache after job
    db.endRequest();
});
```

---

## Cache Invalidation

Cache is automatically invalidated when you modify data:

```javascript
app.post('/api/categories', (req, res) => {
    const db = new AppContext();

    // Cache categories
    const cats = db.Categories.cache().toList();  // DB query, cached

    // Add new category
    const newCat = db.Categories.new();
    newCat.name = req.body.name;
    db.saveChanges();  // Automatically invalidates Categories cache!

    // Next query hits database (fresh)
    const freshCats = db.Categories.cache().toList();  // DB query (not cached)

    res.json(newCat);
    db.endRequest();
});
```

---

## Comparison with Active Record

### Active Record (Rails)

```ruby
# Rails controller
class CategoriesController < ApplicationController
  def index
    # Query cache automatically enabled for request
    @categories = Category.where(active: true).to_a
    # Cache automatically cleared after request
  end
end
```

### MasterRecord (Node.js)

```javascript
// Express route
app.get('/categories', (req, res) => {
    // Opt-in caching with .cache()
    const categories = req.db.Categories
        .where(c => c.active == true)
        .cache()  // Explicitly opt-in
        .toList();
    res.json(categories);
    // Cache cleared by middleware
});
```

**Key differences:**
- Active Record: Cache **enabled by default** for all queries
- MasterRecord: Cache **opt-in** with `.cache()` (safer)
- Both: **Request-scoped** (cleared after each request)

---

## Configuration

### Environment Variables

```bash
# .env
QUERY_CACHE_TTL=5000               # 5 seconds (request-scoped)
QUERY_CACHE_SIZE=1000              # Max 1000 cached queries
QUERY_CACHE_ENABLED=true           # Enable caching
```

### Custom TTL per Query

```javascript
// Use default TTL (5 seconds)
const cats = db.Categories.cache().toList();

// For longer-lived cache, increase TTL in config:
// QUERY_CACHE_TTL=60000  // 1 minute
```

---

## Testing

### Unit Tests

```javascript
import { describe, test, beforeEach, afterEach } from 'node:test';
import AppContext from '../models/AppContext.js';

describe('Category API', () => {
    let db;

    beforeEach(() => {
        db = new AppContext();
    });

    afterEach(() => {
        db.endRequest();  // Clear cache after each test
    });

    it('caches category queries', () => {
        const cats1 = db.Categories.cache().toList();
        const cats2 = db.Categories.cache().toList();

        const stats = db.getCacheStats();
        expect(stats.hits).toBe(1);  // Second query hit cache
    });

    it('does not cache without .cache()', () => {
        const cats1 = db.Categories.toList();  // No .cache()
        const cats2 = db.Categories.toList();  // No .cache()

        const stats = db.getCacheStats();
        expect(stats.size).toBe(0);  // Nothing cached
    });
});
```

---

## Best Practices

### ✅ DO:
- Use middleware to auto-clear cache per request
- Cache reference data (categories, settings, countries)
- Cache within a request for duplicate queries
- Call `db.endRequest()` at end of request
- Monitor cache stats in development

### ❌ DON'T:
- Cache user-specific data
- Cache real-time data
- Cache financial/sensitive data
- Forget to call `endRequest()` in long-running processes
- Use `.cache()` on frequently updated tables

---

## Troubleshooting

### Cache not clearing between requests

```javascript
// ❌ BAD: No cache clearing
app.use((req, res, next) => {
    req.db = new AppContext();
    next();
});

// ✅ GOOD: Auto-clear cache
app.use((req, res, next) => {
    req.db = new AppContext();
    res.on('finish', () => req.db.endRequest());  // Clear cache
    next();
});
```

### Stale data across requests

```javascript
// Check TTL - should be short (5 seconds default)
console.log(process.env.QUERY_CACHE_TTL);  // Should be 5000

// Make sure endRequest() is called
db.endRequest();  // Clears cache
```

### Low cache hit rate

```javascript
// Check if queries are actually using .cache()
const stats = db.getCacheStats();
console.log(stats);
// {
//   size: 0,      // No cached queries?
//   hits: 0,      // No cache hits?
//   misses: 10    // All misses?
// }

// Make sure to use .cache()
const cats = db.Categories.cache().toList();  // Must have .cache()!
```

---

## Summary

**MasterRecord caching = Active Record style:**

1. **Opt-in** with `.cache()` (safer than default-on)
2. **Request-scoped** with `endRequest()` (auto-clear)
3. **Automatic invalidation** on `saveChanges()`

**Use it like this:**
```javascript
// Setup (once)
app.use((req, res, next) => {
    req.db = new AppContext();
    res.on('finish', () => req.db.endRequest());
    next();
});

// Use (in routes)
const categories = req.db.Categories.cache().toList();  // Cached
const user = req.db.User.findById(id);  // Not cached (default)
```

**It just works!** ✅
