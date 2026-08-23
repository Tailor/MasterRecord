// version 1.0.0 - FAANG-Level Refactored
import tools from './Tools.js';

// Constants for relationship types
const RELATIONSHIP_TYPES = {
    HAS_ONE: 'hasOne',
    HAS_MANY: 'hasMany',
    HAS_MANY_THROUGH: 'hasManyThrough'
};

/**
 * Manages cascade deletion of entities and their relationships
 * @class DeleteManager
 */
class DeleteManager {
    constructor(sqlEngine, entities) {
        if (!sqlEngine) {
            throw new Error('DeleteManager requires a valid SQL engine');
        }
        this._SQLEngine = sqlEngine;
        this._allEntities = entities || [];
    }

    /**
     * Initialize deletion for an entity or array of entities
     * @param {Object|Array} currentModel - Entity or entities to delete
     * @throws {Error} If deletion fails
     */
    async init(currentModel) {
        // Input validation
        if (!currentModel) {
            throw new Error('DeleteManager.init() requires a valid model');
        }

        try {
            await this.cascadeDelete(currentModel);
        } catch (error) {
            // A concurrency conflict is a first-class, catchable outcome —
            // surface it unwrapped so callers can `instanceof ConcurrencyError`.
            if (error && error.name === 'ConcurrencyError') throw error;
            // Add context to other errors
            const entityName = currentModel.__entity?.__name || 'unknown';
            throw new Error(`Failed to delete ${entityName}: ${error.message}`, { cause: error });
        }
    }

    /**
     * Recursively cascade delete an entity and its relationships
     * @param {Object|Array} currentModel - Entity or entities to delete
     * @throws {Error} If cascade deletion fails
     */
    async cascadeDelete(currentModel) {
        if (!currentModel) {
            return; // Nothing to delete
        }

        if (!Array.isArray(currentModel)) {
            await this._deleteSingleEntity(currentModel);
        } else {
            await this._deleteMultipleEntities(currentModel);
        }
    }

    /**
     * Delete a single entity with cascade
     * @private
     * @param {Object} entity - Entity to delete
     */
    async _deleteSingleEntity(entity) {
        // Validate entity structure
        if (!entity.__entity) {
            throw new Error('Entity missing __entity metadata');
        }

        const entityKeys = Object.keys(entity.__entity);

        // Loop through all entity properties to find relationships
        for (const property of entityKeys) {
            const propertyConfig = entity.__entity[property];

            // Check if this is a relationship that needs cascade deletion
            if (this._isRelationshipType(propertyConfig.type)) {
                // Read the backing field directly to avoid triggering lazy-loading
                // getters, which can return Promises or error strings
                const relatedModel = tools.getSlot(entity, "_" + property);

                if (relatedModel === null || relatedModel === undefined) {
                    // Unloaded relationships are safe to skip — the database
                    // handles FK constraints; only cascade explicitly loaded data
                    continue;
                }

                // Only cascade into values that are actual tracked entities
                if (Array.isArray(relatedModel)) {
                    for (const item of relatedModel) {
                        if (item && item.__entity) {
                            await this.cascadeDelete(item);
                        }
                    }
                } else if (relatedModel && relatedModel.__entity) {
                    await this.cascadeDelete(relatedModel);
                }
            }
        }

        // Delete the entity itself after cascading. Carry the entity's
        // concurrency tokens (original values) into the DELETE's WHERE and
        // assert one row was affected — a concurrently modified/deleted row
        // matches 0 rows and must surface as ConcurrencyError, not silent
        // success (EF throws DbUpdateConcurrencyException on delete too).
        const ctx = entity.__context;
        if (ctx && typeof ctx._concurrencyClause === 'function') {
            // (+ the remaining columns of a composite key — EF HasKey(a, b))
            const clause = [
                ...ctx._concurrencyClause(entity),
                ...(typeof ctx._compositeKeyClause === 'function' ? ctx._compositeKeyClause(entity) : []),
            ];
            if (clause.length) {
                Object.defineProperty(entity, '__concurrency', {
                    value: clause, enumerable: false, writable: true, configurable: true,
                });
            }
        }
        const result = await this._SQLEngine.delete(entity);
        if (ctx && typeof ctx._assertAffected === 'function') {
            ctx._assertAffected(result, entity, 'delete');
        }
    }

    /**
     * Delete multiple entities with cascade
     * @private
     * @param {Array} entities - Array of entities to delete
     */
    async _deleteMultipleEntities(entities) {
        if (entities.length === 0) {
            return; // Nothing to delete
        }

        // Process each entity
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];

            if (!entity) {
                console.warn(`DeleteManager: Skipping null entity at index ${i}`);
                continue;
            }

            if (!entity.__entity) {
                throw new Error(`Entity at index ${i} missing __entity metadata`);
            }

            const entityKeys = Object.keys(entity.__entity);

            // Loop through relationships for cascade
            for (const property of entityKeys) {
                const propertyConfig = entity.__entity[property];

                if (this._isRelationshipType(propertyConfig.type)) {
                    // Read backing field directly to avoid triggering lazy-loading getters
                    const relatedModel = tools.getSlot(entity, "_" + property);

                    if (relatedModel === null || relatedModel === undefined) {
                        continue;
                    }

                    // Only cascade into actual tracked entities
                    if (Array.isArray(relatedModel)) {
                        for (const item of relatedModel) {
                            if (item && item.__entity) {
                                await this.cascadeDelete(item);
                            }
                        }
                    } else if (relatedModel && relatedModel.__entity) {
                        await this.cascadeDelete(relatedModel);
                    }
                }
            }

            // Delete the entity
            await this._SQLEngine.delete(entity);
        }
    }

    /**
     * Check if a property type is a relationship that requires cascade deletion
     * @private
     * @param {string} type - Property type
     * @returns {boolean} True if relationship type
     */
    _isRelationshipType(type) {
        return type === RELATIONSHIP_TYPES.HAS_ONE ||
               type === RELATIONSHIP_TYPES.HAS_MANY ||
               type === RELATIONSHIP_TYPES.HAS_MANY_THROUGH;
    }
}

export default DeleteManager;