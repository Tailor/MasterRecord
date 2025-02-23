var MySql = require('sync-mysql2');


class MySQLClient {
    constructor(config) {
        this.config = config;
        this.connection = null;
    }

    connect() {
        if (!this.connection) {
            this.connection = new MySql(this.config);
        }
    }

    query(sql, params = []) {
        try {
            if (!this.connection) {
                throw new Error('Database connection not established. Call connect() first.');
            }
            var jj = this.connection.query(sql);
            this.connection.finishAll();
            return jj;
        } catch (err) {
            console.error(err);
            return null;
        }

    }

    close() {
        if (this.connection) {
            this.connection.end();
            this.connection = null;
        }
    }
}

module.exports = MySQLClient;
