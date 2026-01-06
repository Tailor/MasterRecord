# .includes() Syntax Clarification

## Common Confusion: Two Different `.includes()` Methods

There are **two different** `.includes()` methods that developers confuse:

### 1. JavaScript's Native `.includes()` ❌ NOT SUPPORTED
```javascript
// ❌ WRONG - This is JavaScript's array.includes()
const ids = [1, 2, 3];
context.User.where(u => ids.includes(u.id)).toList();
//                      ^^^ JavaScript variable reference
```

**Why it doesn't work:**
- The lambda `u => ...` is parsed as a **string**, not executed as JavaScript
- Cannot access JavaScript variables (`ids`) from inside the lambda string
- Cannot call JavaScript methods on those variables

**Error:**
```
ReferenceError: ids is not defined
```

---

### 2. MasterRecord's `.includes()` ✅ FULLY SUPPORTED
```javascript
// ✅ CORRECT - This is MasterRecord's special syntax
const ids = [1, 2, 3];
context.User.where(u => $$.includes(u.id), ids).toList();
//                      ^^ MasterRecord placeholder
//                                          ^^^ Pass array as argument
```

**Why it works:**
- `$$` is a **placeholder** that MasterRecord recognizes
- The array `ids` is passed as a **separate argument**
- MasterRecord transforms `$$.includes(u.id)` → `u.id.any($$)` internally
- Generates proper SQL: `WHERE id IN (?, ?, ?)`

**Generated SQL:**
```sql
SELECT * FROM User WHERE id IN (?, ?, ?)
-- Parameters: [1, 2, 3]
```

---

## Side-by-Side Comparison

| Feature | JavaScript `.includes()` | MasterRecord `.includes()` |
|---------|-------------------------|---------------------------|
| Syntax | `array.includes(field)` | `$$.includes(field)` |
| Where used | JavaScript code | MasterRecord lambda strings |
| Array location | Inside lambda | Separate argument |
| Supported | ❌ No | ✅ Yes |

---

## Examples: Wrong vs Right

### ❌ Wrong: JavaScript Syntax
```javascript
// Trying to use JavaScript's includes() - WON'T WORK
const userIds = [1, 2, 3];
const roleIds = [10, 20];

// ❌ Wrong
context.User
    .where(u => userIds.includes(u.id) && roleIds.includes(u.role_id))
    .toList();

// Error: userIds is not defined
```

### ✅ Right: MasterRecord Syntax
```javascript
// Using MasterRecord's includes() - WORKS
const userIds = [1, 2, 3];
const roleIds = [10, 20];

// ✅ Correct
context.User
    .where(u => $$.includes(u.id), userIds)
    .and(u => $$.includes(u.role_id), roleIds)
    .toList();

// Generates: WHERE id IN (?, ?, ?) AND role_id IN (?, ?)
// Params: [1, 2, 3, 10, 20]
```

---

## Alternative Syntax: `.any()`

You can also use `.any()` directly (it's what `.includes()` transforms to):

```javascript
// Option 1: .includes() (modern, readable)
context.User.where(u => $$.includes(u.id), [1, 2, 3]).toList();

// Option 2: .any() (classic syntax)
context.User.where(u => u.id.any($$), [1, 2, 3]).toList();

// Option 3: .any() with comma string (also works)
context.User.where(u => u.id.any($$), "1,2,3").toList();

// All three generate the same SQL:
// WHERE id IN (?, ?, ?)
// Params: [1, 2, 3]
```

---

## Why The Lambda is a String

MasterRecord's lambda expressions are **not executed as JavaScript**. They are:

1. **Converted to strings**: `r => r.id == $` becomes the string `"r => r.id == $"`
2. **Parsed**: MasterRecord extracts entity name (`r`), field name (`id`), operator (`==`), placeholder (`$`)
3. **Converted to SQL**: Generates `WHERE id = ?`

**This means:**
- ✅ Can use: MasterRecord syntax (`$$`, `$`, `.any()`, `.includes()`, `.like()`)
- ❌ Cannot use: JavaScript variables, JavaScript methods, JavaScript operators beyond basic comparison

---

## Common Mistakes and Solutions

### Mistake 1: Referencing JavaScript Variables
```javascript
// ❌ Wrong
const minAge = 18;
context.User.where(u => u.age > minAge).toList();
// Error: minAge is not defined

// ✅ Right
const minAge = 18;
context.User.where(u => u.age > $, minAge).toList();
```

### Mistake 2: Using JavaScript Array Methods
```javascript
// ❌ Wrong
const ids = [1, 2, 3];
context.User.where(u => ids.includes(u.id)).toList();
// Error: ids is not defined

// ✅ Right
const ids = [1, 2, 3];
context.User.where(u => $$.includes(u.id), ids).toList();
```

### Mistake 3: Calling JavaScript String Methods
```javascript
// ❌ Wrong
context.User.where(u => u.name.startsWith("John")).toList();
// Error: startsWith is not defined

// ✅ Right - Use SQL LIKE
context.User.where(u => u.name.like($$), "John%").toList();
```

---

## Quick Reference

**When writing MasterRecord queries:**

✅ **DO use:**
- `$$` - Placeholder for parameters
- `$` - Single placeholder (backwards compatibility)
- `$$.includes(field)` - IN clause with arrays
- `field.any($$)` - Alternative IN clause syntax
- `field.like($$)` - LIKE clause
- Basic operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`

❌ **DON'T use:**
- JavaScript variables directly (use `$$` placeholders instead)
- JavaScript methods (`.includes()`, `.startsWith()`, etc.)
- Complex JavaScript expressions

---

## Summary

**MasterRecord's `.includes()` is fully supported and works great!**

Just remember:
1. Use `$$.includes(field)` not `array.includes(field)`
2. Pass the array as a separate argument
3. The lambda is a string, not JavaScript code

**Correct Pattern:**
```javascript
const values = [1, 2, 3];
context.Model.where(m => $$.includes(m.field), values).toList();
```

This is **not a bug** - it's working as designed. The confusion comes from developers trying to use JavaScript's native `.includes()` method inside the lambda string, which isn't possible because lambdas are parsed, not executed.
