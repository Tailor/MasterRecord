// version 0.0.7

const LOG_OPERATORS_REGEX = /(\|\|)|(&&)/;
var tools =  require('../Tools');

class queryScript{

    constructor(){ }

    script = {
        select : false,
        where: false,
        and : [],
        include : [],
        raw: false,
        entity : "",
        entityMap : [],
        take : 0,
        skip: 0,
        orderBy : false,
        orderByDesc : false,
        parentName : ""
    };


    reset(){
        this.script = {
            select : false,
            where: false,
            and : [],
            include : [],
            raw: false,
            entity : "",
            entityMap : [],
            take : 0,
            skip: 0,
            orderBy : false,
            orderByDesc : false
        };
    }

    getScript(){
        return this.script;
    }

    raw(query){
        this.script.raw = query;
        return this.script;
    }

    orderBy(text, entityName){
        this.buildScript(text, "orderBy", this.script, entityName);
        return this.script;
    }

    orderByDesc(text, entityName){
        this.buildScript(text, "orderByDesc", this.script, entityName);
        return this.script;
    }

    and(text, entityName){
        this.buildScript(text, "and", this.script, entityName);
        return this.script;
    }

    where(text, entityName){
        this.buildScript(text, "where", this.script, entityName);
        return this.script;
    }

    // this gets called when you skip a where clause
    skipClause(entityName){
        //this.buildScript(text, "skipClause", this.script, entityName);
        this.script.entityMap.push({
            name: entityName,
            entity : "ran"
        });
        this.script.parentName = entityName;
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

    count(text, entityName){
        this.buildScript(text, "count", this.script, entityName);
        return this.script;
    }

    buildScript(text, type, obj, entityName){

        var cachedExpr = {}; // this function will just get the high level

        /// first we find all the groups in the query string
        var querySections = this.getFunctionsInQuery(text);

        // remove spaces from query and get the Entity
        cachedExpr.entity = this.getEntity(text);
        

        if(!this.isMapped(entityName, obj.entityMap)){

            obj.entityMap.push({
                name: entityName,
                entity : cachedExpr.entity
            });
        }

        // attach the entity name to the main Object
        obj.entity = cachedExpr.entity

        cachedExpr[entityName] = this.splitGroupsByLogicalOperators(querySections.query);
        
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

        this.describeExpressionParts(cachedExpr[entityName]);
        this.describeExpressionPartsFunctions(cachedExpr[entityName], querySections.functions);
        if(type === "include" || type === "and"){
            obj[type].push(cachedExpr);
        }
        else if(type === "where"){
            // If where already exists, merge new expressions into existing where so multiple
            // chained where(...) calls combine into a single WHERE clause (joined by AND).
            if(obj.where && obj[entityName] && cachedExpr[entityName]){
                const existingQuery = obj.where[entityName].query || {};
                const incomingQuery = cachedExpr[entityName].query || {};
                const existingExprs = existingQuery.expressions || [];
                const incomingExprs = (incomingQuery.expressions || []).map(e => ({...e}));

                // Avoid OR-group id collisions across separate where calls by offsetting
                // incoming group ids by the max existing group id.
                let maxGroup = 0;
                for(let i = 0; i < existingExprs.length; i++){
                    const g = existingExprs[i] && existingExprs[i].group;
                    if(typeof g === 'number' && g > maxGroup){ maxGroup = g; }
                }
                for(let i = 0; i < incomingExprs.length; i++){
                    if(typeof incomingExprs[i].group === 'number'){
                        incomingExprs[i].group = incomingExprs[i].group + maxGroup;
                    }
                }

                existingQuery.expressions = existingExprs.concat(incomingExprs);

                // Merge selectFields for completeness (not strictly required for WHERE)
                const existingFields = existingQuery.selectFields || [];
                const incomingFields = incomingQuery.selectFields || [];
                const mergedFields = existingFields.concat(incomingFields.filter(f => existingFields.indexOf(f) === -1));
                if(mergedFields.length > 0){ existingQuery.selectFields = mergedFields; }

                // Keep original obj.where; just ensure parentName is set correctly
                obj.parentName = entityName;
            }
            else{
                obj[type] = cachedExpr;
            }
        }
        else{
            obj[type] = cachedExpr;
        }

        obj.parentName = entityName;
        return cachedExpr;
    }

   

    // look and grab all fields
    buildFields(text, desc){
        var match = text.match(/^([\w\d$_]+?)\s*=>((?:\{\sreturn\s)?[\s\S]*(?:\})?)/);
        if(match){
            const entity = match[1];
            let exprStr = match[2];
            const fields = [];

            exprStr.replace(new RegExp(entity + "\\.([\\w_]+)", "g"), function (_, field) {
                if (!fields.includes(field)) fields.push(field);
            });

            desc.expr = exprStr.trim();
            desc.selectFields = fields;
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
        // Prefer longest operators first to avoid partially matching '>' in '>=' and leaving '=' in the argument
        return  new RegExp("(?:^|[^\\w\\d])" + entityName
        + "\\.((?:\\.?[\\w\\d_\\$]+)+)(?:\\((.*?)\\))?(?:\\s*((?:===)|(?:!==)|(?:<=)|(?:>=)|(?:==)|(?:!=)|(?:in)|>|<|(?:=))\\s*(.*))?")
    }


    splitGroupsByLogicalOperators(text) {
        let parts = {}, tmp;
        var part = {query : text, name : "query"}

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
        // Normalize logical operators and add spacing so we can safely split by tokens
        part.inside = part.inside.replaceAll("&&", " and ");
        part.query = part.query.replaceAll("&&", " and ");
        part.inside = part.inside.replaceAll("||", " or ");
        part.query = part.query.replaceAll("||", " or ");

        return parts;
    }


    // find all functions from querySections
    getFunctionsInQuery(text) {

        const regex = /(?<=\.(?=[A-z]+\())([^(]+)\((.+?)\)(?!\))/g;
        let m;
        const items = [];
        
        while ((m = regex.exec(text)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            
            const [, fName, query] = m;
            items.push(
                {name: fName, query: query, inside : query, parentFeild : this.getParentField(text, m[0]), input: m.input}
            );

           text = text.replace(`${fName}(${query})`, `func`);

        }

        //items.push({name: "NOFUNCTIONS", query: str})
        
        return {
            functions: items,
            query : text
        };
    }

    getParentField(text, funcName){
       var split = text.split(".");
       for (let i = 0; i < split.length; i++) {

            if(split[i].includes(funcName)){
                return split[i -1];
            }
        }
        return "";
    }

    findExpression(fieldName, expression){
        // loop through and find expression
        for (const key in expression) {

           if(expression[key].field === fieldName){
            return expression[key]
           }
        }
    }

    describeExpressionPartsFunctions(cachedExpr, functions){
        cachedExpr.functions = [];
        if(functions.length > 0){
            for (let item in functions) {

                var part = functions[item];
                var partQuery = part.inside;
                // get entity of inside function
                var entity =  this.getEntity(partQuery);
                
                part.entity = entity;

                // is the function name white listed
                if(this.isFunction(part.name)){
                    var scriptInner =  {
                        select : false,
                        where: false,
                        and : [],
                        include : [],
                        raw: false,
                        entity : "",
                        entityMap : [],
                        take : 0,
                        skip: 0,
                        orderBy : false,
                        orderByDesc : false
                    };
                    
                    if(part.name === "where"){
                        // TODO: we need to Get this working 
                        // recall to parse inner query of function that is being called 
                        this.buildScript(part.inside, part.name, scriptInner, part.parentFeild);
                        part.parentName = scriptInner.parentName;
                        part.entity = scriptInner.where.entity;
                        part.expr = scriptInner.where.expr;
                        part.selectFields = scriptInner.where.selectFields;
                        part[scriptInner.parentName] = scriptInner.where[scriptInner.parentName];
                    }
                    if(part.name === "include"){
                        // TODO: we need to Get this working 
                        // recall to parse inner query of function that is being called 
                        this.buildScript(part.inside, part.name, scriptInner, part.parentFeild);
                        part.parentName = scriptInner.parentName;
                        part.entity = scriptInner.include.entity;
                        part.expr = scriptInner.include.expr;
                        part.selectFields = scriptInner.include.selectFields;
                        part[scriptInner.parentName] = scriptInner.include[scriptInner.parentName];
    
                    }
                    if(part.name === "select"){
                        // TODO: we need to Get this working 
                        // recall to parse inner query of function that is being called 
                        this.buildScript(part.inside, part.name, scriptInner, part.parentFeild);
                        part.parentName = scriptInner.parentName;
                        part.entity = scriptInner.select.entity;
                        part.expr = scriptInner.select.expr;
                        part.selectFields = scriptInner.select.selectFields;
                        part[scriptInner.parentName] = scriptInner.select[scriptInner.parentName];
                    }

                    // will search multiple values in a field
                    if(part.name === "any"){
                        // var members = data.memberContext.Member.where(r => r.first_name.any($$), "Rich, james, Oliver" ).toList();
                        var expre = this.findExpression(part.parentFeild, cachedExpr.query.expressions)
                        expre.func = "IN";
                        expre.arg = `(${part.query})`;
                        expre.isFunction = true;
                    }

                    if(part.name === "like"){
                        // var members = data.memberContext.Member.where(r => r.space_id == $$ && r.user_id != null && r.first_name.like($$),data.params.query.id, "r" ).toList();
                        var expre = this.findExpression(part.parentFeild, cachedExpr.query.expressions)
                        expre.func = part.name;
                        expre.arg = part.query;
                        expre.isFunction = true;
                    }

                }
                else{
                throw "Cannot have inner functions unless its a Where, Include, Select or Like caluse"
                }  
            }
        }
        
    }

    describeExpressionParts(parts) {
        if(parts.query) {
            let  match, fields, func, arg;
            var part = {};
            part.inside = parts.query.query;
            part.expressions = [];
            var partQuery = part.inside;
            var entity =  this.getEntity(partQuery);
            var exprPartRegExp = this.OPERATORS_REGEX(entity);
            // check if query contains an AND.
            var normalized = partQuery.replace(/\s+/g, ' ').trim();
            var splitByAnd = normalized.split(/\sand\s/);
            let groupId = 0;
            for (let splitAnds in splitByAnd) {
                let token = splitByAnd[splitAnds];
                // Split possible OR groups inside this AND segment
                let orParts = token.split(/\sor\s/);
                const hasOrGroup = orParts.length > 1;
                let currentGroup = hasOrGroup ? (++groupId) : null;
                for (let idx in orParts){
                    let segment = orParts[idx];
                    // strip wrapping parentheses pairs repeatedly
                    segment = segment.trim();
                    while(segment.startsWith('(') && segment.endsWith(')')){
                        segment = segment.slice(1, -1).trim();
                    }
                    if (match = segment.match(exprPartRegExp)) {
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
                        const exprObj = {
                            field: fields[0],
                            func : func.toLowerCase(),
                            arg : arg
                        };
                        if(currentGroup){ exprObj.group = currentGroup; }
                        part.expressions.push(exprObj);
                        parts.query =  part;
                    }
                }
            }
        }

        return parts;
    }

    getEntity(str){
        // Prefer parsing the lambda parameter (e.g., 'uc' in 'uc => uc.user_id == $$')
        const m = str.match(/^\s*([\w\d$_]+?)\s*=>/);
        if(m && m[1]){
            return m[1];
        }
        // Fallback to previous behavior: first non-space char
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
        var funcList = [ "include", "like", "any"]
        for(var i =0; i < funcList.length; i++){
            if(funcList[i] === func){
                return true
            }
        }
        return false;
    }

}

module.exports = queryScript;