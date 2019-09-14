
class EntityModel {
    
    constructor(){
        this.obj = {
            type: null,
            primary : null,
            default : null,
            required : null,
            virtual : null,
            belongsTo : null,
            get : null
        }
    }

    type(type){
        this.obj.type = type;
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

    virtual(){
        this.obj.virtual = true;
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