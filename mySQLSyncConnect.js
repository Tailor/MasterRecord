// version : 0.0.3

var MySql = require('sync-mysql2');

class MySQLClient {
    constructor(config) {
        this.config = config ? { ...config } : {};
        if (this.config && Object.prototype.hasOwnProperty.call(this.config, 'type')) {
            delete this.config.type;
        }
        this.connection = null;
    }

    connect() {
        try {
            if (!this.connection) {
                const { type, ...safeConfig } = this.config || {};
                this.connection = new MySql(safeConfig);
            }
        } catch (err) {
            // Swallow connection errors and leave connection undefined so callers can react gracefully
            console.error('MySQL connect error:', err && err.code ? err.code : err);
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
            const code = err && err.code ? err.code : '';
            if(code === 'ER_BAD_DB_ERROR' || code === 'ECONNREFUSED' || code === 'PROTOCOL_CONNECTION_LOST'){
                console.error('MySQL query skipped due to connection not defined');
                return null;
            }
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
