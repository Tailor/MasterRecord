// version 1.0.0 - FAANG-Level Refactored
const tools = require('./Tools');

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
    init(currentModel) {
        // Input validation
        if (!currentModel) {
            throw new Error('DeleteManager.init() requires a valid model');
        }

        try {
            this.cascadeDelete(currentModel);
        } catch (error) {
            // Add context to error
            const entityName = currentModel.__entity?.__name || 'unknown';
            throw new Error(`Failed to delete ${entityName}: ${error.message}`, { cause: error });
        }
    }

    /**
     * Recursively cascade delete an entity and its relationships
     * @param {Object|Array} currentModel - Entity or entities to delete
     * @throws {Error} If cascade deletion fails
     */
    cascadeDelete(currentModel) {
        if (!currentModel) {
            return; // Nothing to delete
        }

        if (!Array.isArray(currentModel)) {
            this._deleteSingleEntity(currentModel);
        } else {
            this._deleteMultipleEntities(currentModel);
        }
    }

    /**
     * Delete a single entity with cascade
     * @private
     * @param {Object} entity - Entity to delete
     */
    _deleteSingleEntity(entity) {
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
                const relatedModel = entity[property];

                if (relatedModel === null || relatedModel === undefined) {
                    // Check if relationship is required (not nullable)
                    if (!propertyConfig.nullable) {
                        throw new Error(
                            `Cannot delete ${entity.__entity.__name}: ` +
                            `required relationship '${property}' is null. ` +
                            `Set nullable: true if this is intentional.`
                        );
                    }
                } else {
                    // Recursively delete related entities
                    this.cascadeDelete(relatedModel);
                }
            }
        }

        // Delete the entity itself after cascading
        this._SQLEngine.delete(entity);
    }

    /**
     * Delete multiple entities with cascade
     * @private
     * @param {Array} entities - Array of entities to delete
     */
    _deleteMultipleEntities(entities) {
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
                    const relatedModel = entity[property];

                    if (relatedModel !== null && relatedModel !== undefined) {
                        this.cascadeDelete(relatedModel);
                    }
                }
            }

            // Delete the entity
            this._SQLEngine.delete(entity);
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

module.exports = DeleteManager;