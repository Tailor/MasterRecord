
const Masterrecord = require('masterrecord');

class User extends Masterrecord.Migrations {

    constructor() {
        super();
    }

    static up(){
        [templateUp]
    }

    static down(){
        [templateDown]        
    }
}

module.exports = User;