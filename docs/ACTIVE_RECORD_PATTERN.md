# Active Record Pattern - entity.save()

MasterRecord now supports **both** patterns:

1. **Entity Framework style** - `context.saveChanges()`
2. **Active Record style** - `entity.save()` ✨ NEW!

---

## Active Record Style (NEW)

### Basic Usage

```javascript
// Load entity
const task = db.Task.findById(1);

// Modify
task.status = 'completed';
task.completed_at = new Date();

// Save (like Active Record!)
await task.save();  // ✅ Entity saves itself!
```

### Create New Entity

```javascript
// Create
const task = db.Task.new();
task.name = 'New Task';
task.status = 'pending';

// Save
await task.save();  // ✅ Like Active Record!

console.log(task.id);  // Auto-generated ID
```

### Update Multiple Fields

```javascript
const user = db.User.findById(userId);
user.name = 'Updated Name';
user.email = 'new@example.com';
user.updated_at = new Date();

await user.save();  // ✅ All changes saved
```

---

## Solving the Detached Entity Problem

### Before (Manual attach)

```javascript
// ❌ Required manual attach
const task = await taskService.getTask(taskId);
task.status = 'completed';
db.attach(task);  // Manual attach
await db.saveChanges();
```

### After (Active Record style)

```javascript
// ✅ Just call .save()!
const task = await taskService.getTask(taskId);
task.status = 'completed';
await task.save();  // Entity saves itself!
```

**Why this works:**
- Entity has `__context` reference
- `.save()` automatically tracks the entity
- No manual `attach()` needed!

---

## Your Original Problem - SOLVED

### Your Original Code (BROKEN)

```javascript
class AnnotationService {
    async createAnnotation(taskId, data) {
        const task = await this._taskService.getTask(taskId);

        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        this._qaContext.Annotation.add(annotation);

        task.status = 'completed';  // ❌ Not tracked

        await this._qaContext.saveChanges();  // ❌ Task not saved
    }
}
```

### Solution 1: Active Record Style (EASIEST) ✨

```javascript
class AnnotationService {
    async createAnnotation(taskId, data) {
        const task = await this._taskService.getTask(taskId);

        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        annotation.data = data;

        task.status = 'completed';

        // Save both (Active Record style!)
        await annotation.save();  // ✅ Saves annotation
        await task.save();         // ✅ Saves task

        return annotation;
    }
}
```

### Solution 2: Entity Framework Style

```javascript
class AnnotationService {
    async createAnnotation(taskId, data) {
        const task = await this._taskService.getTask(taskId);

        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        this._qaContext.Annotation.add(annotation);

        task.status = 'completed';
        this._qaContext.attach(task);  // Attach detached entity

        await this._qaContext.saveChanges();  // Save all
        return annotation;
    }
}
```

### Solution 3: Pure Active Record

```javascript
class AnnotationService {
    async createAnnotation(taskId, data) {
        const task = await this._taskService.getTask(taskId);
        task.status = 'completed';
        await task.save();  // Save task first

        const annotation = this._qaContext.Annotation.new();
        annotation.task_id = taskId;
        annotation.data = data;
        await annotation.save();  // Save annotation

        return annotation;
    }
}
```

---

## Comparison: Both Patterns

### Entity Framework Style

```javascript
// Load entities
const user = db.User.findById(1);
const task = db.Task.findById(2);

// Modify both
user.name = 'Updated';
task.status = 'completed';

// Save all at once
await db.saveChanges();  // Batch save
```

**Pros:**
- ✅ Batch operations (efficient)
- ✅ Transaction-like behavior
- ✅ One save call for multiple entities

**Cons:**
- ❌ Less intuitive
- ❌ Need to track which context has which entities

### Active Record Style (NEW)

```javascript
// Load entities
const user = db.User.findById(1);
const task = db.Task.findById(2);

// Modify and save individually
user.name = 'Updated';
await user.save();  // Save user

task.status = 'completed';
await task.save();  // Save task
```

**Pros:**
- ✅ More intuitive (entity saves itself)
- ✅ No detached entity issues
- ✅ Works across contexts
- ✅ Familiar to Rails developers

**Cons:**
- ❌ Multiple database calls
- ❌ No automatic batching

---

## When to Use Each Pattern

### Use `entity.save()` when:

✅ Working with single entities
✅ Entity from external service (detached)
✅ Quick updates to one entity
✅ Familiar with Active Record (Rails)
✅ Want explicit control

```javascript
// Single entity updates
const user = db.User.findById(userId);
user.last_login = new Date();
await user.save();  // Clear and simple
```

### Use `context.saveChanges()` when:

✅ Batch operations (multiple entities)
✅ Need transaction-like behavior
✅ Performance critical (fewer DB calls)
✅ Familiar with Entity Framework

```javascript
// Batch updates
const users = db.User.where(u => u.active == false).toList();
users.forEach(u => u.deleted_at = new Date());
await db.saveChanges();  // One batch save
```

---

## Complete Examples

### Example 1: User Registration

```javascript
async function registerUser(data) {
    const db = new AppContext();

    // Create user
    const user = db.User.new();
    user.email = data.email;
    user.name = data.name;
    user.password_hash = await hash(data.password);

    // Save (Active Record style)
    await user.save();  // ✅

    // Send welcome email
    await sendWelcomeEmail(user);

    return user;
}
```

### Example 2: Task Completion

```javascript
async function completeTask(taskId) {
    const db = new AppContext();

    const task = db.Task.findById(taskId);
    task.status = 'completed';
    task.completed_at = new Date();

    // Save (Active Record style)
    await task.save();  // ✅

    // Notify user
    await notifyUser(task.user_id, 'Task completed');

    return task;
}
```

### Example 3: Bulk Update (Entity Framework style)

```javascript
async function archiveOldTasks() {
    const db = new AppContext();

    const oldTasks = db.Task
        .where(t => t.status == $$, 'completed')
        .where(t => t.completed_at < $$, thirtyDaysAgo)
        .toList();

    oldTasks.forEach(task => {
        task.archived = true;
        task.archived_at = new Date();
    });

    // Batch save (Entity Framework style)
    await db.saveChanges();  // ✅ Efficient batch update

    return oldTasks.length;
}
```

### Example 4: Mixed Pattern

```javascript
async function processOrder(orderId) {
    const db = new AppContext();

    // Load order
    const order = db.Order.findById(orderId);
    order.status = 'processing';
    await order.save();  // Save immediately (Active Record)

    // Create line items
    const items = order.items.map(item => {
        const lineItem = db.LineItem.new();
        lineItem.order_id = orderId;
        lineItem.product_id = item.productId;
        lineItem.quantity = item.quantity;
        return lineItem;
    });

    // Batch save line items (Entity Framework)
    await db.saveChanges();  // ✅ Efficient for multiple items

    return order;
}
```

---

## Rails vs MasterRecord

### Rails (Active Record)

```ruby
# Create
user = User.new
user.name = 'John'
user.save

# Update
user = User.find(1)
user.name = 'Jane'
user.save

# Delete
user.destroy
```

### MasterRecord (Active Record style)

```javascript
// Create
const user = db.User.new();
user.name = 'John';
await user.save();

// Update
const user = db.User.findById(1);
user.name = 'Jane';
await user.save();

// Delete
db.remove(user);
await db.saveChanges();  // Or await user.save()
```

---

## Important Notes

### 1. `.save()` saves ALL tracked changes

```javascript
const db = new AppContext();

const user1 = db.User.findById(1);
user1.name = 'Updated 1';

const user2 = db.User.findById(2);
user2.name = 'Updated 2';

// Calling save() on either entity saves BOTH
await user1.save();  // Saves user1 AND user2!
```

**Why?** `.save()` calls `context.saveChanges()`, which saves all tracked entities in that context.

**To save only one entity:** Use separate contexts or save immediately:

```javascript
// Option 1: Separate contexts
const db1 = new AppContext();
const user1 = db1.User.findById(1);
user1.name = 'Updated 1';
await user1.save();  // Only saves user1

const db2 = new AppContext();
const user2 = db2.User.findById(2);
user2.name = 'Updated 2';
await user2.save();  // Only saves user2

// Option 2: Save immediately
const db = new AppContext();
const user1 = db.User.findById(1);
user1.name = 'Updated 1';
await user1.save();  // Saves and clears tracking

const user2 = db.User.findById(2);
user2.name = 'Updated 2';
await user2.save();  // Only user2 tracked at this point
```

### 2. Entity must have `__context`

```javascript
// ✅ WORKS: Entity loaded through MasterRecord
const user = db.User.findById(1);
await user.save();  // Has __context reference

// ❌ ERROR: Plain object
const user = { id: 1, name: 'Test' };
await user.save();  // Error: no __context
```

### 3. Async/await required

```javascript
// ✅ GOOD
await user.save();

// ❌ BAD: Doesn't wait for save
user.save();
```

---

## Summary

**MasterRecord now supports Active Record style!** 🎉

```javascript
// Both patterns work:

// Active Record (NEW)
await entity.save();

// Entity Framework
await context.saveChanges();

// Choose what feels natural for your use case!
```

**Solves the detached entity problem:**
- No need for manual `attach()`
- Entity knows its context
- Just call `.save()`!

**Best of both worlds:** ✨
- Active Record: Intuitive entity-level saves
- Entity Framework: Efficient batch operations
- You choose which to use!
