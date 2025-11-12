# belongsTo Relationships in MasterRecord

## Overview

When you define a `belongsTo` relationship in MasterRecord, the ORM creates **two separate properties** on your model instances:

1. **The foreign key field** (e.g., `document_id`) - the actual database column value
2. **The relationship property** (e.g., `Document`) - for accessing/setting the related object or ID

## How belongsTo Works Internally

### Entity Definition

```javascript
// DocumentChunk entity
DocumentChunk(db) {
  db.integer("id").primary().notNull().autoIncrement();
  db.string("content");
  db.belongsTo("Document", "document_id");  // Creates both Document and document_id properties
}
```

The `belongsTo("Document", "document_id")` call:
- **Does NOT** create a separate `document_id` field definition
- Tells MasterRecord that `document_id` is a foreign key to the `Document` entity
- Creates a relationship property named `Document`

### Model Instance Properties

When you query records or create new instances, **both properties are available**:

```javascript
const chunk = context.DocumentChunk.where("r => r.id == 1").single();

// Both of these work:
console.log(chunk.document_id);  // Accesses the foreign key value (e.g., 5)
console.log(chunk.Document);     // Accesses the relationship (object or ID)
```

## Usage Patterns

### Pattern 1: INSERT Operations (Setting Foreign Keys)

When **creating new records**, use the **relationship property name**:

```javascript
const chunk = new DocumentChunk();
chunk.content = "Sample content";
chunk.Document = documentId;  // ✅ CORRECT - Use relationship property for INSERT

context.DocumentChunk.add(chunk);
context.saveChanges();
```

**Why?** The `belongsTo` setter (entityTrackerModel.js:98-105) triggers dirty field tracking and marks the model as modified when you set the relationship property.

### Pattern 2: READ Operations (Accessing Foreign Keys)

When **reading or filtering records**, use the **foreign key field name**:

```javascript
// ✅ CORRECT - Use foreign key for filtering
const chunks = context.DocumentChunk
  .where(`r => r.document_id == ${docId}`)
  .toList();

// ✅ CORRECT - Use foreign key in JavaScript filters
const filtered = allChunks.filter(c => documentIds.includes(c.document_id));

// ✅ CORRECT - Access foreign key value directly
if (chunk.document_id === targetId) {
  // ...
}
```

**Why?** When records are loaded from the database, the raw column data includes `document_id`. The `build` method (entityTrackerModel.js:21-59) creates getters/setters for all non-relationship fields from the database result.

### Pattern 3: UPDATE Operations

For updates, you can use either property:

```javascript
// Using relationship property (preferred for consistency)
chunk.Document = newDocumentId;

// Using foreign key directly (also works)
chunk.document_id = newDocumentId;
```

Both will work because:
- Setting `chunk.Document` triggers the relationship setter (line 98-105)
- Setting `chunk.document_id` directly modifies the underlying value

## Code References

The behavior is implemented in `/Entity/entityTrackerModel.js`:

### Creating Non-Relationship Properties (lines 21-59)

```javascript
for (const [modelField, modelFieldValue] of modelFields) {
    if(!$that._isRelationship(currentEntity[modelField])){
        // Creates getter/setter for document_id (from database column)
        modelClass["__proto__"]["_" + modelField] = modelFieldValue;
        Object.defineProperty(modelClass, modelField, {
            set: function(value) {
                modelClass.__state = "modified";
                modelClass.__dirtyFields.push(modelField);
                this["__proto__"]["_" + modelField] = value;
            },
            get: function() {
                return this["__proto__"]["_" + modelField];
            }
        });
    }
}
```

This loop processes fields from the database result (like `document_id`) and makes them accessible as properties.

### Creating Relationship Properties (lines 89-149)

```javascript
if($that._isRelationship(currentEntity[entityField])){
    // Creates getter/setter for Document (relationship property)
    Object.defineProperty(modelClass, entityField, {
        set: function(value) {
            if(typeof value === "string" || typeof value === "number" ||
               typeof value === "boolean" || typeof value === "bigint") {
                modelClass.__state = "modified";
                modelClass.__dirtyFields.push(entityField);
                modelClass.__context.__track(modelClass);
            }
            this["__proto__"]["_" + entityField] = value;
        },
        get: function() {
            // Complex getter logic for lazy loading, etc.
            return this["__proto__"]["_" + entityField];
        }
    });

    if(currentEntity[entityField].relationshipType === "belongsTo"){
        // Initialize relationship value from database result
        if(currentModel[entityField]){
            modelClass[entityField] = currentModel[entityField];
        }
    }
}
```

This creates the `Document` property for relationship access.

## Real-World Example from bookbag-ce

In `bookbag-ce`, the `UserChat` entity demonstrates this pattern:

```javascript
// Entity definition
UserChat(db) {
  db.integer("id").primary().notNull().autoIncrement();
  db.belongsTo("Chat", "chat_id");  // Only defines relationship, not chat_id field
}

// Controller usage (chatController.js:66)
const messages = context.UserChat
  .where(`r => r.chat_id == ${chatId}`)  // ✅ Uses foreign key for filtering
  .toList();
```

Even though `chat_id` is never explicitly defined as a field, it's accessible because:
1. The database returns `chat_id` as a column
2. `entityTrackerModel.build()` creates properties for all columns from the result
3. The `belongsTo` relationship doesn't prevent the foreign key from being accessible

## Summary

| Operation | Property to Use | Example |
|-----------|----------------|---------|
| **INSERT** (setting FK) | Relationship property | `chunk.Document = docId` |
| **READ** (accessing FK) | Foreign key field | `chunk.document_id` |
| **FILTER** (where clauses) | Foreign key field | `r.document_id == 5` |
| **UPDATE** (changing FK) | Either (prefer relationship) | `chunk.Document = newId` |

## Key Takeaways

1. **belongsTo creates TWO properties**, not one
2. The **foreign key column** (`document_id`) is automatically available from database results
3. The **relationship property** (`Document`) is created by the ORM for setting relationships
4. **Use the relationship property for INSERT**, foreign key field for READ/FILTER
5. Both properties reference the same underlying foreign key value in the database
