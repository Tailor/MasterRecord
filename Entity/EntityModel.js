
class EntityModel {
    
    constructor(){
        this.obj = {
            type: null,
            primary : null,
            default : null,
            required : null,
            virtual : null,
            belongsTo : null,
            get : null,
            foreignKey : null,
            maxLength : null,
            nullable : false // no
        }
    }

    type(type){
        this.obj.type = type;
        switch(type) {
            case Number:
              // code block
              this.obj.default = 0;
              this.obj.nullable = false;
              break;
          }
        return this;
    }

    maxLength(amount){
        this.obj.maxLength = amount;
        return this;
    }
    
    // is this obj a primary key
    primary(){
        this.obj.primary = true;
        return this;
    }

    // sets the default value in the DB
    default(value){
        this.obj.default = value;
        return this;
    }

    required(){
        this.obj.required = true;
        return this;
    }

    get(func){
        this.obj.get = func;
        return this;
    }

    nullable(){
        this.obj.nullable = true; // yes
        return this; 
    }

    virtual(){
        this.obj.virtual = true;
        return this;
    }

    foreignKey(tableName){
        this.obj.foreignKey = tableName;
        return this;
    }

    hasMany(name){
        this.obj.hasMany = name;
        return this;
    }
    
    belongsTo(){
        this.obj.belongsTo = true;
        return this;
    }

}
module.exports = EntityModel;