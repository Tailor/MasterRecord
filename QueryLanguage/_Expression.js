// TODO: EXPRESSION WILL HAVE METHODS THAT WILL CONVERT EXPRESIONS TO SYNTAX TREE
// TODO: THEN WE WILL TURN THAT EXPRESSION SYNTEX TREE INTO SQLENGINE OBJECTS
// TODO: THE SQL ENGINE WILL THEN CONVERT THAT TO RAW SQL
// TODO: THEN THE RAW SQL WILL BE PUSHED TO SQL DATABASE 
// TODO: ON RETURN THE OBJECT WILL PARSED USING THE ENTITY PARSER
// TODO: THE ENTITY WILL THEN BE TRACKED FOR ANY CHANGES

// EXAMPLE: https://www.npmjs.com/package/@rduk/expression
// EXAMPLE : https://goranhrovat.github.io/linqify/index.html
// LIST OF C# METHODS : https://medium.com/@aikeru/a-c-linq-to-javascript-translation-guide-6e1558fc1905




var MATCH_EXPR_REGEX = /^([\w\d$_]+?)\s*=>((?:\{\sreturn\s)?[\s\S]*(?:\})?)/;
const LOG_OPERATORS_REGEX = /(\|\|)|(&&)/;
const SPLIT_GROUP_REGEX = /(^|\||&| )\(/;
const REGEX_CACHE = {};


// ON INIT  we convert the expression into an object literal with strings
// then we loop through each object in the object literal.
// we grab the value/key of the row
// we remove the entity so that only the query is left
// we while loop through each string broken by a DOT
// we run string through a rule checker
    // is it a field in the current entity
        // if so add it to selectField
    // is it an argument
        // run it through the nestedQuery Instance
    // is it a nested field
        // if so get type collection or single
        // create new instance of query language
        // run it through some rule checker
            // if its a collection the next string item should be an argument
                // then call the nested query language instance argument.
            // if its a single then the next must be a field of that model including another nested field
                // if its a reguler field then add it the select nested field 

function describeExpressionParts(parts, exprPartRegExp) {
    let result = [], match, desc, fields, func, arg;
    for (let part of parts) {
        if (part.constructor == Array) {
            result.push(describeExpressionParts(part, exprPartRegExp));
        }
        else {
            if (part == "and" || part == "or") {
                result.push(part);
            }
            else if (match = part.match(exprPartRegExp)) {
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
                desc = {
                    field: (match[2] ? fields.slice(0, -1) : fields).join("."),
                    func: func.toLowerCase(),
                    arg: arg
                };
                result.push(desc);
            }
        }
    }
    return result;
}

function splitByLogicalOperators(str, entityRegExp) {
    let operatorIndex, parts = [], part;
    while ((operatorIndex = str.search(LOG_OPERATORS_REGEX)) != -1) {
        part = str.slice(0, operatorIndex).trim();
        // Check if this part is relevant for query -> contains entity variable
        // -> if it do nothing with entity, it shouldn't be in query eg. 1 == 1
        if (entityRegExp.test(part)) {
            parts.push(part);
        }
        parts.push(str.charAt(operatorIndex) == "|" ? "or" : "and");
        str = str.slice(operatorIndex + 2);
    }
    if (str.length > 0 && entityRegExp.test(str)) {
        parts.push(str);
    }
    return parts;
}

function splitGroupsByLogicalOperators(groups, entityRegExp, nested = false) {
    let parts = [], tmp;
    for (let part of groups) {
        if (part.constructor == Array) {
            tmp = splitGroupsByLogicalOperators(part, entityRegExp, true);
            if (tmp.length) {
                parts.push(tmp);
            }
        }
        else {
            tmp = splitByLogicalOperators(part, entityRegExp);
            if (tmp) {
                parts = parts.concat(tmp);
            }
        }
    }
    // Check if there are some doubled logical operators after removing irelevant parts
    for (let i = 0; i < parts.length; i++) {
        if ((parts[i] == "and" || parts[i] == "or") && (parts[i + 1] == "and" || parts[i + 1] == "or")) {
            parts.splice(i, 1);
            i--;
        }
    }
    const last = parts[parts.length - 1];
    // Remove operators at end of group
    if (last == "or" || last == "and") {
        parts = parts.slice(0, -1);
    }
    // If it's only one part, return that part; but returned value must be always array
    if (parts.length == 1 && (nested || parts[0].constructor == Array)) {
        return parts[0];
    }
    return parts;
}

function splitByGroups(expr) {
    const parts = [];
    let bracketIndex, end, offset = 0, opening, closing, char;
    let part = expr;
    while ((bracketIndex = part.search(SPLIT_GROUP_REGEX)) != -1) {
        // Search FIX - match symbol before bracket
        if (bracketIndex != 0 || part.charAt(0) != "(") {
            bracketIndex++;
        }
        // Count brackets -> find ending bracket
        opening = 1;
        closing = 0;
        offset = bracketIndex + 1;
        while (opening != closing && offset < part.length) {
            char = part.charAt(offset);
            if (char == "(") {
                opening++;
            }
            else if (char == ")")
                closing++;
            offset++;
        }
        if (opening != closing) {
            throw new Error("Expression has unclosed bracket");
        }
        parts.push(part.slice(0, bracketIndex).trim());
        end = offset - 1;
        // Find nested groups
        parts.push(splitByGroups(part.slice(bracketIndex + 1, end).trim()));
        part = part.slice(end + 1).trim();
    }
    if (parts.length == 0) {
        parts.push(expr);
    }
    return parts;
}

function getEntityRegExps(entityName) {
    let REGEXPS = REGEX_CACHE[entityName];
    if (!REGEXPS) {
        REGEX_CACHE[entityName] = REGEXPS = {
            MATCH_ENTITY_REGEXP: new RegExp("(^|[^\\w\\d])" + entityName + "[ \\.\\)]"),
            OPERATORS_REGEX: new RegExp("(?:^|[^\\w\\d])" + entityName
                + "\\.((?:\\.?[\\w\\d_\\$]+)+)(?:\\((.*?)\\))?(?:\\s*(>|<|(?:===)|(?:!==)|(?:==)|(?:!=)|(?:<=)|(?:>=)|(?:in))\\s*(.*))?")
        };
    }
    return REGEXPS;
}

function convertWhereExpr(expr) {
	const exprs = expr.expr;
    const { MATCH_ENTITY_REGEXP, OPERATORS_REGEX } = getEntityRegExps(expr.entity);
    const groups = splitByGroups(exprs);
    const parts = splitGroupsByLogicalOperators(groups, MATCH_ENTITY_REGEXP);
    expr.desc = describeExpressionParts(parts, OPERATORS_REGEX);
    return expr;
}

class Expression{

	constructor(){
		/**
         * List of conditions
         * @private
         */
        this.conditions = [];
        /**
         * List of filter arguments
         * @private
         */
        this.whereArgs = [];
	}

	addExpression(expression, ...args) {

		const conexpr = this.matchExpression(expression);
		const expr = convertWhereExpr(conexpr);
		// If some coditions already exists, add this WHERE as AND
		if (this.conditions.length != 0) {
			expr.desc.unshift("and");
		}
		this.whereArgs = this.whereArgs.concat(args);
		this.conditions = this.conditions.concat(expr.desc);
	}
    
    // adds the context to virtual obj
    getContext(virtualObj, contexts){

        // virtual model: type, field and arg
        var build = this.buildExpObject(virtualObj.func);
        var foundContext = false;
        for (var context of contexts) {
            if(context.name ===  virtualObj.name){
                build.context = new context();
                foundContext = true;
            }
        }

        if(foundContext === false){
            throw new Error(virtualObj.name + " is not a model name in dbset");
        }

        return build;
    }

    // builds an object from an expression
    buildExpObject(stringExpression){
        return {
            name :stringExpression.match(new RegExp("^([^.]+)", "g"))[0],
            func : stringExpression.replace(new RegExp("^([^.]+)", "g"), "").replace(/^\./, ""),
            arg: "grab the inside of the name"
        }
    }

	initExpression(expr, model, modelName) {
	
		const str = expr.toString();
        var that = this;
		if (str[str.length - 1] == "}") {
			throw new Error("Parameter expr must be simple arrow function.")
		}

		if (str[0] === "(") {
			throw new Error("Use arrow function without brackets around parameter.");
		}

		const match = str.match(MATCH_EXPR_REGEX);

		if (!match) {
			throw new Error("Invalid expression");
		}

		const entity = match[1];
		let exprStr = match[2];

        const fields = [];
        const virtualFields = [];
        const nestedFields = [];
        // var regex = new RegExp(entity + "\\.([\\w_]+)", "g");
        var regexString = "(?<=:\\" + entity + ")([^,}]*)";
        var regex = new RegExp(regexString, "g");
		exprStr.replace(regex, function (_, field) {

            // remove the entity from string
            var fieldExp = field.replace(/(\/\*[^*]*\*\/)|(\/\/[^*]*)/g, '').replace(new RegExp("^(" + entity + "\.)", "g"), "").trim();
            var fieldObj =  that.buildExpObject(fieldExp);
            const keys = Object.keys(model);
            var keyNotFound = false;
            for (const key of keys) {
                if(fieldObj.name === model[key].name){
                    keyNotFound = true;
                    if(model[key].virtual === true){
                        // check is vitual is a single or collection one to one or one to many or many to many
                        var modelKeyType;
                        if(model[key].hasMany !== undefined){
                            modelKeyType = "collection";
                        }else{
                            modelKeyType = "single";
                        }
                        fieldObj.type =  modelKeyType;
                        virtualFields.push(fieldObj);                        // we will do a left outer join
                        
                    }
                    else{
                        // if arg has no text then that means there is no nested values
                        if(fieldObj.func === ""){
                            if (!fields.includes(fieldObj.name)) fields.push(fieldObj.name);
                        }else{
                            nestedFields.push(fieldObj);
                        }
                        
                    }
                }
            }
            if(keyNotFound === false){
                throw new Error(fieldObj.name + " is not apart of " + modelName);
            }
		});

		let cachedExpr = {
			entity: entity,
			expr: exprStr.trim(),
            selectFields: fields,
            virtualFields : virtualFields,
            nestedFields : nestedFields
		};

	
		return cachedExpr;
	};
}
module.exports = Expression;