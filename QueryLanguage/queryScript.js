// version 1.0.1

const LOG_OPERATORS_REGEX = /(\|\|)|(&&)/;
var tools =  require('../Tools');

class queryScript{

    constructor(){ }

    script = {
        select : false,
        where: false,
        include : [],
        raw: false,
        entity : "",
        entityMap : []
    };


    reset(){
        this.script = {
            select : false,
            where: false,
            include : [],
            raw: false,
            entity : "",
            entityMap : []
        };
    }

    getScript(){
        return this.script;
    }

    raw(query){
        this.script.raw = query;
        return this.script;
    }

    where(text, entityName){
        this.buildScript(text, "where", this.script, entityName);
        return this.script;
    }

    include(text, entityName){
        this.buildScript(text, "include", this.script, entityName);
        return this.script;
    }

    select(text, entityName){
        this.buildScript(text, "select", this.script, entityName);
        return this.script;
    }

    count(queryString){
        var matched = queryString.match(/(?<=select)(.*?)from/gmi );
        matched[0] = matched[0].replace("from", "");
        var cleanQuery = queryString.replace(/^(.*?)from/gmi, "");
        var str = `Select Count(${matched[0]}) from ${cleanQuery}`

        return str;
    }

    buildScript(text, type, obj, entityName){

        var groups = this.splitByFunctions(text);
        var cachedExpr = {}; // this function will just get the high leve
        if(groups.length > 0){
          
            cachedExpr.entity = this.getEntity(text);
            
            if(!this.isMapped(entityName, obj.entityMap)){

                obj.entityMap.push({
                    name: entityName,
                    entity : cachedExpr.entity
                });
            }
            obj.entity = cachedExpr.entity
            //tools.getRandomLetter(1)
            cachedExpr[entityName] = this.splitGroupsByLogicalOperators(groups);


            // lets break the string into a list of functions
            this.buildFields(text, cachedExpr);

            if(type === "include"){
                if(cachedExpr.selectFields){
                    if(!this.isMapped(cachedExpr.selectFields[0], obj.entityMap)){
                        obj.entityMap.push({
                            name: tools.capitalizeFirstLetter(cachedExpr.selectFields[0]),
                            entity : tools.getRandomLetter(1, obj.entityMap)
                        });
                    }
                };
            }

            this.describeExpressionParts(cachedExpr[entityName], cachedExpr.selectFields[0], obj.entityMap);
            if(type === "include"){
                obj[type].push(cachedExpr)
            }
            else{
                obj[type] = cachedExpr;
            }
            obj.parentName = entityName;
            return cachedExpr;
            
        }
        else{
            // this means cachedExpr is not formated as: a => a
            if(type === "select"){
                obj.select = {
                   "selectFields": JSON.parse(text)
                }
                return obj.select;
            }
            return null;
        }

    }

    buildFields(text, desc){
        var match = text.match(/^([\w\d$_]+?)\s*=>((?:\{\sreturn\s)?[\s\S]*(?:\})?)/);
        if(match){
            const entity = match[1];
            let exprStr = match[2];
            const fields = [];

            exprStr.replace(new RegExp(entity + "\\.([\\w_]+)", "g"), function (_, field) {
                if (!fields.includes(field)) fields.push(field);
            });

            desc.expr = exprStr.trim()
            desc.selectFields = fields
            return desc;
        }
        else{
            return null;

        }
    }

    MATCH_ENTITY_REGEXP(entityName) {
      return new RegExp("(^|[^\\w\\d])" + entityName + "[ \\.\\)]");
    }

    OPERATORS_REGEX(entityName){
        return  new RegExp("(?:^|[^\\w\\d])" + entityName
        + "\\.((?:\\.?[\\w\\d_\\$]+)+)(?:\\((.*?)\\))?(?:\\s*(>|<|(?:===)|(?:!==)|(?:==)|(?:!=)|(?:=)|(?:<=)|(?:>=)|(?:in))\\s*(.*))?")
    }

    splitGroupsByLogicalOperators(groups, nested = false) {
        let parts = {}, tmp;
        for (let part of groups) {

                //tmp = this.splitByLogicalOperators(part.query, entityRegExp)
                tmp = this.extractInside(part.query, part.name);
                if(tmp){
                    part.inside = tmp;
                    parts[part.name] = part;
                }
                else{
                    part.inside = part.query;
                    parts[part.name] = part;
                }
                part.inside = part.inside.replace("&&", "and");
                part.query = part.query.replace("&&", "and");
                part.inside = part.inside.replace("||", "or");
                part.query = part.query.replace("||", "or");
        }
 
        return parts;
    }


    splitByFunctions(str) {
        const regex = /(?<=\.(?=[A-z]+\())([^(]+)\((.+?)\)(?!\))/g;
        let m;
        const items = [];
        while ((m = regex.exec(str)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            
            const [, fName, query] = m;
            items.push(
                {name: fName, query: `${fName}(${query})`}
            )
        }
        if(items.length === 0){
            items.push({name: "NOFUNCTIONS", query: str})
        }
        return items;
    }


    describeExpressionParts(parts, parentField, entityMap) {
        

            for (let item in parts) {
                        let  match, fields, func, arg;
                        var part = parts[item];
                        part.expressions = [];
                        var partQuery = part.inside;
                        var entity =  this.getEntity(partQuery);
                        var exprPartRegExp = this.OPERATORS_REGEX(entity);
                            // check if query contains an AND.
                           var splitByAnd = partQuery.split("and");
                           for (let splitAnds in splitByAnd) {
               
                                if (match = splitByAnd[splitAnds].match(exprPartRegExp)) {
                                    fields = match[1].split(".");
                                    func = (match[2] ? fields[fields.length - 1] : (match[3] || "exists"));
                                    
                                    if (func == "==" || func == "===") {
                                        func = "=";
                                    }
                                    else if (func == "!==") {
                                        func = "!=";
                                    }
        
                                    arg = match[2] || match[4];
                                    if (arg == "true" || arg == "false") {
                                        arg = arg == "true";
                                    }
                                    else if (arg && arg.charAt(0) == arg.charAt(arg.length - 1) && (arg.charAt(0) == "'" || arg.charAt(0) == '"')) {
                                        arg = arg.slice(1, -1);
                                    }
        
                                    part.entity = entity;
                                    if(this.isFunction(part.name)){
                                        var scriptInner = {
                                            include : [],
                                            entityMap : entityMap
                                        };
                                        this.buildScript(part.inside, part.name, scriptInner, parentField, true);
                                        parts.parentName = scriptInner.parentName;
                                        part[scriptInner.parentName] = {};
                                        if(part.name === "where"){
                                            part.parentName = scriptInner.parentName;
                                            part.entity = scriptInner.where.entity;
                                            part.expr = scriptInner.where.expr;
                                            part.selectFields = scriptInner.where.selectFields;
                                            part[scriptInner.parentName] = scriptInner.where[scriptInner.parentName];
                                        }
                                        if(part.name === "include"){
                                            part.parentName = scriptInner.parentName;
                                            part.entity = scriptInner.include.entity;
                                            part.expr = scriptInner.include.expr;
                                            part.selectFields = scriptInner.include.selectFields;
                                            part[scriptInner.parentName] = scriptInner.include[scriptInner.parentName];
        
                                        }
                                        if(part.name === "select"){
                                            part.parentName = scriptInner.parentName;
                                            part.entity = scriptInner.select.entity;
                                            part.expr = scriptInner.select.expr;
                                            part.selectFields = scriptInner.select.selectFields;
                                            part[scriptInner.parentName] = scriptInner.select[scriptInner.parentName];
                                        }
                                        //part.inner = scriptInner;
                                    }
                                    else{
                                        part.expressions.push({
                                            field: fields[0],
                                            func : func.toLowerCase(),
                                            arg : arg
                                        });
                                    }
                                }
                           }
                  
                    
                }

        return parts;
    }

    getEntity(str){
        var clean = str.replace(/\s/g, '');  
        return clean.substring(0, 1);
    }

    isMapped(name, maps){
        for (let item in maps) {
            var map = maps[item];
            if(tools.capitalizeFirstLetter(name) === map.name){
                return true
            }
        }
        return false;
    }

    //const res1 = extractInside(`User.include(a => a.Profile.where(r => r.name.startWith(i))).single()`, 'where');
    // const res2 = extractInside(`User.include(a => a.Profile.select(r => r.name === "rick")).single()`, 'select');
    extractInside(str, fname) {
        if(this.isFunction(fname)){
            const startIndex = str.indexOf(fname) + fname.length;
            const stack = [];
            for (let i = startIndex; i < str.length; i++) {
                if(str[i] === '(') {
                    stack.push(str[i]);

                } else if (str[i] === ')') {
                    stack.pop();
                }
                if(stack.length === 0) {
                    return str.substring(startIndex+1, i);
                }
            }
            return str;
        }
        else{
            return null;
        }
    }
    
    isFunction(func){
        var funcList = ["where", "select", "include"]
        for(var i =0; i < funcList.length; i++){
            if(funcList[i] === func){
                return true
            }
        }
        return false;
    }

}

module.exports = queryScript;