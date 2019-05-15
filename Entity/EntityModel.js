
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
    }
    // is this obj a primary key
    primary(){
        this.obj.primary = true;
    }
    // sets the default value in the DB
    default(value){
        this.obj.default = value;
    }

    required(){
        this.obj.required = true;
    }

    get(func){
        this.obj.get = func;
    }

    virtual(){
        this.obj.virtual = true;
    }

    hasMany(name){
        this.obj.hasMany = name;
    }
    
    belongsTo(){
        this.obj.belongsTo = true;
    }

}
module.exports = EntityModel;