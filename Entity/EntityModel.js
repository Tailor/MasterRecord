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
// version 1.0.15

class EntityModel {
    
    constructor(){
        this.obj = {
            type: null,
            primary : null,
            default : null,
            virtual : null,
            belongsTo : null,
            get : null,
            foreignKey : null,
            maxLength : null,
            nullable : false, // no
            unique : null,
            autoIncrement : false
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

    maxLength(amount){
        this.obj.maxLength = amount;
        return this;
    }
    
    // is this obj a primary key
    primary(){
        this.obj.primary = true;
        this.obj.nullable = false;
        this.obj.unique = true;
        this.obj.autoIncrement = true;
        return this;
    }

    // sets the default value in the DB
    default(value){
        this.obj.default = value;
        return this;
    }

    // get(func){
    //     this.obj.get = func;
    //     return this;
    // }

    unique(){
        this.obj.unique = true; // yes
        return this; 

    }

    autoIncrement(){
        this.obj.autoIncrement = true;
        return this;
    }

    nullable(){
        this.obj.nullable = true; // yes
        return this; 
    }

    notNullable(){
        this.obj.nullable = false; // no
        return this; 
    }

    virtual(tableName){
        this.obj.virtual = true;
        if(tableName){
            this.obj.hasOne = tableName;
        }
        return this;
    }

    hasMany(name){
        this.obj.hasMany = name;
        return this;
    }

    hasOne(tableName){
        this.obj.hasOne = tableName;
        return this;
    }
    
    belongsTo(tableName){
        this.obj.foreignKey = tableName;
        return this
    }

    hasForeignKey(tableName){
        this.obj.foreignKey = tableName;
        return this;
    }

}
module.exports = EntityModel;