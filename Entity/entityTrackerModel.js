
// version : 0.0.9
import tools from '../Tools.js';
import FieldTransformer from './fieldTransformer.js';

class EntityTrackerModel {

    // start tracking model
    build(dataModel, currentEntity, context){
        const $that = this;
        const modelClass = this.buildObject(); // build entity with models
        // The entity's prototype stays the ordinary shared Object.prototype and its
        // backing slots are non-enumerable OWN properties (see tools.slotOwner):
        // every row of a type shares one hidden class, so reads stay monomorphic.
        Object.defineProperty(modelClass, '__self', { value: modelClass, enumerable: false, writable: false, configurable: true });
        const modelFields = Object.entries(dataModel); /// return array of objects

        modelClass.__entity = currentEntity;
        modelClass.__name = currentEntity.__name;
        modelClass.__context = context;
        this.buildRelationshipModels(modelClass, currentEntity, dataModel);

        // Pre-compute belongsTo navName lookup for FK column names that
        // appear in the DB row but not as a top-level key in `__entity`
        // (e.g. row has `run_id`; __entity has `Run` with foreignKey:
        // 'run_id' but no separate `run_id` declaration).
        const fkToNavName = {};
        for (const k of Object.keys(currentEntity)) {
            const def = currentEntity[k];
            if (def && def.relationshipType === 'belongsTo' && def.foreignKey) {
                fkToNavName[def.foreignKey] = k;
            }
        }

        // loop through data model fields
        for (const [modelField, modelFieldValue] of modelFields) {

            // set the value dynamiclly
            if(!$that._isRelationship(currentEntity[modelField])){
                // Shared with attachTrackingTo() so a query-built entity and an
                // insert-then-attached entity get IDENTICAL accessors.
                this._defineTrackedColumn(modelClass, modelField, modelFieldValue, currentEntity, fkToNavName, true);
            }
        }

        // Snapshot ORIGINAL values as loaded from the database (EF's
        // EntityEntry.OriginalValues). Used for optimistic concurrency — the
        // original value of a concurrency token goes into the UPDATE/DELETE
        // WHERE clause — and for conflict resolution / entry() introspection.
        // Non-enumerable so it never leaks into spreads/JSON.
        const originals = {};
        for (const [modelField, modelFieldValue] of modelFields) {
            if (!$that._isRelationship(currentEntity[modelField])) {
                originals[modelField] = modelFieldValue;
            }
        }
        Object.defineProperty(modelClass, '__originalValues', {
            value: originals, enumerable: false, writable: true, configurable: true,
        });

        // Add Active Record-style .save() method
        modelClass.save = async function() {
            if (!this.__context) {
                throw new Error('Cannot save: entity is not attached to a context');
            }

            // Ensure entity is tracked
            if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
                this.__context.__track(this);
            }

            // Save all tracked changes in the context
            return await this.__context.saveChanges();
        };

        // Convert entity to plain JavaScript object
        modelClass.toObject = function(options = {}) {
            const includeRelationships = options.includeRelationships !== false;
            const depth = options.depth || 1;
            const visited = options._visited || new WeakSet();

            // Prevent circular reference infinite loops
            if (visited.has(this)) {
                return { __circular: true, __entityName: this.__name, id: this[this.__primaryKey] };
            }
            visited.add(this);

            const plain = {};

            // Method 1: Access internal _values property (v0.3.28+ architecture)
            // This is the FASTEST method - direct access to plain data storage
            if (this._values && typeof this._values === 'object') {
                for (const key in this._values) {
                    if (Object.prototype.hasOwnProperty.call(this._values, key)) {
                        plain[key] = this._values[key];
                    }
                }
            } else {
                // Method 2: Fallback - iterate through entity definition (for older versions)
                for (const fieldName in this.__entity) {
                    if (fieldName.startsWith('__')) continue;

                    const fieldDef = this.__entity[fieldName];
                    const isRelationship = fieldDef?.type === 'hasMany' ||
                                           fieldDef?.type === 'hasOne' ||
                                           fieldDef?.relationshipType === 'belongsTo';

                    // Skip relationships in this pass
                    if (!isRelationship) {
                        try {
                            plain[fieldName] = this[fieldName];
                        } catch (_e) {
                            // Skip fields that throw errors when accessed
                        }
                    }
                }
            }

            // Handle relationships recursively with depth limit and cycle detection
            if (includeRelationships && depth > 0) {
                for (const fieldName in this.__entity) {
                    const fieldDef = this.__entity[fieldName];
                    const isRelationship = fieldDef?.type === 'hasMany' ||
                                           fieldDef?.type === 'hasOne' ||
                                           fieldDef?.relationshipType === 'belongsTo';

                    if (isRelationship) {
                        try {
                            const value = this[fieldName];

                            if (Array.isArray(value)) {
                                plain[fieldName] = value.map(item => {
                                    if (item?.toObject && typeof item.toObject === 'function') {
                                        return item.toObject({
                                            depth: depth - 1,
                                            _visited: visited
                                        });
                                    }
                                    return item;
                                });
                            } else if (value?.toObject && typeof value.toObject === 'function') {
                                plain[fieldName] = value.toObject({
                                    depth: depth - 1,
                                    _visited: visited
                                });
                            }
                        } catch (_e) {
                            // Skip relationships that throw errors when accessed
                        }
                    }
                }
            }

            return plain;
        };

        // JSON.stringify compatibility - prevents circular reference errors
        modelClass.toJSON = function() {
            return this.toObject({ includeRelationships: false });
        };

        // Delete entity from database
        modelClass.delete = async function() {
            if (!this.__context) {
                throw new Error('Cannot delete: entity is not attached to a context');
            }

            // Mark entity for deletion — dirty, so register it in the dirty index
            // (a delete that isn't in the change set would never be issued).
            this.__state = 'delete';
            if (typeof this.__context.__markDirty === 'function') {
                this.__context.__markDirty(this);
            } else if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
                this.__context.__track(this);
            }

            // Execute delete via saveChanges (handles cascade deletion)
            return await this.__context.saveChanges();
        };

        // Reload entity from database
        modelClass.reload = async function() {
            if (!this.__context) {
                throw new Error('Cannot reload: entity is not attached to a context');
            }

            // Get primary key (all columns of a composite key — EF HasKey(a, b))
            const keys = tools.primaryKeys(this.__entity);
            const keyValues = keys.map(k => this[k]);

            if (!keys.length || keyValues.some(v => v === undefined || v === null || v === '')) {
                throw new Error('Cannot reload: entity has no primary key value');
            }

            // Fetch fresh from database
            const EntityClass = this.__context[this.__name];
            const fresh = await EntityClass.findById(...keyValues);
            if (!fresh) {
                throw new Error(
                    `Cannot reload: ${this.__name} with ${keys.map((k, i) => `${k}=${keyValues[i]}`).join(', ')} not found`
                );
            }

            // Copy all field values from fresh entity to this entity
            for (const fieldName in this.__entity) {
                if (fieldName.startsWith('__')) continue;

                const fieldDef = this.__entity[fieldName];
                const isRelationship = fieldDef?.type === 'hasMany' ||
                                       fieldDef?.type === 'hasOne' ||
                                       fieldDef?.relationshipType === 'belongsTo';

                // Only reload scalar fields
                if (!isRelationship) {
                    tools.setSlot(this, "_" + fieldName, tools.getSlot(fresh, "_" + fieldName));
                }
            }

            // Reset dirty fields and state
            this.__dirtyFields = [];
            this.__state = 'track';
            // Reload resets ORIGINAL values to the database state (EF's
            // Reload()), so a later concurrency check compares against what
            // is now in the row — this is what makes "reload and retry" work.
            if (typeof this.__context._refreshOriginalValues === 'function') {
                this.__context._refreshOriginalValues(this);
            }
            // findById tracked a second instance of this row; drop it so the
            // identity map holds only this entity (EF never tracks two copies).
            if (typeof this.__context.__untrack === 'function') {
                this.__context.__untrack([fresh]);
            }

            return this;
        };

        // Clone entity for duplication
        modelClass.clone = function() {
            if (!this.__context) {
                throw new Error('Cannot clone: entity is not attached to a context');
            }

            const EntityClass = this.__context[this.__name];
            const cloned = EntityClass.new();

            // Get primary key (to skip it)
            const primaryKey = tools.getPrimaryKeyObject(this.__entity);

            // Copy all non-primary key fields
            for (const fieldName in this.__entity) {
                if (fieldName.startsWith('__')) continue;
                if (fieldName === primaryKey) continue;

                const fieldDef = this.__entity[fieldName];
                const isRelationship = fieldDef?.type === 'hasMany' ||
                                       fieldDef?.type === 'hasOne' ||
                                       fieldDef?.relationshipType === 'belongsTo';

                if (!isRelationship) {
                    cloned[fieldName] = this[fieldName];
                }
            }

            return cloned;
        };

        // Copy lifecycle hooks from entity definition to entity instance
        for (const fieldName in currentEntity) {
            const fieldDef = currentEntity[fieldName];
            if (fieldDef && fieldDef.lifecycle === true && fieldDef.method) {
                // Bind the lifecycle hook method directly to this entity instance
                modelClass[fieldName] = fieldDef.method.bind(modelClass);
            }
        }

        // Make internal metadata (`__*`) and helper/hook methods
        // non-enumerable. They are attached by plain assignment / object
        // literal above, which makes them enumerable own properties — so
        // `{ ...entity }` / `Object.assign({}, entity)` would copy them.
        // Two concrete bugs that causes:
        //   1. The copied `toJSON` runs on the spread object and rebuilds
        //      output from the original columns only, silently dropping any
        //      key the caller added (`{ ...w, role }` serialized without
        //      `role`).
        //   2. `__context` (the whole DB context) leaks into the spread and
        //      makes `JSON.stringify` throw on its circular structure.
        // Column accessors are defined with `enumerable: true` and stay
        // enumerable; relationship getters are already non-enumerable.
        for (const key of Object.keys(modelClass)) {
            const desc = Object.getOwnPropertyDescriptor(modelClass, key);
            // Only touch DATA properties (internals + methods). Skip accessor
            // properties — those are the column getters (defined enumerable +
            // non-configurable, so redefining them throws), including the FTS
            // `__rank` column, which should stay enumerable/serializable.
            if (!desc || !('value' in desc)) continue;
            if (key.startsWith('__') || typeof desc.value === 'function') {
                Object.defineProperty(modelClass, key, { enumerable: false });
            }
        }

        return modelClass;
    }

    /**
     * Define a single tracked column accessor on `target`. Factored out of
     * build() so the SAME code powers query-built entities and entities that
     * are attached in place after an insert (attachTrackingTo). Closures use
     * `this` — the accessor owner — for entity state, so the definition is
     * target-agnostic.
     *
     * @param {boolean} applyFromDb - true when `rawValue` came straight from a
     *   DB row (apply the fromDatabase transformer); false when it is already
     *   the in-memory domain value of a just-inserted entity.
     */
    _defineTrackedColumn(target, modelField, rawValue, currentEntity, fkToNavName, applyFromDb) {
        let transformedValue = rawValue;
        if (applyFromDb) {
            try {
                transformedValue = FieldTransformer.fromDatabase(
                    rawValue,
                    currentEntity[modelField],
                    currentEntity.__name,
                    modelField
                );
            } catch (transformError) {
                console.error(`Warning: Failed to transform ${currentEntity.__name}.${modelField} from database: ${transformError.message}`);
                transformedValue = rawValue;
            }
        }

        const slot = "_" + modelField;                       // backing slot (non-enumerable own property)
        const fieldDef = currentEntity[modelField] || null;  // static column definition
        const customGet = (fieldDef && typeof fieldDef.get === "function") ? fieldDef.get : null;
        tools.setSlot(target, slot, transformedValue);

        Object.defineProperty(target, modelField, {
            enumerable: true,
            set: function(value) {
                // Run validators before setting value
                const fieldDef = currentEntity[modelField];
                if (fieldDef && fieldDef.validators && Array.isArray(fieldDef.validators)) {
                    for (const validator of fieldDef.validators) {
                        let isValid = true;
                        const errorMsg = validator.message;

                        switch (validator.type) {
                            case 'required':
                                isValid = value !== null && value !== undefined && value !== '';
                                break;

                            case 'email':
                                if (value) {
                                    isValid = validator.pattern.test(value);
                                }
                                break;

                            case 'minLength':
                                if (value && typeof value === 'string') {
                                    isValid = value.length >= validator.length;
                                }
                                break;

                            case 'maxLength':
                                if (value && typeof value === 'string') {
                                    isValid = value.length <= validator.length;
                                }
                                break;

                            case 'pattern':
                                if (value) {
                                    isValid = validator.pattern.test(value);
                                }
                                break;

                            case 'min':
                                if (value !== null && value !== undefined) {
                                    isValid = Number(value) >= validator.min;
                                }
                                break;

                            case 'max':
                                if (value !== null && value !== undefined) {
                                    isValid = Number(value) <= validator.max;
                                }
                                break;

                            case 'custom':
                                if (typeof validator.validator === 'function') {
                                    isValid = validator.validator(value);
                                }
                                break;
                        }

                        if (!isValid) {
                            throw new Error(`Validation failed: ${errorMsg}`);
                        }
                    }
                }

                this.__state = "modified";
                // Bump a monotonic mutation version on every write. saveChanges()
                // captures this before its async DB write and, afterwards, only
                // resets the entity to clean if the version is unchanged — so a
                // mutation that lands DURING the write (a shared/singleton context
                // serving concurrent requests) keeps the entity dirty and its own
                // save still issues the UPDATE, instead of being silently reset.
                this.__version = (this.__version || 0) + 1;

                // belongsTo FK columns appear in the DB row but not as a
                // top-level key in `__entity`; translate the dirty field to the
                // navigation name and mirror the value into both backing fields.
                const navNameForFk = (!currentEntity[modelField] && fkToNavName[modelField])
                    ? fkToNavName[modelField]
                    : null;
                const dirtyName = navNameForFk || modelField;

                // Deduplicate: setting the same field twice must not push the
                // name twice (duplicate assignments in the UPDATE SET clause).
                if (!this.__dirtyFields.includes(dirtyName)) {
                    this.__dirtyFields.push(dirtyName);
                }
                // Ensure this entity is tracked on any modification. THIS is the
                // line that makes a just-inserted, attached entity's later edits
                // persist instead of being silently dropped.
                if (this.__context && typeof this.__context.__markDirty === 'function') {
                    this.__context.__markDirty(this);
                } else if (this.__context && typeof this.__context.__track === 'function') {
                    this.__context.__track(this);
                }
                const fieldDefForSet = currentEntity[modelField];
                let storedValue;
                if (fieldDefForSet && typeof fieldDefForSet.set === "function") {
                    storedValue = fieldDefForSet.set(value);
                } else {
                    storedValue = value;
                }
                tools.setSlot(this, slot, storedValue);
                if (navNameForFk) {
                    // FK -> navigation fix-up (EF): changing the FK column invalidates
                    // a previously loaded/assigned navigation so the next read
                    // re-resolves it (lazy) instead of returning a stale parent.
                    // The engines persist the FK via tools.foreignKeyValue(), which
                    // falls back to this column when the navigation slot is unset.
                    const nav = tools.getSlot(this, "_" + navNameForFk);
                    if (nav !== undefined && nav !== storedValue) tools.deleteSlot(this, "_" + navNameForFk);
                    tools.deleteSlot(this, "__loading_" + navNameForFk);
                }
            },
            // Hot path: a property read on an entity must cost about what a plain
            // object read costs (EF Core entities are POCOs). The slot key, field
            // definition and custom getter are resolved ONCE per accessor (closure),
            // not per read — previously every read re-concatenated "_" + field and
            // re-walked the definition (~300 ns/read, ~200x a plain property).
            get: function() {
                const value = this[slot];   // own slot on the entity; a derived clean model reads it through the chain
                return (customGet !== null && !fieldDef.skipGetFunction) ? customGet(value) : value;
            }
        });
    }

    /**
     * Install tracked-column accessors on an EXISTING entity object — a user's
     * `new Model()` that was `add()`ed and just INSERTed. Without this the
     * entity's fields are ordinary own properties, so a later edit
     * (`row.name = 'x'`) is a plain write that never flips the entity to
     * 'modified' — the change is silently dropped on the next saveChanges().
     * After this, the inserted entity behaves like a queried one: edits mark it
     * modified and produce an UPDATE.
     *
     * Backing slots (`_<field>`) are non-enumerable own properties of the object
     * itself (see tools.slotOwner), so the class prototype — and any lifecycle-hook
     * methods on it — is never touched.
     */
    attachTrackingTo(target) {
        const currentEntity = target && target.__entity;
        if (!currentEntity) return target;
        if (target.__trackingAttached) return target;

        const fkToNavName = {};
        for (const k of Object.keys(currentEntity)) {
            const def = currentEntity[k];
            if (def && def.relationshipType === 'belongsTo' && def.foreignKey) {
                fkToNavName[def.foreignKey] = k;
            }
        }

        // Capture the current scalar values before we replace them with
        // accessors. If a field is already an accessor the entity was built via
        // build() and needs no attaching.
        const scalarFields = [];
        const captured = {};
        for (const modelField of Object.keys(currentEntity)) {
            if (this._isRelationship(currentEntity[modelField])) continue;
            const desc = Object.getOwnPropertyDescriptor(target, modelField);
            if (desc && !('value' in desc)) return target; // already tracked
            // An UNSET declared field still resolves to its definition method on
            // the class prototype (e.g. `apiKey(db){...}`) — a truthy function.
            // Capturing that verbatim would make `!entity.apiKey` false and read
            // back a function. An entity field value is never a function, so
            // treat a function here as "unset" and back it with undefined.
            const cur = target[modelField];
            captured[modelField] = (typeof cur === 'function') ? undefined : cur;
            scalarFields.push(modelField);
        }

        // Backing slots become non-enumerable OWN properties of the user's object;
        // its class prototype (and any lifecycle-hook methods on it) is untouched.
        Object.defineProperty(target, '__trackingAttached', {
            value: true, enumerable: false, writable: true, configurable: true,
        });
        if (!Object.prototype.hasOwnProperty.call(target, '__self')) {
            Object.defineProperty(target, '__self', { value: target, enumerable: false, writable: false, configurable: true });
        }

        for (const modelField of scalarFields) {
            // applyFromDb=false: the captured value is already the domain value
            // the user set and that the INSERT persisted — not a raw DB row.
            this._defineTrackedColumn(target, modelField, captured[modelField], currentEntity, fkToNavName, false);
        }
        // Original values for a just-inserted (or attached) entity are its
        // current values — exactly what was written. (EF: originals equal
        // current for attached entities.)
        Object.defineProperty(target, '__originalValues', {
            value: { ...captured }, enumerable: false, writable: true, configurable: true,
        });
        return target;
    }

    buildObject(){
        return {
            // Do NOT assign an identity here. A random __ID in [1,100000] collided
            // catastrophically once the tracked set grew (birthday paradox): a new
            // entity whose random __ID already existed hit __track's dedup guard,
            // was never added to the tracked set, and its writes were silently
            // dropped — the monotonic write-loss decay in long-lived contexts.
            // __track() assigns a process-unique, collision-free sequential id.
            __ID : null,
            __dirtyFields : [],
            __state : "track",
            __entity : null,
            __context : null,
            __name : null
        }
    }

    _isRelationship(entity){
        if(entity){
            if(entity.type === "hasOne" || entity.type === "hasMany" || entity.relationshipType === "belongsTo" || entity.type === "hasManyThrough"){ 
                return true;
            }
            else{
                return false;
            }
        }else{
            return false;
        }
    }

    buildRelationshipModels(modelClass, currentEntity, currentModel){
        const $that = this;
        // loop though current entity and add only relationship models to this list
        const entityFields = Object.entries(currentEntity); 
        for (const [entityField, _entityFieldValue] of entityFields) { // loop through entity values
          
            if($that._isRelationship(currentEntity[entityField])){ 
 
                
                Object.defineProperty(modelClass, entityField, {
                    set: function(value) {
                        if(typeof value === "string" || typeof value === "number" || typeof value === "boolean"  || typeof value === "bigint" || value === null){
                            modelClass.__state = "modified";
                            modelClass.__version = (modelClass.__version || 0) + 1;
                            modelClass.__dirtyFields.push(entityField);
                            if (typeof modelClass.__context.__markDirty === 'function') {
                                modelClass.__context.__markDirty(modelClass);
                            } else {
                                modelClass.__context.__track(modelClass);
                            }
                        }
                        // Relationship fix-up (EF): assigning a parent ENTITY to a
                        // belongsTo navigation also sets the foreign-key column, so
                        // `post.author = someAuthor` persists author_id on save.
                        const def = currentEntity[entityField];
                        const proto = modelClass;   // slots live on the accessor OWNER (own non-enumerable props), never on `this`
                        if (value && typeof value === 'object' && value.__entity && def && def.relationshipType === 'belongsTo' && def.foreignKey) {
                            const parentPk = tools.getPrimaryKeyObject(value.__entity);
                            const fkVal = parentPk ? value[parentPk] : undefined;
                            if (fkVal !== undefined && fkVal !== null && typeof fkVal !== 'function' && tools.dataValue(modelClass, def.foreignKey) !== fkVal) {
                                // Tracked entity: the FK column's accessor marks the entity dirty
                                // (and invalidates the old navigation); plain object: data property.
                                modelClass[def.foreignKey] = fkVal;
                            }
                        } else if ((value === null || typeof value !== 'object') && def && def.relationshipType === 'belongsTo' && def.foreignKey && ('_' + def.foreignKey) in proto) {
                            tools.setSlot(proto, '_' + def.foreignKey, value);       // legacy idiom `post.author = authorId`
                        }
                        tools.deleteSlot(proto, '__loading_' + entityField);
                        tools.setSlot(proto, "_" + entityField, value);
                    },
                    get : function(){
                        // Navigation getter (EF semantics, adapted to async JS drivers):
                        //  - already loaded (via include() or a previous load) -> the value, synchronously;
                        //  - lazyLoadingOff() and not loaded -> null (EF: null when not loaded);
                        //  - otherwise -> a Promise that loads it ONCE via the engine-agnostic,
                        //    parameterized context.loadNavigation() and caches the result, so
                        //    `await post.author` works on every engine. (The old getter issued
                        //    SQLite-shaped SQL with the key VALUE interpolated into the lambda.)
                        // Resolve the backing slot from the accessor OWNER, never from
                        // `this`: a derived object (Object.create(entity), used by the
                        // engines) must not end up with its own shadowing `_<nav>`.
                        const proto = modelClass;
                        const loaded = proto['_' + entityField];
                        // undefined = not loaded; null = loaded, no related row (EF); a thenable = in flight
                        if (loaded !== undefined && !(loaded && typeof loaded.then === 'function')) return loaded;
                        const def = currentEntity[entityField];
                        if (!def || def.lazyLoading === false) return (loaded === undefined) ? null : loaded;
                        const ctx = modelClass.__context;
                        if (!ctx || typeof ctx.loadNavigation !== 'function') return (loaded === undefined) ? null : loaded;
                        const inflightKey = '__loading_' + entityField;
                        if (proto[inflightKey] && typeof proto[inflightKey].then === 'function') return proto[inflightKey];
                        const p = ctx.loadNavigation(modelClass, entityField).then(
                            (v) => { tools.setSlot(proto, '_' + entityField, v); tools.deleteSlot(proto, inflightKey); return v; },
                            (err) => { tools.deleteSlot(proto, inflightKey); throw err; }
                        );
                        tools.setSlot(proto, inflightKey, p);
                        p.catch(() => {});   // awaiters still see the rejection; avoids an unhandled-rejection crash when un-awaited
                        return p;
                    }
                  });

                if(currentEntity[entityField].relationshipType === "belongsTo"){
                    // check if entity has a value if so then return that value
                    if(currentModel[entityField]){
                        modelClass[entityField] = currentModel[entityField];
                    }
                }
               
            }
        
        }
    }

}

export default EntityTrackerModel;