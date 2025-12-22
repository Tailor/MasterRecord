# MasterRecord Methods Reference

## Common Confusion: Dbset Methods vs Lambda Functions

MasterRecord has two types of methods that are often confused:

### 1. Dbset Methods (Called on context.EntityName)

These are methods you call **directly on the dbset**:

```javascript
const user = context.User.new();              // ✅ Dbset method
context.User.add(user);                        // ✅ Dbset method
context.User.where(u => u.id == $, 1);        // ✅ Dbset method
context.User.toList();                         // ✅ Dbset method
context.User.single();                         // ✅ Dbset method
context.User.remove(user);                     // ✅ Dbset method
```

**Location**: `QueryLanguage/queryMethods.js`

### 2. Lambda Expression Functions (Used inside WHERE/AND clauses)

These are **functions used INSIDE the lambda expression string**:

```javascript
// ✅ .any() - Used inside lambda
context.User.where(u => u.id.any($$), "1,2,3").toList();

// ✅ .like() - Used inside lambda
context.User.where(u => u.name.like($$), "John%").toList();

// ✅ .includes() - Used inside lambda (transforms to .any())
context.User.where(u => $$.includes(u.id), [1, 2, 3]).toList();
```

**Location**: `QueryLanguage/queryScript.js` (parsed from lambda string)

---

## Complete Method List

### Dbset Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.new()` | Create new entity instance | `const user = context.User.new();` |
| `.add(entity)` | Track entity for INSERT | `context.User.add(user);` |
| `.remove(entity)` | Track entity for DELETE | `context.User.remove(user);` |
| `.where(lambda, ...args)` | Filter query | `context.User.where(u => u.id == $, 1)` |
| `.and(lambda, ...args)` | Add AND condition | `.where(...).and(u => u.active == true)` |
| `.orderBy(lambda)` | Sort ascending | `.orderBy(u => u.name)` |
| `.orderByDescending(lambda)` | Sort descending | `.orderByDescending(u => u.created_at)` |
| `.take(n)` | Limit results | `.take(10)` |
| `.skip(n)` | Offset results | `.skip(20)` |
| `.toList()` | Execute and return array | `.where(...).toList()` |
| `.single()` | Execute and return one | `.where(...).single()` |
| `.first()` | Execute and return first | `.where(...).first()` |
| `.include(lambda)` | Eager load relationships | `.include(u => u.Posts)` |
| `.raw(sql)` | Execute raw SQL | `.raw("SELECT * FROM User")` |

### Lambda Expression Functions

| Function | Used Inside | Description | Example |
|----------|-------------|-------------|---------|
| `.any($$)` | WHERE/AND | IN clause (comma-separated) | `u => u.id.any($$), "1,2,3"` |
| `.like($$)` | WHERE/AND | LIKE clause | `u => u.name.like($$), "John%"` |
| `.includes()` | WHERE/AND | IN clause (array) | `$$.includes(u.id), [1,2,3]` |

---

## Common Patterns

### Creating and Inserting Entities

```javascript
// Create new entity
const user = context.User.new();
user.name = "John Doe";
user.email = "john@example.com";
user.age = 30;

// Track for insert
context.User.add(user); // Optional - .new() auto-tracks

// Save to database
context.saveChanges();
```

### IN Clause Queries

```javascript
// Option 1: .any() with comma-separated string
context.User.where(u => u.id.any($$), "1,2,3").toList();

// Option 2: .includes() with array (Recommended)
const ids = [1, 2, 3];
context.User.where(u => $$.includes(u.id), ids).toList();

// Both produce: SELECT * FROM User WHERE id IN (?, ?, ?)
```

### LIKE Queries

```javascript
// Starts with
context.User.where(u => u.name.like($$), "John%").toList();

// Contains
context.User.where(u => u.email.like($$), "%@example.com%").toList();

// Produces: SELECT * FROM User WHERE name LIKE ?
```

### Complex Queries

```javascript
const activeUsers = context.User
    .where(u => $$.includes(u.role_id), [1, 2, 3])
    .and(u => u.active == true)
    .and(u => u.created_at > $, lastWeek)
    .orderByDescending(u => u.created_at)
    .take(50)
    .toList();
```

---

## Why Your LLM Might Be Confused

### ❌ Common Misunderstanding

```javascript
// ❌ WRONG - Trying to call .any() on the dbset
context.User.any(...)  // Error: .any is not a function

// ✅ CORRECT - Use .any() inside the lambda expression
context.User.where(u => u.id.any($$), "1,2,3")
```

### Key Difference

- **Dbset methods**: Called on `context.EntityName` (e.g., `.new()`, `.add()`)
- **Lambda functions**: Used inside the `where()` lambda string (e.g., `.any()`, `.like()`)

---

## Implementation Details

### Dbset Methods
- **File**: `QueryLanguage/queryMethods.js`
- **Class**: `queryMethods`
- **Instance**: Created via `context.dbset(Model)`
- **Methods**: Prototype methods on `queryMethods` class

### Lambda Functions
- **File**: `QueryLanguage/queryScript.js`
- **Parsing**: `describeExpressionPartsFunctions()` (lines 304-388)
- **Whitelist**: `isFunction()` method (lines 505-513)
- **Recognized**: `any`, `like`, `include`

---

## Quick Reference

| What You Want | Correct Syntax |
|---------------|----------------|
| Create entity | `context.User.new()` |
| Add to context | `context.User.add(entity)` |
| Find by ID | `context.User.where(u => u.id == $, 1).single()` |
| Find multiple IDs | `context.User.where(u => $$.includes(u.id), [1,2,3]).toList()` |
| Search text | `context.User.where(u => u.name.like($$), "John%").toList()` |
| Complex filter | `context.User.where(u => u.active == true).and(u => u.age > $, 18).toList()` |

---

## Summary

✅ **`.new()` is a dbset method** - Added in latest version
✅ **`.any()` is a lambda function** - Already existed
✅ **`.includes()` is a lambda function** - Transforms to `.any()`
✅ **Both are different types of methods used in different places**

If your LLM says `.any()` doesn't exist, clarify that it's looking for a **dbset method** when it should be looking for a **lambda expression function**.
