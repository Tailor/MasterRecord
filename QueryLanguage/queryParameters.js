// QueryParameters - Manages parameterized query values
// Version 1.0.0
// Provides SQL injection protection through proper parameterization

class QueryParameters {
    constructor() {
        this.params = [];
        this.paramIndex = 0;
    }

    /**
     * Add a parameter value and return the placeholder
     * @param {*} value - The value to add
     * @param {string} dbType - 'sqlite', 'mysql', or 'postgres'
     * @returns {string} - The placeholder (? for MySQL/SQLite, $1 for Postgres)
     */
    addParam(value, dbType = 'sqlite') {
        // Validate value is not undefined
        if (typeof value === 'undefined') {
            throw new Error(`Parameter value cannot be undefined at index ${this.paramIndex}`);
        }

        // Add to parameters array
        this.params.push(value);
        this.paramIndex++;

        // Return appropriate placeholder based on database type
        switch(dbType.toLowerCase()) {
            case 'postgres':
                return `$${this.paramIndex}`;  // $1, $2, $3...
            case 'mysql':
            case 'sqlite':
            default:
                return '?';  // ? for MySQL and SQLite
        }
    }

    /**
     * Add multiple parameters (for IN clauses)
     * @param {Array} values - Array of values
     * @param {string} dbType - Database type
     * @returns {string} - Comma-separated placeholders like "?, ?, ?"
     */
    addParams(values, dbType = 'sqlite') {
        if (!Array.isArray(values)) {
            throw new Error('addParams expects an array');
        }

        if (values.length === 0) {
            throw new Error('Cannot create IN clause with empty array');
        }

        const placeholders = [];
        for (const value of values) {
            placeholders.push(this.addParam(value, dbType));
        }

        return placeholders.join(', ');
    }

    /**
     * Get all collected parameters
     * @returns {Array} - Array of parameter values
     */
    getParams() {
        return this.params;
    }

    /**
     * Get parameter count
     * @returns {number} - Number of parameters
     */
    count() {
        return this.params.length;
    }

    /**
     * Reset parameters (called after query execution)
     */
    reset() {
        this.params = [];
        this.paramIndex = 0;
    }

    /**
     * Merge parameters from another QueryParameters instance
     * Used when combining multiple query clauses
     * @param {QueryParameters} other - Another QueryParameters instance
     */
    merge(other) {
        if (other && other.params && Array.isArray(other.params)) {
            this.params.push(...other.params);
            this.paramIndex += other.params.length;
        }
    }

    /**
     * Validate a value is safe for parameterization
     * Rejects functions, symbols, and other unsafe types
     * @param {*} value - Value to validate
     * @returns {boolean} - True if valid
     * @throws {Error} - If value is invalid
     */
    validateValue(value) {
        const type = typeof value;

        // Allow null (SQL NULL)
        if (value === null) {
            return true;
        }

        // Allow primitives
        if (type === 'string' || type === 'number' || type === 'boolean') {
            return true;
        }

        // Allow Date objects
        if (value instanceof Date) {
            return true;
        }

        // Allow Buffer (for binary data)
        if (Buffer.isBuffer(value)) {
            return true;
        }

        // Reject everything else (functions, objects, symbols, etc.)
        throw new Error(
            `Invalid parameter type: ${type}. ` +
            `Only primitives, null, Date, and Buffer are allowed. ` +
            `Received: ${JSON.stringify(value)}`
        );
    }
}

export default QueryParameters;
