# Foreign Key String Value Bug - FIXED in v0.3.39

## Problem Summary

When assigning string values to foreign key fields defined via `belongsTo()`, MasterRecord silently excluded them from INSERT statements, causing NOT NULL constraint failures.

## Example of the Bug

```javascript
// Entity with belongsTo relationship
class UserOrganizationRole extends EntityModel {
    User(db) {
        db.belongsTo('User', 'user_id');  // Creates foreignKey 'user_id'
    }

    Organization(db) {
        db.belongsTo('Organization', 'organization_id');
    }
}

// User code
const orgRole = new UserOrganizationRole();
orgRole.user_id = currentUser.id;  // currentUser.id is STRING "2"
orgRole.organization_id = newOrg.id;  // newOrg.id is NUMBER 8
orgRole.role = 'org_admin';

await userContext.saveChanges();
// ❌ BEFORE: SqliteError: NOT NULL constraint failed: UserOrganizationRole.user_id
// ✅ AFTER: Works perfectly!
```

## Root Cause

1. `belongsTo('User', 'user_id')` creates an entity property named `User` with metadata `foreignKey: 'user_id'`
2. The INSERT builder looked for `fields['User']` (navigation property name)
3. But users set `fields['user_id']` (foreign key field name)
4. Field not found → silently skipped → INSERT statement missing the field

**Generated SQL (BEFORE):**
```sql
INSERT INTO [UserOrganizationRole] ([organization_id], [role])
VALUES (8, 'org_admin')
-- ❌ user_id is missing!
```

**Generated SQL (AFTER):**
```sql
INSERT INTO [UserOrganizationRole] ([user_id], [organization_id], [role])
VALUES (2, 8, 'org_admin')
-- ✅ user_id is included and auto-converted from "2" to 2
```

## The Fix

Modified `_buildSQLInsertObjectParameterized()` in all three database engines to check BOTH the navigation property name AND the foreign key field name:

```javascript
// SQLLiteEngine.js, mySQLEngine.js, postgresEngine.js
for (const column in modelEntity) {
    if (column.indexOf("__") === -1) {
        let fieldColumn = fields[column];  // Check navigation property (e.g., 'User')

        // 🔥 NEW: Also check the foreignKey field name (e.g., 'user_id')
        if ((fieldColumn === undefined || fieldColumn === null) &&
            modelEntity[column].relationshipType === "belongsTo" &&
            modelEntity[column].foreignKey) {
            fieldColumn = fields[modelEntity[column].foreignKey];
        }

        if ((fieldColumn !== undefined && fieldColumn !== null) && typeof(fieldColumn) !== "object") {
            // Existing validation and type coercion logic...
            // This already handles string-to-integer conversion!
        }
    }
}
```

## Auto-Conversion

The existing `_validateAndCoerceFieldType()` method already handled string-to-integer conversion:

```javascript
case "integer":
    if (actualType === 'string') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new Error(`Type mismatch for ${entityName}.${fieldName}: Expected integer, got string "${value}" which cannot be converted`);
        }
        console.warn(`⚠️  Field ${entityName}.${fieldName}: Auto-converting string "${value}" to integer ${parsed}`);
        return parsed;
    }
```

So once the field is found, the conversion happens automatically!

## Why String IDs Happen in Real Apps

### 1. authService Returns String IDs
```javascript
// authService.js line 167:
res.id = String(obj.user.id);  // Explicit string conversion

// Returns:
{
  id: "2",  // ← STRING
  email: "customer1@bookbag.ai",
  system_role: "system_user"
}
```

### 2. HTTP Requests (JSON)
```javascript
// Client sends:
{ "user_id": "2", "organization_id": "8" }

// Express parses as strings
req.body.user_id  // "2" (string)
```

### 3. JWT Tokens
```javascript
const token = jwt.decode(req.headers.authorization);
token.userId  // "2" (string from JWT claim)
```

### 4. Database Returns Numbers
```javascript
const newOrg = new Organization();
// ... set properties ...
await organizationContext.saveChanges();

newOrg.id  // 8 (NUMBER from auto-increment)
```

**Result:** Mixed types are common in real-world apps!

## Both Patterns Now Work

### Pattern 1: Navigation Property (OLD, still works)
```javascript
const user = await ctx.User.where(u => u.id == 2).first();
orgRole.User = user;  // Set navigation property
```

### Pattern 2: Foreign Key Field (NEW, now works!)
```javascript
orgRole.user_id = currentUser.id;  // "2" (string)
// Auto-converted to 2 (integer) ✅
```

### Pattern 3: Direct Integer (always worked)
```javascript
orgRole.user_id = 2;  // Already a number
```

## Test Coverage

**8 comprehensive tests** verify:
1. ✅ String foreign key value included in INSERT
2. ✅ Number foreign key value still works
3. ✅ Mixed string and number foreign keys
4. ✅ String with leading zeros ("007" → 7)
5. ✅ Invalid strings throw clear error
6. ✅ Empty strings throw clear error
7. ✅ Backward compatible (navigation property)
8. ✅ Prefers navigation property if both set

Run tests:
```bash
node test/foreign-key-string-value-test.js
```

## Affected Database Engines

All three engines fixed:
- ✅ SQLiteEngine (`SQLLiteEngine.js`)
- ✅ MySQLEngine (`mySQLEngine.js`)
- ✅ PostgresEngine (`postgresEngine.js`)

## Upgrade Path

```bash
npm install -g masterrecord@0.3.39
```

**No code changes needed!** The fix is automatic.

### If You Have Workarounds

If you added `parseInt()` workarounds like this:
```javascript
orgRole.user_id = parseInt(currentUser.id, 10);
```

You can now remove them (but leaving them is harmless):
```javascript
orgRole.user_id = currentUser.id;  // Works directly now!
```

## Error Messages (Before vs After)

### Before v0.3.39
```
SqliteError: NOT NULL constraint failed: UserOrganizationRole.user_id
```
**Confusing!** The field WAS set, but silently skipped.

### After v0.3.39
If you pass an invalid string:
```
INSERT failed: Type mismatch for UserOrganizationRole.User: Expected integer, got string "invalid" which cannot be converted to a number
```
**Clear!** Tells you exactly what's wrong.

## Impact

- ✅ **Auto-converts** string foreign keys to integers
- ✅ **Clear errors** for invalid values (not silent failures)
- ✅ **Backward compatible** - all existing code works
- ✅ **Matches real-world usage** where IDs are often strings
- ✅ **Works across all databases** (SQLite, MySQL, PostgreSQL)

## Files Changed

1. **SQLLiteEngine.js** - Lines 1127-1137
2. **mySQLEngine.js** - Lines 654-664
3. **postgresEngine.js** - Lines 601-611
4. **test/foreign-key-string-value-test.js** (NEW)
5. **package.json** - Version 0.3.39
6. **readme.md** - Changelog entry
7. **MEMORY.md** - Implementation notes

## Related Issues

This bug was reported by Bookbag.ai Engineering Team and affects any application that:
- Uses JWT tokens for authentication (IDs as strings)
- Receives data from HTTP requests (JSON has string values)
- Mixes data from different sources (auth service + database)
- Uses authService pattern (converts IDs to strings for consistency)

## Verification

To verify the fix works with your code:

```javascript
const UserOrganizationRole = require('./models/userOrganizationRole');
const userContext = require('./models/userContext');

async function testFix() {
    const ctx = new userContext();

    const orgRole = new UserOrganizationRole();
    orgRole.user_id = "2";  // ← STRING VALUE
    orgRole.organization_id = 1;
    orgRole.role = "org_admin";
    orgRole.created_at = Date.now().toString();
    orgRole.updated_at = Date.now().toString();

    ctx.UserOrganizationRole.add(orgRole);

    try {
        await ctx.saveChanges();
        console.log('✅ SUCCESS! String foreign key value was auto-converted.');
        console.log('Inserted record:', orgRole);
    } catch (err) {
        console.error('❌ FAILED:', err.message);
    }
}

testFix();
```

Expected output:
```
⚠️  Field UserOrganizationRole.User: Auto-converting string "2" to integer 2
✅ SUCCESS! String foreign key value was auto-converted.
Inserted record: { id: 1, user_id: 2, organization_id: 1, role: 'org_admin', ... }
```

## Conclusion

The bug is **completely fixed** in v0.3.39. String values assigned to foreign key fields are now:
1. **Detected** (checked in both navigation property and foreign key field name)
2. **Validated** (throws error for invalid strings)
3. **Converted** (auto-converts to integer)
4. **Included** in INSERT statements (no more silent failures)

Upgrade to v0.3.39 and enjoy hassle-free foreign key handling! 🎉
