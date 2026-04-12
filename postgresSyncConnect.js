// Version 1.0.0 - PostgreSQL connection helper for pg 8.16.3
import pg from 'pg';
import postgresEngine from './postgresEngine.js';

const { Pool } = pg;

/**
 * PostgreSQL connection manager for MasterRecord
 * Uses pg library with connection pooling
 */
class PostgresSyncConnect {
    constructor() {
        this.pool = null;
        this.engine = null;
        this.config = null;
    }

    /**
     * Initialize PostgreSQL connection
     * @param {Object} config - Connection configuration
     * @param {string} config.host - Database host (default: 'localhost')
     * @param {number} config.port - Database port (default: 5432)
     * @param {string} config.database - Database name (required)
     * @param {string} config.user - Database user (required)
     * @param {string} config.password - Database password (required)
     * @param {number} config.max - Max pool size (default: 20)
     * @param {number} config.idleTimeoutMillis - Idle timeout (default: 30000)
     * @param {number} config.connectionTimeoutMillis - Connection timeout (default: 2000)
     */
    async connect(config) {
        if (!config.database) {
            throw new Error('PostgreSQL: database name is required');
        }
        if (!config.user) {
            throw new Error('PostgreSQL: user is required');
        }
        if (!config.password) {
            throw new Error('PostgreSQL: password is required');
        }

        this.config = {
            host: config.host || 'localhost',
            port: config.port || 5432,
            database: config.database,
            user: config.user,
            password: config.password,
            max: config.max || 20,
            idleTimeoutMillis: config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
            ssl: config.ssl || false,
            // Enable better error messages
            application_name: 'MasterRecord',
        };

        // Create connection pool
        this.pool = new Pool(this.config);

        // Test connection
        try {
            const client = await this.pool.connect();
            console.log(`PostgreSQL connected to ${config.database} at ${config.host}:${config.port}`);
            client.release();
        } catch (err) {
            console.error('PostgreSQL connection failed:', err.message);
            throw err;
        }

        // Initialize engine
        this.engine = new postgresEngine();
        this.engine.setDB(this.pool, 'postgres');

        // Set up error handlers
        this.pool.on('error', (err, client) => {
            console.error('Unexpected PostgreSQL error:', err);
        });

        this.pool.on('connect', (client) => {
            console.log('New PostgreSQL client connected');
        });

        return this.pool;
    }

    /**
     * Get the SQL engine instance
     */
    getEngine() {
        if (!this.engine) {
            throw new Error('PostgreSQL not connected. Call connect() first.');
        }
        return this.engine;
    }

    /**
     * Get the connection pool
     */
    getPool() {
        if (!this.pool) {
            throw new Error('PostgreSQL not connected. Call connect() first.');
        }
        return this.pool;
    }

    /**
     * Execute raw SQL query
     * @param {string} query - SQL query with $1, $2 placeholders
     * @param {Array} params - Query parameters
     */
    async query(query, params = []) {
        if (!this.pool) {
            throw new Error('PostgreSQL not connected. Call connect() first.');
        }

        try {
            const result = await this.pool.query(query, params);
            return result;
        } catch (err) {
            console.error('PostgreSQL query error:', err);
            throw err;
        }
    }

    /**
     * Execute query in a transaction
     * @param {Function} callback - Async function that receives client
     */
    async transaction(callback) {
        if (!this.pool) {
            throw new Error('PostgreSQL not connected. Call connect() first.');
        }

        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Transaction error:', err);
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.pool !== null;
    }

    /**
     * Get connection info
     */
    getConnectionInfo() {
        if (!this.config) {
            return null;
        }

        return {
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user,
            maxConnections: this.config.max
        };
    }

    /**
     * Close connection pool
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('PostgreSQL pool closed');
            this.pool = null;
            this.engine = null;
        }
    }

    /**
     * Health check
     */
    async healthCheck() {
        if (!this.pool) {
            return { healthy: false, error: 'Not connected' };
        }

        try {
            const result = await this.pool.query('SELECT NOW() as time, version() as version');
            return {
                healthy: true,
                serverTime: result.rows[0].time,
                version: result.rows[0].version,
                poolSize: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount
            };
        } catch (err) {
            return {
                healthy: false,
                error: err.message
            };
        }
    }
}

export default PostgresSyncConnect;
