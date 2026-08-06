# Detached Entity Problem - Solutions

## The Problem

```javascript
// Controller loads task
const task = await this._taskService.getTask(taskId);

// Service receives task and modifies it
task.status = 'completed';

// Try to save - the task change is NOT written by this context ❌
this._qaContext.saveChanges();  // Task change not persisted here

// Why? The task is "detached" - it is tracked by a DIFFERENT context
```

**Root Cause:** The task was loaded in a different context (`taskService`) and is tracked there, not by the current context (`_qaContext`). `_qaContext.saveChanges()` only writes entities *it* tracks.

> **As of 1.4.3 this no longer fails silently.** `saveChanges()` now **warns
> loudly** when entities tracked by a *different* context instance have unsaved
> changes — naming them and pointing you to the fix (save on the owning context,
> use `entity.save()`, or re-track with `context.attach(entity)`). Freshly loaded,
> unmodified entities never trip the warning. If you *intentionally* run multiple
> concurrent contexts with independent pending changes, silence it with
> `MASTERRECORD_SILENCE_CROSS_CONTEXT=1`.

---

## How Other ORMs Solve This

### Entity Framework (.NET)
```csharp
// Solution 1: Attach
context.Attach(task);
context.Entry(task).State = EntityState.Modified;
context.SaveChanges();

// Solution 2: Update (simpler)
context.Update(task);
context.SaveChanges();
```

### Hibernate (Java)
```java
// Solution: Merge
session.merge(task);
session.flush();
```

### Active Record (Rails)
```ruby
# No problem - entities have .save()
task.status = 'completed'
task.save
```

### Sequelize (Node.js)
```javascript
// No problem - entities have .save()
task.status = 'completed';
await task.save();
```

---

## MasterRecord Solutions

### Solution 1: **attach()** Method (Recommended)

Like Entity Framework's `Update()`:

```javascript
// Your original code (BROKEN)
const task = await this._taskService.getTask(taskId);
task.status = 'completed';
this._qaContext.saveChanges();  // ❌ Doesn't work

// FIX: Attach the detached entity
const task = await this._taskService.getTask(taskId);
task.status = 'completed';
this._qaContext.attach(task);  // ✅ Mark as modified
await this._qaContext.saveChanges();  // ✅ Now it works!
```

### Solution 2: **Specific Field Changes**

Only mark specific fields as dirty:

```javascript
const task = await this._taskService.getTask(taskId);

// Attach with specific changes
this._qaContext.attach(task, {
    status: 'completed',
    completed_at: new Date()
});

await this._qaContext.saveChanges();
```

### Solution 3: **attachAll()** for Multiple Entities

```javascript
const tasks = await this._taskService.getTasks();

// Modify all tasks
tasks.forEach(task => {
    task.status = 'completed';
});

// Attach all at once
this._qaContext.attachAll(tasks);
await this._qaContext.saveChanges();
```

### Solution 4: **update()** Helper

Update by primary key without loading first:

```javascript
// No need to load task first
await this._qaContext.update('Task', taskId, {
    status: 'completed',
    completed_at: new Date()
});

await this._qaContext.saveChanges();
```

---

## Complete Example: Your Annotation Service

### Before (BROKEN) ❌

```javascript
class AnnotationService {
    constructor() {
        this._qaContext = new QAContext();
        this._taskService = new TaskService();
    }

    async createAnnotation(taskId, data) {
        // Load task from different service
        const task = await this._taskService.getTask(taskId);

        // Create annotation
        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        annotation.data = data;
        this._qaContext.Annotation.add(annotation);

        // Modify task - BUT NOT TRACKED! ❌
        task.status = 'completed';

        // Only annotation is saved, task change is ignored ❌
        await this._qaContext.saveChanges();

        return annotation;
    }
}
```

### After (FIXED) ✅

**Option A: Use attach()**

```javascript
class AnnotationService {
    constructor() {
        this._qaContext = new QAContext();
        this._taskService = new TaskService();
    }

    async createAnnotation(taskId, data) {
        // Load task from different service
        const task = await this._taskService.getTask(taskId);

        // Create annotation
        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        annotation.data = data;
        this._qaContext.Annotation.add(annotation);

        // Modify task
        task.status = 'completed';

        // FIX: Attach detached task ✅
        this._qaContext.attach(task);

        // Both annotation and task are saved ✅
        await this._qaContext.saveChanges();

        return annotation;
    }
}
```

**Option B: Use attach() with specific fields**

```javascript
async createAnnotation(taskId, data) {
    const task = await this._taskService.getTask(taskId);

    // Create annotation
    const annotation = this._qaContext.Annotation.new();
    annotation.task_id = taskId;
    annotation.data = data;
    this._qaContext.Annotation.add(annotation);

    // Attach with specific changes ✅
    this._qaContext.attach(task, {
        status: 'completed',
        completed_at: new Date()
    });

    await this._qaContext.saveChanges();
    return annotation;
}
```

**Option C: Use update() helper**

```javascript
async createAnnotation(taskId, data) {
    // No need to load task first

    // Create annotation
    const annotation = this._qaContext.Annotation.new();
    annotation.task_id = taskId;
    annotation.data = data;
    this._qaContext.Annotation.add(annotation);

    // Update task by ID ✅
    await this._qaContext.update('Task', taskId, {
        status: 'completed',
        completed_at: new Date()
    });

    await this._qaContext.saveChanges();
    return annotation;
}
```

---

## Best Practices

### ✅ DO: Use One Context Per Request

```javascript
// Express middleware
app.use((req, res, next) => {
    req.db = new AppContext();  // One context per request
    res.on('finish', () => req.db.endRequest());
    next();
});

// Service uses the request context
class AnnotationService {
    async createAnnotation(db, taskId, data) {
        // Use passed-in context
        const task = db.Task.findById(taskId);  // Loaded in same context ✅
        task.status = 'completed';  // Already tracked ✅

        const annotation = db.Annotation.new();
        annotation.task_id = taskId;
        db.Annotation.add(annotation);

        await db.saveChanges();  // Both changes saved ✅
        return annotation;
    }
}

// Controller
app.post('/annotations', async (req, res) => {
    const annotationService = new AnnotationService();
    const annotation = await annotationService.createAnnotation(
        req.db,  // Pass request context ✅
        req.body.taskId,
        req.body.data
    );
    res.json(annotation);
});
```

### ✅ DO: Load in Same Context

```javascript
// ❌ BAD: Different contexts
const taskService = new TaskService();  // Has own context
const qaContext = new QAContext();  // Different context
const task = await taskService.getTask(taskId);  // Loaded in taskService context
task.status = 'completed';
qaContext.saveChanges();  // Doesn't see change ❌

// ✅ GOOD: Same context
const db = new AppContext();
const task = db.Task.findById(taskId);  // Loaded in db context
task.status = 'completed';  // Already tracked
await db.saveChanges();  // Change saved ✅
```

### ✅ DO: Use attach() for Detached Entities

```javascript
// When you must use entities from different contexts
const task = await externalService.getTask(taskId);  // Detached
task.status = 'completed';
db.attach(task);  // Re-attach ✅
await db.saveChanges();
```

### ❌ DON'T: Modify Detached Entities Without Attaching

```javascript
// ❌ BAD
const task = await someService.getTask(taskId);
task.status = 'completed';
db.saveChanges();  // Won't work!

// ✅ GOOD
const task = await someService.getTask(taskId);
task.status = 'completed';
db.attach(task);  // Attach first!
await db.saveChanges();
```

---

## Comparison Table

| ORM | Method | Example |
|-----|--------|---------|
| **Entity Framework** | `context.Update(entity)` | `context.Update(task);` |
| **Hibernate** | `session.merge(entity)` | `session.merge(task);` |
| **Active Record** | `entity.save()` | `task.save` |
| **Sequelize** | `entity.save()` | `await task.save()` |
| **MasterRecord** | `context.attach(entity)` | `db.attach(task);` |

---

## API Reference

### attach(entity, changes?)

Attach a detached entity and mark as modified.

**Parameters:**
- `entity` - The detached entity
- `changes` (optional) - Object with specific field changes

**Returns:** The attached entity

**Example:**
```javascript
// Attach entire entity
db.attach(task);

// Attach with specific changes
db.attach(task, { status: 'completed' });
```

### attachAll(entities)

Attach multiple entities at once.

**Parameters:**
- `entities` - Array of detached entities

**Returns:** Array of attached entities

**Example:**
```javascript
const tasks = await getTasks();
tasks.forEach(t => t.status = 'completed');
db.attachAll(tasks);
await db.saveChanges();
```

### update(entityName, primaryKey, changes)

Update entity by primary key without loading.

**Parameters:**
- `entityName` - Name of entity (e.g., 'Task')
- `primaryKey` - Primary key value
- `changes` - Object with field changes

**Returns:** The attached entity

**Example:**
```javascript
await db.update('Task', taskId, {
    status: 'completed',
    completed_at: new Date()
});
await db.saveChanges();
```

---

## Troubleshooting

### Changes not saving?

**Check:**
1. Is entity tracked? `console.log(db.__trackedEntities.includes(entity))`
2. Is entity state correct? `console.log(entity.__state)` (should be "modified")
3. Are dirty fields marked? `console.log(entity.__dirtyFields)`

**Fix:**
```javascript
// If not tracked, attach it
if (!db.__trackedEntities.includes(entity)) {
    db.attach(entity);
}
```

### "Entity must have __entity metadata" error?

**Cause:** Entity wasn't loaded through MasterRecord

**Fix:**
```javascript
// ❌ BAD: Plain object
const task = { id: 1, status: 'completed' };
db.attach(task);  // Error!

// ✅ GOOD: Load through MasterRecord
const task = db.Task.findById(1);
task.status = 'completed';
db.attach(task);  // Works!
```

---

## Summary

**The detached entity problem** happens when:
1. Entity loaded in one context
2. Passed to different context/service
3. Modified
4. saveChanges() called but doesn't see modification

**Solutions:**
1. ✅ Use **`attach()`** to re-attach detached entities (like Entity Framework)
2. ✅ Use **same context** throughout request (best practice)
3. ✅ Pass context to services instead of creating multiple contexts
4. ✅ Use **`update()`** helper for simple updates

**MasterRecord now handles this like Entity Framework!** 🎉
