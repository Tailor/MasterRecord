# MasterRecord Troubleshooting Guide

This guide covers common issues and potential pitfalls when using MasterRecord.

## Navigation Properties vs Regular Properties

### Understanding the Difference

MasterRecord provides **two different ways** to access related entities, and mixing them causes bugs.

#### 1. Navigation Properties (Lazy Loading)

When you access a related entity using a **capital letter that matches the entity name**, MasterRecord treats it as a navigation property with lazy loading:

```javascript
// Accessing with capital letter triggers lazy loading
const auth = await user.Auth;  // Executes a database query
```

**How it works:**
- MasterRecord looks up the entity definition in your context
- Executes a SQL query to load the related record
- Returns a **Promise** that must be awaited
- Defined in your entity's relationship configuration (hasOne, hasMany, belongsTo)

#### 2. Regular Properties (Direct Access)

When you manually attach an object to an entity as a regular property, you access it directly:

```javascript
// Attach as regular property (any case except navigation property name)
user.auth = someAuthObject;  // lowercase

// Access directly - no query, just returns the object
console.log(user.auth.password_hash);  // Immediate access
```

### Common Bug: Mixing Both Approaches

**❌ THIS CAUSES BUGS:**

```javascript
// In authService.js - attaching as regular property (lowercase)
async findAuthByEmail(email, context) {
    var user = await context.User
        .where(r => r.email.toLowerCase() == $$, email.toLowerCase())
        .single();

    var auth = await context.Auth
        .where(a => a.user_id == $$, user.id)
        .single();

    // Attaching as lowercase regular property
    user.auth = auth;
    return user;
}

// In credentialsController.js - accessing as navigation property (capital)
async login(req) {
    var authObj = await req.authService.authenticate(email, password, req.userContext);

    // ❌ BUG: Accessing as capital triggers navigation property!
    authObj.user.Auth.temp_access_token = refreshToken;  // Returns Promise, not auth object!
    req.userContext.saveChanges();  // Doesn't save - Promise isn't resolved
}
```

**What happens:**
1. `findAuthByEmail()` attaches auth as `user.auth` (lowercase regular property)
2. `credentialsController` tries to access `user.Auth` (capital navigation property)
3. MasterRecord sees the capital letter and thinks "navigation property!"
4. It executes a lazy loading query and returns a Promise
5. The Promise isn't awaited, so you get `undefined` or the Promise object itself
6. Your data doesn't save, properties return undefined, bcrypt fails with "Illegal arguments"

### Solutions

#### Option 1: Use Regular Properties (Recommended when entity already loaded)

**✅ CORRECT:**

```javascript
// Attach as lowercase regular property
user.auth = auth;

// Access as lowercase regular property
authObj.user.auth.temp_access_token = refreshToken;
authObj.user.auth.login_counter = authObj.user.auth.login_counter + 1;
req.userContext.saveChanges();
```

**Benefits:**
- ✅ No extra database queries
- ✅ Synchronous access
- ✅ More performant

**Use when:**
- You've already loaded the related entity with an explicit query
- You want direct access without database overhead
- You need synchronous property access

#### Option 2: Use Navigation Properties with Await (When you want lazy loading)

**✅ CORRECT:**

```javascript
// Access navigation property with await
const auth = await authObj.user.Auth;  // Must await!
auth.temp_access_token = refreshToken;
auth.login_counter = auth.login_counter + 1;
req.userContext.saveChanges();
```

**Benefits:**
- ✅ Automatic loading of related entities
- ✅ Works without manual queries

**Drawbacks:**
- ❌ Extra database query (even if you already loaded it)
- ❌ Must remember to await
- ❌ Async only

**Use when:**
- You want lazy loading behavior
- You haven't already loaded the related entity
- You're okay with the extra database query

### Best Practice: Be Consistent

The key is **consistency** - pick one approach per relationship and stick with it:

```javascript
// Good: Explicit loading + regular properties
async findAuthByEmail(email, context) {
    const user = await context.User.where(r => r.email == $$, email).single();
    const auth = await context.Auth.where(a => a.user_id == $$, user.id).single();
    user.auth = auth;  // lowercase
    return user;
}

// Access consistently with lowercase
authObj.user.auth.temp_access_token = refreshToken;  // lowercase
```

OR

```javascript
// Good: Let navigation properties do the work
async findAuthByEmail(email, context) {
    const user = await context.User.where(r => r.email == $$, email).single();
    // Don't manually load auth - let navigation property handle it
    return user;
}

// Access with await
const auth = await authObj.user.Auth;  // capital + await
auth.temp_access_token = refreshToken;
```

### Real-World Example: Authentication Bug

This bug was found in a production authentication system where login succeeded but immediately redirected back to the login page.

**The Problem:**
```javascript
// authService.js - Line 306
user.auth = auth;  // Attaching as lowercase

// credentialsController.js - Line 287-288
authObj.user.Auth.temp_access_token = refreshToken;  // ❌ Accessing as capital!
req.userContext.saveChanges();
```

**What happened:**
1. JWT token was generated correctly
2. `authObj.user.Auth.temp_access_token = refreshToken` didn't actually save the token
3. It set the property on a Promise object instead of the auth entity
4. Database query `WHERE temp_access_token = ?` returned no results
5. `currentUser()` check failed
6. User was redirected back to login

**The Fix:**
```javascript
// credentialsController.js - Line 287-288
authObj.user.auth.temp_access_token = refreshToken;  // ✅ lowercase matches attachment
authObj.user.auth.login_counter = authObj.user.auth.login_counter + 1;
req.userContext.saveChanges();  // Now it actually saves!
```

### Debugging Tips

If you're seeing any of these symptoms:
- Properties returning `undefined` when you know they exist in the database
- `bcrypt.compareSync()` failing with "Illegal arguments: string, undefined"
- Data not saving when you call `saveChanges()`
- `[object Promise]` appearing in logs instead of actual values
- Queries executing successfully but entities seem empty

**Check for navigation property mismatches:**

1. Add debug logging:
```javascript
console.log('Type of user.Auth:', typeof user.Auth);
console.log('Is Promise?', user.Auth instanceof Promise);
console.log('Value:', user.Auth);
```

2. Look for:
   - Capital letter access (`user.Auth`, `auth.User`) without `await`
   - Mixing lowercase attachment with capital access
   - Accessing navigation properties in non-async contexts

3. Fix by:
   - Making access match attachment (both lowercase)
   - OR using `await` with capital navigation properties
   - OR explicitly loading entities instead of relying on lazy loading

### Additional Examples

#### Creating New Entities with Relationships

When creating new entities, you can use capital letters during construction:

```javascript
// ✅ This is fine - entity not yet persisted
var user = new userEntity();
var auth = new authEntity();
user.Auth = auth;  // Capital is OK here
auth.password_hash = bcrypt.hashSync(password, salt);
context.User.add(user);
await context.saveChanges();

// ❌ After saveChanges, use regular property or reload
// Store reference to avoid navigation property
auth.temp_access_token = refreshToken;  // Use stored reference
await context.saveChanges();

// ❌ DON'T DO THIS after saveChanges:
user.Auth.temp_access_token = refreshToken;  // Triggers navigation property!
```

#### Working with Loaded Entities

```javascript
// Load user from database
const user = await context.User.where(r => r.id == $$, userId).single();

// ✅ Option 1: Explicitly load and attach
const auth = await context.Auth.where(a => a.user_id == $$, user.id).single();
user.auth = auth;  // lowercase
console.log(user.auth.password_hash);  // Direct access

// ✅ Option 2: Use navigation property with await
const auth = await user.Auth;  // capital + await
console.log(auth.password_hash);

// ❌ DON'T MIX:
user.auth = await context.Auth.where(a => a.user_id == $$, user.id).single();
console.log(user.Auth.password_hash);  // Wrong! This is navigation property
```

## Summary

- **Navigation properties** (capital letter) = lazy loading = returns Promise = must await
- **Regular properties** (lowercase or any non-entity name) = direct access = immediate value
- **Never mix them** - be consistent in how you attach and access related entities
- **When in doubt**, explicitly load entities and use lowercase regular properties
- **Add debug logging** to catch Promise objects being treated as entities

This pattern is consistent throughout MasterRecord and applies to all relationship types: `hasOne`, `hasMany`, `belongsTo`, and `hasManyThrough`.

---

## "Cannot read properties of undefined (reading 'set')" on FK assignment

If you see this error setting a foreign-key column on a loaded entity:

```javascript
const step = await ctx.Step.findById(1);
step.run_id = 'run_beta';  // ← TypeError before v1.1.3
await step.save();
```

**Cause:** before v1.1.3, the entity tracker's setter dereferenced `__entity['run_id'].set` without a null guard. The `belongsTo('Run')` definition only registers the navigation property `Run` (with `foreignKey: 'run_id'`) — there is no `run_id` field on `__entity`, so `__entity['run_id']` is `undefined` and accessing `.set` on it threw.

**Fix:** upgrade to **v1.1.3 or later**. Both `step.Run = id` and `step.run_id = id` are now safe and produce identical persisted state.

If you can't upgrade, the workaround is to use the navigation property: `step.Run = id`, or to drop to raw SQL via `ctx.db`.

---

## A column added by migration isn't seen by `.new()` until I restart Node

If you add a column via a migration, update the entity class to declare it, and assignments to the new field still don't track:

```javascript
// 1. Migration adds `step.created_at`
// 2. You add `created_at(db) { db.string(); }` to Step.js
// 3. Without restarting Node:
const step = ctx.Step.new();
step.created_at = String(Date.now());  // ← stored as a plain JS prop, INSERT misses it
```

**Cause:** Node ESM module cache is process-lifetime. The context built `__entity` from the Step class *as it was when the process started*. Editing Step.js doesn't update the in-memory class — and therefore doesn't update `__entity`.

**Fix:** restart the Node process. There is no library-level fix; this is how Node module loading works.

Until restart, the workaround is to set the field via the engine-agnostic raw escape hatch — `await ctx.execute('INSERT INTO Step (...) VALUES (?, ?)', [...])` (works on every engine) — or, for fields that exist in the DB but not the class definition, lazy-load the entity (which iterates the DB row's actual columns and creates setters for them on the instance, even if the class doesn't declare them).

---

## `TypeError: ctx.db.prepare is not a function` (MySQL / Postgres)

`ctx.db` is the **raw, engine-specific driver**. On SQLite it's a better-sqlite3 database (which has `.prepare()/.get()/.run()/.all()`); on MySQL it's a mysql2 pool and on Postgres a pg pool — neither has `.prepare()`. Code written against `ctx.db.prepare(...)` therefore works on SQLite and throws on MySQL/Postgres.

**Fix:** use the engine-agnostic raw-SQL escape hatch (since v1.2.7):

```javascript
const rows = await ctx.query('SELECT * FROM "User" WHERE id = $1', [id]);   // returns rows, all engines
await ctx.execute('UPDATE "User" SET name = ? WHERE id = ?', ['Alice', id]);
```

Better still, prefer the ORM (`ctx.User.where(u => u.id == $$, id).single()`), which is portable by construction. On a non-SQLite engine, `ctx.db.prepare()` now throws a descriptive error pointing you to `ctx.query()`.
