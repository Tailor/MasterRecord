/*

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

*/

// version 0.0.2
class EntityModel {
    
    constructor(name){
        this.obj = {
            name: name,
            type: null,
            primary : null,
            default : null,
            virtual : null,
            foreignKey : null,
            maxLength : null,
            nullable : true, // no
            unique : false,
            auto : false,
            cascadeOnDelete : true,
            lazyLoading : true,
            isNavigational : false
            
        }
    }

    string(){
        this.obj.type = "string";
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

    boolean(){
        this.obj.type = "boolean";
        return this;
    }

    maxLength(amount){
        this.obj.maxLength = amount;
        return this;
    }

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

    // allows you to add a virtual object that will skipped from being used as sql objects
    virtual(){
        this.obj.virtual = true;
        return this;
    }

    hasMany(foreignTable, foreignKey){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        }
        this.obj.type = "hasMany";
        this.obj.foreignTable = foreignTable;
        this.obj.foreignKey = foreignKey;
        this.obj.isNavigational = true;
        return this;
    }

    hasOne(foreignTable, foreignKey){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        }
        this.obj.type = "hasOne";
        this.obj.foreignTable = foreignTable;
        this.obj.foreignKey = foreignKey;
        this.obj.isNavigational = true;
        return this;
    }

// will do a inner join with foreignKey 
    //hasManyThrough("Tagging", "tag_id") ----- if foreignKey is not provided use the name of the object_id
    hasManyThrough(foreignTable,  foreignKey ){
        if(foreignKey === undefined){
            foreignKey = `${this.obj.name.toLowerCase()}_id`;
        }
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
        this.obj.type = "belongsTo";
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
}
module.exports = EntityModel;