// version : 0.0.3

var MySql = require('sync-mysql2');

class MySQLClient {
    constructor(config) {
        this.config = config ? { ...config } : {};
        if (this.config && Object.prototype.hasOwnProperty.call(this.config, 'type')) {
            delete this.config.type;
        }
        this.connection = null;
        this.lastErrorCode = null;
        this.lastErrorMessage = null;
    }

    connect() {
        try {
            if (!this.connection) {
                const { type, ...safeConfig } = this.config || {};
                this.connection = new MySql(safeConfig);
            }
        } catch (err) {
            // Swallow connection errors and leave connection undefined so callers can react gracefully
            this.lastErrorCode = err && err.code ? err.code : null;
            this.lastErrorMessage = err && err.message ? err.message : String(err);
            if(this.lastErrorCode === 'ER_BAD_DB_ERROR'){
                const dbName = this.config && this.config.database ? this.config.database : '(unknown)';
                console.error(`MySQL connect error: database '${dbName}' does not exist`);
            }else{
                console.error('MySQL connect error:', this.lastErrorCode || this.lastErrorMessage);
            }
            this.connection = null;
            return null;
        }
    }

    query(sql, params = []) {
        try {
            if (!this.connection) {
                return null;
            }
            var jj = this.connection.query(sql);
            this.connection.finishAll();
            return jj;
        } catch (err) {
            // If the underlying driver surfaces bad DB or network errors, normalize to null
            this.lastErrorCode = err && err.code ? err.code : null;
            this.lastErrorMessage = err && err.message ? err.message : String(err);
            if(this.lastErrorCode === 'ER_BAD_DB_ERROR'){
                const dbName = this.config && this.config.database ? this.config.database : '(unknown)';
                console.error(`MySQL error: database '${dbName}' does not exist`);
            } else if(this.lastErrorCode === 'ECONNREFUSED' || this.lastErrorCode === 'PROTOCOL_CONNECTION_LOST'){
                console.error('MySQL connection error:', this.lastErrorCode);
            } else {
                console.error(err);
            }
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
