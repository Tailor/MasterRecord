
// version : 0.0.9
import tools from '../Tools.js';
import FieldTransformer from './fieldTransformer.js';

class EntityTrackerModel {


    // entity states https://docs.microsoft.com/en-us/dotnet/api/system.data.entitystate?view=netframework-4.7.2

    // start tracking model
    build(dataModel, currentEntity, context){
        const $that = this;
        const modelClass = this.buildObject(); // build entity with models
        modelClass.__proto__ = {};
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

            // Mark entity for deletion
            this.__state = 'delete';

            // Ensure entity is tracked
            if (!this.__context.__trackedEntitiesMap.has(this.__ID)) {
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

            // Get primary key
            const primaryKey = tools.getPrimaryKeyObject(this.__entity);
            const primaryKeyValue = this[primaryKey];

            if (!primaryKeyValue) {
                throw new Error('Cannot reload: entity has no primary key value');
            }

            // Fetch fresh from database
            const EntityClass = this.__context[this.__name];
            const fresh = await EntityClass.findById(primaryKeyValue);
            if (!fresh) {
                throw new Error(
                    `Cannot reload: ${this.__name} with ${primaryKey}=${primaryKeyValue} not found`
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
                    this.__proto__["_" + fieldName] = fresh.__proto__["_" + fieldName];
                }
            }

            // Reset dirty fields and state
            this.__dirtyFields = [];
            this.__state = 'track';

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

        target["__proto__"]["_" + modelField] = transformedValue;

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
                if (this.__context && typeof this.__context.__track === 'function') {
                    this.__context.__track(this);
                }
                const fieldDefForSet = currentEntity[modelField];
                let storedValue;
                if (fieldDefForSet && typeof fieldDefForSet.set === "function") {
                    storedValue = fieldDefForSet.set(value);
                } else {
                    storedValue = value;
                }
                this["__proto__"]["_" + modelField] = storedValue;
                if (navNameForFk) {
                    this["__proto__"]["_" + navNameForFk] = storedValue;
                }
            },
            get: function() {
                if (currentEntity[modelField]) {
                    if (!currentEntity[modelField].skipGetFunction) {
                        if (typeof currentEntity[modelField].get === "function") {
                            return currentEntity[modelField].get(this["__proto__"]["_" + modelField]);
                        } else {
                            return this["__proto__"]["_" + modelField];
                        }
                    } else {
                        return this["__proto__"]["_" + modelField];
                    }
                } else {
                    return this["__proto__"]["_" + modelField];
                }
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
     * A per-entity backing layer is spliced into the prototype chain
     * (`Object.create(originalProto)`) so `_<field>` backings stay per-instance
     * while the class prototype — and any lifecycle-hook methods on it — remain
     * reachable.
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

        // Splice a fresh backing layer in front of the original prototype so the
        // class prototype (and its lifecycle hooks) stays reachable.
        Object.setPrototypeOf(target, Object.create(Object.getPrototypeOf(target)));
        Object.defineProperty(target, '__trackingAttached', {
            value: true, enumerable: false, writable: true, configurable: true,
        });

        for (const modelField of scalarFields) {
            // applyFromDb=false: the captured value is already the domain value
            // the user set and that the INSERT persisted — not a raw DB row.
            this._defineTrackedColumn(target, modelField, captured[modelField], currentEntity, fkToNavName, false);
        }
        return target;
    }

    buildObject(){
        return {
            __ID : Math.floor((Math.random() * 100000) + 1),
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
                        if(typeof value === "string" || typeof value === "number" || typeof value === "boolean"  || typeof value === "bigint" ){
                            modelClass.__state = "modified";
                            modelClass.__version = (modelClass.__version || 0) + 1;
                            modelClass.__dirtyFields.push(entityField);
                             modelClass.__context.__track(modelClass);
                        }
                        this["__proto__"]["_" + entityField] = value;
                    },
                    get : function(){
                        let ent = tools.findEntity(entityField, this.__context);
                        if(!ent){
                            const parentEntity = tools.findEntity(this.__name, this.__context);
                            if(parentEntity){
                                ent = tools.findEntity(parentEntity.__entity[entityField].foreignTable, this.__context);
                                if(!ent){
                                    return  `Error - Entity ${parentEntity.__entity[entityField].foreignTable} not found. Please check your context for proper name.`
                                }
                            }
                            else{
                                return  `Error - Entity ${parentEntity} not found. Please check your context for proper name.`
                            }
                        }
    
                        
                        if(currentEntity[entityField].relationshipType === "belongsTo"){
                            if(currentEntity[entityField].lazyLoading){
                                 // TODO: UPDATE THIS CODE TO USE SOMETHING ELSE - THIS WILL NOT WORK WHEN USING DIFFERENT DATABASES BECAUSE THIS IS USING SQLITE CODE. 
                            
                                 const name = currentEntity[entityField].foreignKey;
                                 var priKey = tools.getPrimaryKeyObject(ent.__entity);
     
                                 //var idValue = currentEntity[entityField].foreignKey;
                                 const currentValue = this.__proto__[`_${name}`];
                                 const val = this["__proto__"]["_"+entityField];
                                 var modelValue = null;
                                 if(!val){
                                    modelValue = ent.where(`r => r.${priKey} == ${ currentValue }`).single();
                                     
                                 }
                                 else{
                                    modelValue = val;
                                 }
     
                                 this[entityField] = modelValue;
                            }
                            else{
                                return this["__proto__"]["_" + entityField];
                            }
                        }
                        else{
                            // user.tags = gets all tags related to user
                            // tag.users = get all users related to tags
                            if(currentEntity[entityField].lazyLoading){
                                var priKey = tools.getPrimaryKeyObject(this.__entity);
                                var entityName = currentEntity[entityField].foreignTable === undefined ? entityField : currentEntity[entityField].foreignTable;
                                let tableName = "";
                                if(entityName){
                                    switch(currentEntity[entityField].type){
                                        // TODO: move the SQL generation part to the SQL builder so that we can later on use many diffrent types of SQL databases. 
                                        case "hasManyThrough" :
                                            try{
                                                const joiningEntity = this.__context[tools.capitalize(entityName)];
                                                const entityFieldJoinName = currentEntity[entityField].foreignTable === undefined? entityField : currentEntity[entityField].foreignTable;
                                                const _thirdEntity = this.__context[tools.capitalize(entityFieldJoinName)];
                                                const firstJoiningID = joiningEntity.__entity[this.__entity.__name].foreignTable;
                                                const secondJoiningID = Object.values(joiningEntity.__entity).find(e => e.foreignTable === ent.__name);
                                                if(firstJoiningID && secondJoiningID )
                                                {
                                                    var modelValue = ent.include(`p => p.${entityFieldJoinName}.select(j => j.${joiningEntity.__entity[this.__entity.__name].foreignKey})`).include(`p =>p.${this.__entity.__name}`).where(`r =>r.${this.__entity.__name}.${priKey} = ${this[priKey]}`).toList();
                                                    // var modelQuery = `select ${selectParameter} from ${this.__entity.__name} INNER JOIN ${entityName} ON ${this.__entity.__name}.${priKey} = ${entityName}.${firstJoiningID} INNER JOIN ${entityField} ON ${entityField}.${joinTablePriKey} = ${entityName}.${secondJoiningID} WHERE ${this.__entity.__name}.${priKey} = ${ this[priKey]}`;
                                                    // var modelValue = ent.raw(modelQuery).toList();
                                                    this[entityField] = modelValue;
                                                }
                                                else{
                                                    return "Joining table must declaire joining table names"
                                                }
                                            }
                                            catch(error){
                                                return error;
                                            }
                                        /*
                                        select * from User 
                                        INNER JOIN Tagging ON User.id = Tagging.user_id
                                        INNER JOIN Tag ON Tag.id = Tagging.tag_id
                                        WHERE Tagging.user_id = 13
                                        */
                                        break;
                                        case "hasOne" : 
                                            var entityName = tools.findForeignTable(this.__entity.__name, ent.__entity);
                                            if(entityName){
                                                tableName = entityName.foreignKey;
                                            }
                                            else{
                                                return `Error - Entity ${ent.__entity.__name} has no property named ${this.__entity.__name}`;
                                            }
    
                                            //var jj = ent.raw(`select * from ${entityName} where ${tableName} = ${ this[priKey] }`).single();
                                            var modelValue = ent.where(`r => r.${tableName} == ${this[priKey]}`).single();
                                            this[entityField] = modelValue;
                                        break;
                                        case "hasMany" : 
                                            var entityName = tools.findForeignTable(this.__entity.__name, ent.__entity);
                                            if(entityName){
                                                tableName = entityName.foreignKey;
                                            }
                                            else{
                                                return  `Error - Entity ${ent.__entity.__name} has no property named ${this.__entity.__name}`;
                                            }
                                            //var modelValue = ent.raw(`select * from ${entityName} where ${tableName} = ${ this[priKey] }`).toList();
                                            var modelValue = ent.where(`r => r.${tableName} == ${this[priKey]}`).toList();
                                            this[entityField] = modelValue;
                                        break;
                                    }
                                }
                                else{
                                    return  "Entity name must be defined"
                                }
                            }
                            else{
                                return this["__proto__"]["_" + entityField];
                            }
                        }
                        
                        
                        return this["__proto__"]["_" + entityField];
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