/**
 * FieldTransformer - Production-grade field transformation system
 *
 * Allows entity fields to define custom serialization/deserialization logic
 * for transforming values between JavaScript types and database storage formats.
 *
 * @example
 * class User {
 *     constructor() {
 *         this.certified_models = {
 *             type: "string",
 *             transform: {
 *                 toDatabase: (value) => Array.isArray(value) ? JSON.stringify(value) : value,
 *                 fromDatabase: (value) => {
 *                     try { return JSON.parse(value); }
 *                     catch { return []; }
 *                 }
 *             }
 *         };
 *     }
 * }
 *
 * @author MasterRecord Team
 * @version 1.0.0
 */

class FieldTransformer {

    /**
     * Check if a field definition has a transformer
     * @param {Object} fieldDef - Field definition from entity
     * @returns {boolean}
     */
    static hasTransformer(fieldDef) {
        return fieldDef
            && typeof fieldDef === 'object'
            && fieldDef.transform
            && typeof fieldDef.transform === 'object'
            && (typeof fieldDef.transform.toDatabase === 'function'
                || typeof fieldDef.transform.fromDatabase === 'function');
    }

    /**
     * Validate transformer definition structure
     * @param {Object} transformer - The transform object
     * @param {string} entityName - Entity name for error messages
     * @param {string} fieldName - Field name for error messages
     * @throws {Error} If transformer is invalid
     */
    static validateTransformer(transformer, entityName, fieldName) {
        if (!transformer || typeof transformer !== 'object') {
            throw new Error(
                `Invalid transformer for ${entityName}.${fieldName}: ` +
                `transform must be an object with toDatabase and/or fromDatabase functions`
            );
        }

        const { toDatabase, fromDatabase } = transformer;

        // At least one direction must be provided
        if (!toDatabase && !fromDatabase) {
            throw new Error(
                `Invalid transformer for ${entityName}.${fieldName}: ` +
                `must provide at least one of: toDatabase, fromDatabase`
            );
        }

        // Validate toDatabase if present
        if (toDatabase !== undefined && typeof toDatabase !== 'function') {
            throw new Error(
                `Invalid transformer for ${entityName}.${fieldName}: ` +
                `toDatabase must be a function, got ${typeof toDatabase}`
            );
        }

        // Validate fromDatabase if present
        if (fromDatabase !== undefined && typeof fromDatabase !== 'function') {
            throw new Error(
                `Invalid transformer for ${entityName}.${fieldName}: ` +
                `fromDatabase must be a function, got ${typeof fromDatabase}`
            );
        }
    }

    /**
     * Transform a value for database storage
     * Executes the toDatabase transformer if defined
     *
     * @param {*} value - The value to transform
     * @param {Object} fieldDef - Field definition with transformer
     * @param {string} entityName - Entity name for error messages
     * @param {string} fieldName - Field name for error messages
     * @returns {*} Transformed value
     * @throws {Error} If transformation fails
     */
    static toDatabase(value, fieldDef, entityName, fieldName) {
        // No transformer - return original value
        if (!this.hasTransformer(fieldDef)) {
            return value;
        }

        const transformer = fieldDef.transform;

        // No toDatabase function - return original value
        if (!transformer.toDatabase) {
            return value;
        }

        // Execute transformation with comprehensive error handling
        try {
            const transformed = transformer.toDatabase(value);

            // Validate transformation returned a value
            if (transformed === undefined) {
                throw new Error(
                    `Transformer for ${entityName}.${fieldName} returned undefined. ` +
                    `Transform functions must return a value.`
                );
            }

            return transformed;
        } catch (err) {
            // Re-throw with context if it's already our error
            if (err.message.includes(entityName)) {
                throw err;
            }

            // Wrap external errors with context
            throw new Error(
                `Transform error for ${entityName}.${fieldName}: ${err.message}\n` +
                `Original value: ${JSON.stringify(value)}\n` +
                `Stack: ${err.stack}`
            );
        }
    }

    /**
     * Transform a value from database storage to application format
     * Executes the fromDatabase transformer if defined
     *
     * @param {*} value - The value from database
     * @param {Object} fieldDef - Field definition with transformer
     * @param {string} entityName - Entity name for error messages
     * @param {string} fieldName - Field name for error messages
     * @returns {*} Transformed value
     * @throws {Error} If transformation fails
     */
    static fromDatabase(value, fieldDef, entityName, fieldName) {
        // No transformer - return original value
        if (!this.hasTransformer(fieldDef)) {
            return value;
        }

        const transformer = fieldDef.transform;

        // No fromDatabase function - return original value
        if (!transformer.fromDatabase) {
            return value;
        }

        // Execute transformation with comprehensive error handling
        try {
            const transformed = transformer.fromDatabase(value);

            // Allow undefined return for optional transformations
            // (e.g., parsing may return undefined for null/empty strings)
            return transformed;
        } catch (err) {
            // Re-throw with context if it's already our error
            if (err.message.includes(entityName)) {
                throw err;
            }

            // Wrap external errors with context
            throw new Error(
                `Transform error for ${entityName}.${fieldName}: ${err.message}\n` +
                `Original value: ${JSON.stringify(value)}\n` +
                `Stack: ${err.stack}`
            );
        }
    }

    /**
     * Apply toDatabase transformers to all fields in an entity
     * Used during INSERT/UPDATE operations
     *
     * @param {Object} entityData - The entity data to transform
     * @param {Object} entityDef - Entity definition with field definitions
     * @returns {Object} New object with transformed values
     */
    static applyToDatabaseTransforms(entityData, entityDef) {
        const transformed = {};
        const entityName = entityDef.__name || 'Entity';

        for (const fieldName in entityData) {
            // Skip internal fields
            if (fieldName.startsWith('__')) {
                continue;
            }

            const value = entityData[fieldName];
            const fieldDef = entityDef[fieldName];

            // If no field definition, pass through
            if (!fieldDef) {
                transformed[fieldName] = value;
                continue;
            }

            // Apply transformer if present
            try {
                transformed[fieldName] = this.toDatabase(value, fieldDef, entityName, fieldName);
            } catch (err) {
                // Add operation context
                throw new Error(
                    `Failed to transform field for database write: ${err.message}`
                );
            }
        }

        return transformed;
    }

    /**
     * Apply fromDatabase transformers to all fields in an entity
     * Used during SELECT operations when building entities from database rows
     *
     * @param {Object} dbRow - Raw database row
     * @param {Object} entityDef - Entity definition with field definitions
     * @returns {Object} New object with transformed values
     */
    static applyFromDatabaseTransforms(dbRow, entityDef) {
        const transformed = {};
        const entityName = entityDef.__name || 'Entity';

        for (const fieldName in dbRow) {
            // Skip internal fields
            if (fieldName.startsWith('__')) {
                continue;
            }

            const value = dbRow[fieldName];
            const fieldDef = entityDef[fieldName];

            // If no field definition, pass through
            if (!fieldDef) {
                transformed[fieldName] = value;
                continue;
            }

            // Apply transformer if present
            try {
                transformed[fieldName] = this.fromDatabase(value, fieldDef, entityName, fieldName);
            } catch (err) {
                // Add operation context
                throw new Error(
                    `Failed to transform field from database: ${err.message}`
                );
            }
        }

        return transformed;
    }
}

export default FieldTransformer;
