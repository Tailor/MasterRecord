// Version 0.0.5
class Tools{

    static checkIfArrayLike(obj) {
        if (Array.isArray(obj)) {
          return true;
        }
      
        if (
          obj &&
          typeof obj === 'object' &&
          Object.keys(obj).some(k => !isNaN(k)) &&
          '0' in obj
        ) {
          return true;
        }
      
        return -1;
    }

    static returnEntityList(list, entityList ){
        const newList = [];
        for(let max = 0; max < list.length; max++ ){
            const ent = entityList[list[max]];
            if(ent){
                if(ent.relationshipType === "hasMany" || ent.relationshipType === "hasOne"){
                    newList.push(ent.name);
                } 
            }
        }
        return newList;
    }

    static findEntity(name, entityList){
        return entityList[name];
    }

    // this will remove everthing from back slash amount
    static removeBackwardSlashSection(string, amount, type){
        type = type === undefined ? "\\" : type;
        const stringArray =  string.split(type);
        for(let i = 0; i < amount; i++){
            stringArray.pop();
        }
        return stringArray.join(type);
    }

    static getPrimaryKeyObject(model){
        for (const key in model) {
            if (Object.prototype.hasOwnProperty.call(model, key)) {
                if(model[key].primary){
                    if(model[key].primary === true){
                        return key
                    }
                }
            }
        }
    }

    /** All primary-key field names (EF HasKey(a, b)); [] when none. */
    static primaryKeys(model){
        const out = [];
        if (!model) return out;
        for (const key of Object.keys(model)) {
            if (key.startsWith('__')) continue;
            const f = model[key];
            if (f && typeof f === 'object' && f.primary === true) out.push(key);
        }
        return out;
    }

    static isCompositeKey(model){
        return Tools.primaryKeys(model).length > 1;
    }

    /** Key values of an entity as { field: value } (read without invoking navigation getters). */
    static keyValues(entity){
        const out = {};
        if (!entity || !entity.__entity) return out;
        for (const k of Tools.primaryKeys(entity.__entity)) out[k] = Tools.dataValue(entity, k);
        return out;
    }

    static findForeignTable(name, model){
        for (const key in model) {
            if (Object.prototype.hasOwnProperty.call(model, key)) {
                if(model[key].foreignTable){
                    if(model[key].foreignTable === name){
                        return model[key];
                    }
                }
            }
        }
        return null;
    }

    static createNewInstance(validModel, type, classModel){
        return new type(validModel, classModel);
    }

    static findTrackedObject(obj, name){
        for (const property in obj) {
            if(obj[property].__name === name){
                return obj[property];
            }
        }
        return {};
    }

    static clearAllProto(proto){

        const newproto = {}
        if(proto.__proto__ ){
            // Include non-enumerable own properties so we don't lose values defined via getters
            const keys = Object.getOwnPropertyNames(proto);
            for (const key of keys) {
                if(!key.startsWith("_") && !key.startsWith("__")){
                    try{
                        const value = proto[key];
                        // Skip lifecycle hooks by checking entity definition
                        if(proto.__entity && proto.__entity[key] && proto.__entity[key].lifecycle === true){
                            continue;
                        }
                        // Skip functions EXCEPT if they're defined via getters (typeof returns value, not function)
                        // Only skip if it's actually a function value (methods like save, delete, toObject)
                        if(typeof value === "function"){
                            continue;
                        }
                        // Copy the value by reference. Do NOT recurse into nested
                        // objects/arrays — clearAllProto's job is to strip tracker
                        // metadata from a tracked entity, not to deep-clone user
                        // data. Recursing here used to turn Arrays into array-like
                        // plain objects (losing the Array shape), and to walk into
                        // nested plain objects (e.g. JSON values with a custom
                        // transformer) and discard keys starting with "_".
                        newproto[key] = value;
                    }catch(_){ /* ignore getter errors */ }
                }
            }
        }

         newproto["__name"] = proto["__name"];
         newproto["__state"] = proto["__state"];
         newproto["__entity"] = proto["__entity"];
         newproto["__context"] = proto["__context"];
         newproto["__dirtyFields"] = proto["__dirtyFields"];

         newproto.__proto__ = null;
        return newproto;

    }

    /**
     * Backing-slot storage (1.23.0). A tracked entity keeps its column values,
     * navigation values and in-flight markers in NON-ENUMERABLE OWN properties
     * (`_<col>`, `_<nav>`, `__loading_<nav>`) and its prototype is the ordinary
     * shared one — so every entity of a type has the same V8 hidden class and a
     * property read costs what a plain object read costs (it used to be a fresh
     * per-row prototype object holding the slots: ~300 ns/read, megamorphic).
     * A derived clean model (`Object.create(entity)`, used by the engines) finds
     * its owner through the entity's `__self`; reads walk the chain naturally.
     */
    static slotOwner(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const self = obj.__self;
        return (self && typeof self === 'object') ? self : obj;
    }
    static hasSlot(obj, key) {
        const o = Tools.slotOwner(obj);
        return !!o && typeof o === 'object' && (key in o);
    }
    static getSlot(obj, key) {
        const o = Tools.slotOwner(obj);
        return (o && typeof o === 'object') ? o[key] : undefined;
    }
    static setSlot(obj, key, value) {
        const o = Tools.slotOwner(obj);
        if (!o || typeof o !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(o, key)) o[key] = value;
        else Object.defineProperty(o, key, { value, writable: true, enumerable: false, configurable: true });
    }
    static deleteSlot(obj, key) {
        const o = Tools.slotOwner(obj);
        if (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key)) delete o[key];
    }

    /**
     * Read a field's stored value WITHOUT invoking a navigation getter:
     * a plain data property (new Model() before tracking accessors exist),
     * else the tracked backing slot `_<key>`.
     */
    static dataValue(obj, key) {
        if (!obj || typeof obj !== 'object') return undefined;
        const d = Object.getOwnPropertyDescriptor(obj, key);
        if (d && 'value' in d) return d.value;
        if (Tools.hasSlot(obj, '_' + key)) return Tools.getSlot(obj, '_' + key);
        return undefined;
    }

    /**
     * The foreign-key VALUE to persist for a belongsTo field — the single place
     * the engines read it for INSERT/UPDATE, so a loaded navigation entity (or
     * an in-flight lazy-load Promise) can never leak into SQL.
     *
     * Resolution order (EF fix-up semantics):
     *  1. the navigation slot: an assigned entity -> its primary key; an
     *     assigned primitive (`post.author = authorId`) -> itself; null -> null;
     *  2. otherwise the FK column itself (`post.author_id`).
     */
    static foreignKeyValue(model, fieldName) {
        if (!model || typeof model !== 'object') return undefined;
        const def = model.__entity ? model.__entity[fieldName] : undefined;
        const nav = Tools.dataValue(model, fieldName);
        if (nav === null) return null;
        if (nav !== undefined && typeof nav !== 'function' && !(typeof nav.then === 'function')) {
            if (typeof nav === 'object') {
                if (nav.__entity) {
                    const pk = Tools.getPrimaryKeyObject(nav.__entity);
                    const pkVal = pk ? Tools.dataValue(nav, pk) : undefined;
                    if (pkVal !== undefined) return pkVal;
                } else if (!(nav instanceof Date)) {
                    return nav;              // plain object: let the type validator report it
                }
            } else {
                return nav;
            }
        }
        if (def && def.foreignKey) {
            const fk = Tools.dataValue(model, def.foreignKey);
            if (fk !== undefined && (fk === null || (typeof fk !== 'object' && typeof fk !== 'function'))) return fk;
        }
        return undefined;
    }

    static removePrimarykeyandVirtual(currentModel, modelEntity){
        const newCurrentModel = Object.create(currentModel);

        for(const entity in modelEntity) {
            const currentEntity = modelEntity[entity];
            if (Object.prototype.hasOwnProperty.call(modelEntity, entity)) {
                if(currentEntity.primary === true){
                    delete newCurrentModel[`_${entity}`];
                }
            }
            if(currentEntity.virtual === true){
                // skip it from the insert
                delete newCurrentModel[`_${entity}`];
            }

        }
        return newCurrentModel;
    }

    static getEntity(name, modelEntity){
        for(const entity in modelEntity) {
            const currentEntity = modelEntity[entity];
            if (Object.prototype.hasOwnProperty.call(modelEntity, entity)) {
                if(currentEntity.__name === name){
                    return currentEntity;
                }
            }
        }
        return false;
    }

    static capitalize = (s) => {
        if (typeof s !== 'string') return ''
        return s.charAt(0).toUpperCase() + s.slice(1)
    }

    static capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
      }

             // return randome letter that is not the skip letter
    static getRandomLetter(length, skip){
        let result           = '';
        const characters       = 'abcdefghijklmnopqrstuvwxyz';
        const charactersLength = characters.length;
        
        for ( let i = 0; i < length; i++ ) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
            if(skip){
                for ( let b = 0; b < skip.length; b++ ) {
                    if(result === skip[i].entity){
                        result = "";
                        i--;
                    }
                }
            }
        }
         
       return result;
    }

    // TODO: this should be removed once we create a SQLIte Manager;
    // converts any object into SQL parameter select string

    static convertEntityToSelectParameterString(obj){
        // todo: loop throgh object and append string with comma to
        let mainString = "";
        const entries = Object.keys(obj);
        for (const key of entries) {
            // Skip lifecycle hooks - they are not database columns
            if(obj[key].lifecycle === true){
                continue;
            }
            if(obj[key].type !== 'hasManyThrough' && obj[key].type !== "hasMany" && obj[key].type !== "hasOne"){
                if(obj[key].name){
                    mainString = mainString === "" ?  `${obj.__name}.${obj[key].name}` : `${mainString}, ${obj.__name}.${obj[key].name}`;
                }
            }
          }
        return mainString;;
    }

    static convertBooleanToNumber(num) {
        num = num === 'true' ? true : (num === 'false' ? false : num);
        return num ? 1 : 0;
   }

    // ---------------------------------------------------------------------
    // Security helpers shared by every SQL engine (SQLite / MySQL / Postgres)
    // ---------------------------------------------------------------------

    // The complete set of comparison operators the query builders are allowed
    // to emit into a WHERE/AND clause. `func` is derived from parsing the
    // lambda source (queryScript's OPERATORS_REGEX already restricts it), but
    // we re-assert the whitelist at the SQL boundary so a hand-built query
    // string or a future parser change can never emit an arbitrary operator
    // (which would allow SQL to be smuggled in after the column name).
    static SAFE_SQL_OPERATORS = new Set([
        '=', '!=', '<>', '<', '>', '<=', '>=',
        'is', 'is not', 'in', 'like', 'not like'
    ]);

    // Validate an operator against the whitelist. Returns the operator
    // unchanged (case/whitespace-normalized) or throws. Comparison is
    // case-insensitive so engines that upper-case (`IS`, `IN`) still pass.
    static assertSafeOperator(func){
        if(typeof func !== 'string'){
            throw new Error(`Unsupported SQL operator: ${JSON.stringify(func)}`);
        }
        const normalized = func.trim().replace(/\s+/g, ' ').toLowerCase();
        if(!Tools.SAFE_SQL_OPERATORS.has(normalized)){
            throw new Error(`Unsupported SQL operator: '${func}'. Allowed: ${[...Tools.SAFE_SQL_OPERATORS].join(', ')}`);
        }
        return func;
    }

    // Detect a "table/relation does not exist" error across all three engines
    // and extract the table name. Returns the name, or null if `err` is not a
    // missing-table error. Signatures:
    //   - Postgres (42P01) : relation "x" does not exist
    //   - MySQL (ER_NO_SUCH_TABLE) : Table 'db.tbl' doesn't exist
    //   - SQLite (better-sqlite3)  : no such table: tbl
    static missingTableName(err){
        if(!err) return null;
        const msg = String(err.message || err);
        let m = /relation "([^"]+)" does not exist/i.exec(msg);
        if(m) return m[1];
        m = /Table '(?:[^.']*\.)?([^']+)' doesn't exist/i.exec(msg);
        if(m) return m[1];
        m = /no such table:?\s*([A-Za-z0-9_]+)/i.exec(msg);
        if(m) return m[1];
        return null;
    }

    // Turn a missing-table driver error into a loud, actionable masterrecord
    // error, or null if `err` isn't one. This is what stops schema drift from
    // accumulating silently: a query against a not-yet-migrated table fails
    // with a clear message on EVERY engine instead of quietly returning null
    // (which made SQLite dev "just work" while MySQL/Postgres broke later).
    static missingTableError(err){
        const name = Tools.missingTableName(err);
        if(!name) return null;
        const friendly = new Error(
            `masterrecord: table '${name}' does not exist. If this is a new entity, ` +
            `generate and run a migration first ` +
            `(npx masterrecord add-migration <name> <context> && npx masterrecord update-database <context>). ` +
            `Original error: ${err.message || err}`
        );
        friendly.cause = err;
        friendly.missingTable = name;
        return friendly;
    }

    // Escape a value for safe interpolation inside a single-quoted SQL string
    // literal. Doubling the single quote is the ANSI-standard escape and is
    // correct on SQLite, MySQL, and Postgres (with standard_conforming_strings,
    // the default). Runtime user values should still go through `$$`/`$`
    // parameter binding; this protects the literal path (inline lambda
    // constants, string-built queries) as defense-in-depth.
    static escapeSqlLiteral(value){
        return String(value).replace(/'/g, "''");
    }
}

export default Tools;