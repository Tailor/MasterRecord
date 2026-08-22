/*

Supported column types:
:binary
:boolean
:date
:datetime
:decimal
:float
:integer
:bigint
:primary_key
:references
:string
:text
:time
:timestamp

Reserved Property Names:
- Properties starting with '__' (double underscore) are reserved for internal metadata
- 'indexes' property is reserved for index definitions
- These properties are automatically skipped during table creation in migration queries

*/

// version 0.0.5
class EntityModel {
    
    constructor(name){
        this.obj = {
            name: name,
            type: null,
            relationshipType: null,
            typeSize : null,
            primary : null,
            default : null,
            virtual : null,
            foreignKey : null,
            nullable : true, // no
            unique : false,
            auto : false,
            cascadeOnDelete : true,
            lazyLoading : true,
            isNavigational : false,
            skipGetFunction :false,
            valueConversion : true
            
        }
    }

    type(type, size){
        this.obj.type = type;
        this.obj.typeSize = size;
        return this;
    }

    string(){
        this.obj.type = "string";
        return this;
    }

    text(){
        this.obj.type = "text";
        return this;
    }

    /**
     * Medium-length text. On MySQL emits `MEDIUMTEXT` (up to ~16 MB).
     * On SQLite and PostgreSQL collapses to `TEXT` (already unlimited there),
     * so the same entity definition works portably across engines.
     */
    mediumtext(){
        this.obj.type = "mediumtext";
        return this;
    }

    /**
     * Long-form text. On MySQL emits `LONGTEXT` (up to ~4 GB).
     * On SQLite and PostgreSQL collapses to `TEXT` (already unlimited there).
     */
    longtext(){
        this.obj.type = "longtext";
        return this;
    }

    integer(){
        this.obj.type = "integer";
        return this;
    }

    time(){
        this.obj.type = "time";
        return this;
    }

    // Date/time columns. All resolve to TEXT on SQLite, native types on
    // MySQL/Postgres. Store ISO-8601 strings (or epoch numbers) in them.
    date(){
        this.obj.type = "date";
        return this;
    }

    datetime(){
        this.obj.type = "datetime";
        return this;
    }

    timestamp(){
        this.obj.type = "timestamp";
        return this;
    }

    boolean(){
        this.obj.type = "boolean";
        return this;
    }

    // Numeric columns beyond integer: REAL on SQLite, native on MySQL/Postgres.
    float(){
        this.obj.type = "float";
        return this;
    }

    decimal(){
        this.obj.type = "decimal";
        return this;
    }

    bigint(){
        this.obj.type = "bigint";
        return this;
    }

    // Stored as TEXT/JSON depending on engine. Pair with .get()/.set() (or a
    // transformer) to (de)serialize objects automatically.
    json(){
        this.obj.type = "json";
        return this;
    }

    // Universally-unique identifier column (TEXT on SQLite).
    uuid(){
        this.obj.type = "uuid";
        return this;
    }

    // Raw binary column (BLOB).
    binary(){
        this.obj.type = "binary";
        return this;
    }

    // maxLength(amount){
    //     this.obj.maxLength = amount;
    //     return this;
    // }

    // will stop cascade delete which means it will stop not auto delete relationship
    stopCascadeOnDelete(){
        this.obj.cascadeOnDelete = false;
        return this;
    }
    
    // is this obj a primary key
    primary(){
        this.obj.primary = true;
        this.obj.nullable = false;
        this.obj.unique = true;
        return this;
    }
    
    // allows ablity to get back primaryKey on insert automaticlly return on insert
    auto(){
        this.obj.auto = true;
        return this;
    }

    /**
     * Mark this column as an optimistic-concurrency token (EF Core's
     * IsConcurrencyToken / [ConcurrencyCheck]). Its ORIGINAL value (as loaded)
     * is added to the WHERE clause of every UPDATE/DELETE of the row:
     *   UPDATE ... WHERE id = ? AND <col> = <original>
     * If the row was changed by someone else since it was loaded, 0 rows match
     * and saveChanges() throws ConcurrencyError instead of silently overwriting.
     * The application is responsible for setting a new value when it changes
     * the row (e.g. a GUID) — or use rowVersion() to have the ORM do it.
     */
    concurrencyToken(){
        this.obj.concurrencyToken = true;
        return this;
    }

    /**
     * An ORM-managed integer version column (EF Core's IsRowVersion, but
     * application-managed so it works identically on SQLite, MySQL and
     * PostgreSQL). It is a concurrency token that saveChanges() increments
     * atomically on every UPDATE (`SET <col> = <col> + 1 ... WHERE <col> =
     * <original>`); you never set it yourself. Defaults to 0, NOT NULL.
     */
    rowVersion(){
        if (!this.obj.type) this.obj.type = 'integer';
        this.obj.concurrencyToken = true;
        this.obj.rowVersion = true;
        this.obj.nullable = false;
        if (this.obj.default === undefined || this.obj.default === null) this.obj.default = 0;
        return this;
    }

    // sets the default value in the DB
    default(value){
        this.obj.default = value;
        return this;
    }

    get(func){
        this.obj.get = func;
        return this;
    }

    set(func){
        this.obj.set = func;
        return this;
    }

    unique(){
        this.obj.unique = true; // yes
        return this;

    }

    /**
     * Adds an index to this column definition.
     *
     * Note: The 'indexes' property is metadata and will be automatically skipped
     * during table creation. Properties starting with '__' are also reserved for
     * internal metadata and filtered during schema processing.
     *
     * @param {string} indexName - Optional custom name for the index. If not provided,
     *                              a default name will be generated.
     * @returns {EntityModel} Returns this for method chaining
     */
    index(indexName){
        if(!this.obj.indexes){
            this.obj.indexes = [];
        }
        this.obj.indexes.push(indexName || true);
        return this;
    }

    // this means that it can be an empty field
    nullable(){
        this.obj.nullable = true; // yes
        return this; 
    }

    notNullable(){
        this.obj.nullable = false; // no
        return this; 
    }

    //allows you to stop lazy loading because lazy loading is added by default
    lazyLoadingOff(){
        this.obj.lazyLoading = false;
        return this;
    }

    valueConversion(bool){
        this.obj.valueConversion = bool;
        return this;
    }

    // allows you to add custom field transformers for serialization/deserialization
    transform(transformObj){
        this.obj.transform = transformObj;
        return this;
    }

    // allows you to add a virtual object that will skipped from being used as sql objects
    virtual(){
        this.obj.virtual = true;
        return this;
    }

    hasMany(foreignTable, foreignKey){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        }
        this.obj.relationshipType = "hasMany";
        this.obj.type = "hasMany";
        this.obj.foreignTable = foreignTable;
        this.obj.foreignKey = foreignKey;
        this.obj.isNavigational = true;
        this.obj.nullable = false;
        return this;
    }

    // DB must have a record or exception will be thrown unless set to nullable
    hasOne(foreignTable, foreignKey){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        }
        this.obj.relationshipType = "hasOne";
        this.obj.type = "hasOne";
        this.obj.foreignTable = foreignTable;
        this.obj.foreignKey = foreignKey;
        this.obj.isNavigational = true;
        this.obj.nullable = false;
        return this;
    }

// will do a inner join with foreignKey 
    //hasManyThrough("Tagging", "tag_id") ----- if foreignKey is not provided use the name of the object_id
    hasManyThrough(foreignTable,  foreignKey ){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        };
        this.obj.relationshipType = "hasManyThrough";
        this.obj.type = "hasManyThrough";
        this.obj.foreignTable = foreignTable;// if joinKey is undefined then use name of object. 
        this.obj.foreignKey = foreignKey; // Foreign Key table
        this.obj.isNavigational = true;
        return this;
    }

    // will get info
    belongsTo(foreignTable, foreignKey){

        if(foreignKey === undefined){
            foreignKey = `${foreignTable.toLowerCase()}_id`;
        }
        // will use table name to find forien key
        this.obj.type = "integer";
        this.obj.relationshipType = "belongsTo";
        
        this.obj.foreignTable = foreignTable; // this is the table name of the current table if diffrent from the object name
        this.obj.foreignKey = foreignKey; // this is the table name of the joining table
        this.obj.nullable = false; // this means it cannot be null
        return this
    }

    foreignKey(foreignKey){
        this.obj.foreignKey = foreignKey;
        this.obj.nullable = false;
        return this
    }

    foreignTable(foreignTable){
        this.obj.foreignTable = foreignTable;
        this.obj.nullable = false;
        return this
    }

    // ===== Validation Methods =====

    /**
     * Validate that field value is required (not null, undefined, or empty string)
     * @param {string} message - Custom error message
     */
    required(message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'required',
            message: message || `${this.obj.name} is required`
        });
        this.obj.nullable = false;
        return this;
    }

    /**
     * Validate email format
     * @param {string} message - Custom error message
     */
    email(message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'email',
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            message: message || `${this.obj.name} must be a valid email address`
        });
        return this;
    }

    /**
     * Validate minimum string length
     * @param {number} length - Minimum length
     * @param {string} message - Custom error message
     */
    minLength(length, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'minLength',
            length: length,
            message: message || `${this.obj.name} must be at least ${length} characters`
        });
        return this;
    }

    /**
     * Validate maximum string length
     * @param {number} length - Maximum length
     * @param {string} message - Custom error message
     */
    maxLength(length, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'maxLength',
            length: length,
            message: message || `${this.obj.name} must be at most ${length} characters`
        });
        return this;
    }

    /**
     * Validate against regex pattern
     * @param {RegExp} pattern - Regular expression to match
     * @param {string} message - Custom error message
     */
    pattern(regex, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'pattern',
            pattern: regex,
            message: message || `${this.obj.name} format is invalid`
        });
        return this;
    }

    /**
     * Validate minimum numeric value
     * @param {number} min - Minimum value
     * @param {string} message - Custom error message
     */
    min(minValue, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'min',
            min: minValue,
            message: message || `${this.obj.name} must be at least ${minValue}`
        });
        return this;
    }

    /**
     * Validate maximum numeric value
     * @param {number} max - Maximum value
     * @param {string} message - Custom error message
     */
    max(maxValue, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'max',
            max: maxValue,
            message: message || `${this.obj.name} must be at most ${maxValue}`
        });
        return this;
    }

    /**
     * Custom validation function
     * @param {Function} validatorFn - Function that returns true if valid, false if invalid
     * @param {string} message - Custom error message
     */
    custom(validatorFn, message) {
        if (!this.obj.validators) {
            this.obj.validators = [];
        }
        this.obj.validators.push({
            type: 'custom',
            validator: validatorFn,
            message: message || `${this.obj.name} is invalid`
        });
        return this;
    }
}
export default EntityModel;