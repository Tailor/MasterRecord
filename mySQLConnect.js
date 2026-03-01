// Version 1.0.0 - MySQL async connection manager using mysql2/promise
const mysql = require('mysql2/promise');

class MySQLAsyncClient {
    constructor(config) {
        this.config = {
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user,
            password: config.password,
            database: config.database,
            waitForConnections: true,
            connectionLimit: config.connectionLimit || 10,
            maxIdle: config.maxIdle ?? 2,
            idleTimeout: config.idleTimeout ?? 30000,
            queueLimit: 0
        };

        // Pass through SSL config for managed databases (DigitalOcean, AWS RDS, PlanetScale, etc.)
        if (config.ssl !== undefined) {
            this.config.ssl = config.ssl;
        }
        this.pool = null;
    }

    async connect() {
        try {
            this.pool = await mysql.createPool(this.config);
            // Test connection
            const connection = await this.pool.getConnection();
            console.log('[MySQL] Connection pool initialized successfully');
            connection.release();
        } catch (error) {
            console.error('[MySQL] Connection failed:', error.message);
            throw error;
        }
    }

    getPool() {
        return this.pool;
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('[MySQL] Connection pool closed');
        }
    }
}

module.exports = MySQLAsyncClient;
