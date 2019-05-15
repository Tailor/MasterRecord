// List all operators and base them on collections and non collections
// we can use this to validate which operators can and can't be used
 var OperatorList = {
     where : {
         type: "collection",
         section: "condition",
         returnType : "collection"
     },
     contains : {
        type: "single",
        returnType : "none"
    },
    skip : {
        type: "collection",
        returnType : "collection",
        section: "limit"
    },
    take: {
        type: "collection",
        returnType : "collection"
    },
    last: {
        type: "collection",
        returnType : "single"
    },
    orderByDescending : {

    },
    orderBy : {

    },
    groupBy : {

    },
    union: {

    },
    find : {

    },
    except : {

    },
    any : {

    },
    select : {

    },
    distinct :{

    },
    count :{

    },
    average :{

    },
    sum : {

    },
    max : {

    },
    min : {

    },
    join : {
        type: "collection",
        returnType: "collection"
    },
    groupJoin :{

    },
    toArray : {

    },
    toDictionary : {

    },
    toList : {

    },
    single : {

    }

}