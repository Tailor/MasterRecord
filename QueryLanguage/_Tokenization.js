

class Tokenization{
    constructor(){
        this.tokenList = [];
        this.fieldStrings = [];
        this.rules = [
            ["arrowHead", /^=>/],
            ["skip", /^skip/],
            ["take", /^take/],
            ["last", /^last/],
            ["orderByDescending", /^orderByDescending/],
            ["orderBy", /^orderBy/],
            ["groupBy", /^groupBy/],
            ["union", /^union/],
            ["find", /^find/],
            ["except", /^except/],
            ["any", /^any/],
            ["select", /^select/],
            ["distinct", /^distinct/],
            ["count", /^count/],
            ["average", /^average/],
            ["sum", /^sum/],
            ["max", /^max/],
            ["min", /^min/],
            ["join", /^join/],
            ["groupJoin", /^groupJoin/],
            ["toArray", /^toArray/],
            ["toDictionary", /^toDictionary/],
            ["toList", /^toList/],
            ["single", /^single/],
            ["where", /^where/],
            ["openBraces", /^\{/],
            ["closeBraces", /^\}/],
            ["openParenthesis", /^\(/],
            ["closeParenthesis", /^\)/],
            ["comma", /^,/],
            ["colon", /^:/],
            ["dot", /^\./],
            ["singleQuotes", /^\'/],
            ["doubleQuotes", /^\"/],
            ["greaterThen", /^>/],
            ["lessThen" , /^</],
            ["greaterThenEqualTo", /^>=/],
            ["lessThenEqualTo", /^<=/],
            ["doubleEquals" , /^==/],
            ["tripleEquals" , /^===/],
            ["notEqualsSingle", /^!=/],
            ["notEqualsDouble", /^!==/],
            ["not", /!/],
            ["in", /^contains/],
            ["like", /^like/],
            ["number", /^\d+/],
            ["or" , /^\|\|/],
            ["and", /^\&\&/], // will use between
            ["dateTimeValue", /^(-?(?:[1-9][0-9]*)?[0-9]{4})-(1[0-2]|0[1-9])-(3[01]|0[1-9]|[12][0-9])T(2[0-3]|[01][0-9]):([0-5][0-9]):([0-5][0-9])(.[0-9]+)?(Z)?$"/], //Javascript ISO 8601
           // ["propertyName", /^.+:$/],
            //["stringLiteral", /([^\s"']+)|"([^"]*)/],
            ["conversionType", /^\?/]
            //["fields", ""], // just desfult to string array and when you another rule kicks off create the string
        ]
    }

    checkIfField(remainingText,expre){
        if(/^[a-zA-Z]+$/g.test(remainingText)){
            var next = expre.charAt(1);
            return !/^[a-zA-Z]+$/g.test(next);
        }
    }

    addRule(type, regex){
        this.rules.push([type, regex]);
    }

    findMatch(expression, secondText){
        for(var tokenRule in this.rules)
        {
            var match = this.match(expression, this.rules[tokenRule], secondText);
            if(match.isMatch !== false){
                return match;
            }
        }

        return {
            isMatch : false
        }
    }

    match(inputString, rule, secondText){

        // check if expression fits into one of the rules
        var match = inputString.match(rule[1]);
        if(match !== null){
            if(match[0].length === inputString.length){
                var val = true;
                switch(rule[0]){
                    case "doubleEquals":
                        if(secondText === "="){
                            val = false;
                        }
                        // code block
                        break;
                    case "notEqualsSingle":
                        if(secondText === "="){
                            val = false;
                        }
                        // code block
                        break;
                    case "not":
                        if(secondText === "="){
                            val = false;
                        }
                    // code block
                    break;
                }
                if(val === true){
                   return {
                        value : match,
                        tokenType : rule[0],
                        isMatch : true
                    }
                }
                else{
                   return  {
                        isMatch : false
                    }
                }
            }
            else{
                return {
                    isMatch : false
                }
            }
        }
        else{
            return {
                isMatch : false
            }
        }

    }

    Tokenize(expression){
        expression = expression.replace(/\s/g, '');
        while(expression !== "")
        {   
            var remainingText = expression.charAt(0);
            var secondText = expression.substring(1, 2);
            var joinedFields = this.fieldStrings.join("") + remainingText;
            var match = this.findMatch(joinedFields, secondText);
            if (match.isMatch === true)
            {
                this.tokenList.push([match.tokenType, match.value[0]]);
                this.fieldStrings = [];
            }
            else{

                if(this.checkIfField(joinedFields, expression)){
                    this.tokenList.push(["field", joinedFields]);
                    this.fieldStrings = [];
                }
                else{
                    this.fieldStrings.push(remainingText);
                }
            }
            expression = expression.substring(1);
        }
        return this.tokenList;
    }
    
}

module.exports = Tokenization;