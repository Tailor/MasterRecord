'use strict';

// version 1.0.0 - FAANG-level refactor
const tools = require('./Tools');
const queryScript = require('masterrecord/QueryLanguage/queryScript');

// Constants
const TIMESTAMP_FIELDS = {
    CREATED_AT: 'created_at',
    UPDATED_AT: 'updated_at'
};

const RELATIONSHIP_TYPES = {
    HAS_MANY: 'hasMany',
    HAS_MANY_THROUGH: 'hasManyThrough',
    BELONGS_TO: 'belongsTo',
    HAS_ONE: 'hasOne'
};

const MIN_OBJECT_KEYS = 0;

// Custom Error Classes
class InsertManagerError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'InsertManagerError';
        this.context = context;
        Error.captureStackTrace(this, this.constructor);
    }
}

class RelationshipError extends InsertManagerError {
    constructor(message, relationshipName, context = {}) {
        super(message, { ...context, relationshipName });
        this.name = 'RelationshipError';
    }
}

/**
 * Insert Manager - Handles entity insertion with relationship processing
 *
 * Manages INSERT operations for tracked entities including:
 * - Relationship hydration (hasMany, hasManyThrough, belongsTo, hasOne)
 * - Validation of required fields
 * - Error aggregation and reporting
 * - Automatic timestamp management
 *
 * @class InsertManager
 * @example
 * const manager = new InsertManager(sqlEngine, errorModel, allEntities);
 * manager.init(trackedEntity);
 */
class InsertManager {
    /**
     * Creates an insert manager instance
     *
     * @param {object} sqlEngine - Database engine instance (SQLite/MySQL/Postgres)
     * @param {object} errorModel - Validation error collector
     * @param {Array<object>} allEntities - All registered entity definitions
     */
    constructor(sqlEngine, errorModel, allEntities) {
        this._SQLEngine = sqlEngine;
        this._errorModel = errorModel;
        this._allEntities = allEntities;
        this.__queryObject = new queryScript();
    }

    /**
     * Initialize insert operation for a tracked entity
     *
     * @param {object} currentModel - Tracked entity to insert
     * @throws {InsertManagerError} If validation fails
     */
    async init(currentModel) {
        await this.runQueries(currentModel);
    }

    /**
     * Execute insert queries with relationship processing
     *
     * @param {object} currentModel - Tracked entity to insert
     * @throws {InsertManagerError} If validation fails or relationships are invalid
     */
    async runQueries(currentModel) {
        // Reset validation state for this operation to avoid stale errors
        if (this._errorModel) {
            this._errorModel.isValid = true;
            this._errorModel.errors = [];
        }

        const cleanCurrentModel = tools.clearAllProto(currentModel);
        this.validateEntity(cleanCurrentModel, currentModel, currentModel.__entity);

        if (this._errorModel.isValid) {
            const modelEntity = currentModel.__entity;
            // TODO: if you try to add belongs to you must have a tag added first. if you dont throw error
            currentModel = await this.belongsToInsert(currentModel, modelEntity);
            const SQL = await this._SQLEngine.insert(cleanCurrentModel);
            const primaryKey = tools.getPrimaryKeyObject(currentModel.__entity);

            // use returned insert id directly; avoid redundant post-insert SELECT
            if (currentModel.__entity[primaryKey].auto === true) {
                currentModel[primaryKey] = SQL.id;
            }

            const proto = Object.getPrototypeOf(currentModel);
            const props = Object.getOwnPropertyNames(proto);
            const cleanPropList = tools.returnEntityList(props, modelEntity);
            const modelKeys = Object.keys(currentModel);
            const mergedArray = [...new Set(modelKeys.concat(cleanPropList))];

            // loop through model properties
            for (const property of mergedArray) {
                const propertyModel = currentModel[property];
                const entityProperty = modelEntity[property] ? modelEntity[property] : {};

                if (entityProperty.type === RELATIONSHIP_TYPES.HAS_ONE) {
                    await this._processHasOneRelationship(propertyModel, entityProperty, property, currentModel, SQL);
                }

                if (entityProperty.type === RELATIONSHIP_TYPES.HAS_MANY) {
                    await this._processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, RELATIONSHIP_TYPES.HAS_MANY);
                }

                if (entityProperty.type === RELATIONSHIP_TYPES.HAS_MANY_THROUGH) {
                    await this._processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, RELATIONSHIP_TYPES.HAS_MANY_THROUGH);
                }
            }
        } else {
            const messages = this._errorModel.errors;
            const combinedError = messages.join('; and ');
            throw new InsertManagerError(combinedError, {
                errors: messages,
                entity: currentModel.__entity ? currentModel.__entity.__name : 'unknown'
            });
        }
    }

    /**
     * Process hasOne relationship
     *
     * @private
     * @param {*} propertyModel - Property value
     * @param {object} entityProperty - Entity property definition
     * @param {string} property - Property name
     * @param {object} currentModel - Current model being inserted
     * @param {object} SQL - SQL result from parent insert
     * @throws {RelationshipError} If relationship entity is not found
     */
    async _processHasOneRelationship(propertyModel, entityProperty, property, currentModel, SQL) {
        // only insert child if user provided a concrete object with data
        if (propertyModel && typeof propertyModel === 'object') {
            // check if model has its own entity
            const modelEntity = currentModel.__entity;
            if (!modelEntity) {
                throw new RelationshipError(
                    `Relationship "${entityProperty.name}" could not be found. Please check if object has correct spelling or if it has been added to the context class`,
                    entityProperty.name,
                    { property }
                );
            }

            // check if property has a value because we dont want this to run on every insert if nothing was added
            // ensure it has some own props; otherwise skip
            const hasOwn = Object.keys(propertyModel).length > MIN_OBJECT_KEYS;
            if (!hasOwn) {
                return;
            }

            propertyModel.__entity = tools.getEntity(property, this._allEntities);
            propertyModel[currentModel.__entity.__name] = SQL.id;
            await this.runQueries(propertyModel);

            // Hydrate child back as a tracked instance so subsequent property sets are tracked
            try {
                const childPk = tools.getPrimaryKeyObject(propertyModel.__entity);
                const childId = propertyModel[childPk];

                if (childId !== undefined) {
                    // Validate identifier is safe for SQL queries
                    if (!this._isValidIdentifier(childPk)) {
                        throw new InsertManagerError(
                            `Invalid primary key identifier: ${childPk}`,
                            { childPk, property }
                        );
                    }

                    const ctxSetName = tools.capitalizeFirstLetter(property);
                    if (currentModel.__context && currentModel.__context[ctxSetName]) {
                        const trackedChild = await currentModel.__context[ctxSetName]
                            .where(`r => r.${childPk} == $$`, childId)
                            .single();
                        if (trackedChild) {
                            currentModel[property] = trackedChild;
                        }
                    }
                }
            } catch (error) {
                // Log but don't throw - hydration is optional
                console.warn('[InsertManager] Entity hydration failed:', {
                    property,
                    error: error.message,
                    childId: propertyModel[tools.getPrimaryKeyObject(propertyModel.__entity)]
                });
            }
        }
    }

    /**
     * Process array-type relationships (hasMany, hasManyThrough)
     *
     * @private
     * @param {*} propertyModel - Property value (should be array-like)
     * @param {object} entityProperty - Entity property definition
     * @param {string} property - Property name
     * @param {object} currentModel - Current model being inserted
     * @param {object} SQL - SQL result from parent insert
     * @param {string} relationshipType - 'hasMany' or 'hasManyThrough'
     * @throws {RelationshipError} If validation fails or entity not resolved
     */
    async _processArrayRelationship(propertyModel, entityProperty, property, currentModel, SQL, relationshipType) {
        // skip when not provided; only enforce array type if user supplied a value
        if (propertyModel === undefined || propertyModel === null) {
            return;
        }

        if (!tools.checkIfArrayLike(propertyModel)) {
            throw new RelationshipError(
                `Relationship "${entityProperty.name}" must be an array`,
                entityProperty.name,
                { property, relationshipType, receivedType: typeof propertyModel }
            );
        }

        const propertyKeys = Object.keys(propertyModel);
        for (const propertykey of propertyKeys) {
            if (!propertyModel[propertykey]) {
                continue;
            }

            const targetName = entityProperty.foreignTable || property;
            const resolved = this._resolveEntityWithFallback(property, targetName);

            if (!resolved) {
                throw new RelationshipError(
                    `Relationship entity for '${property}' could not be resolved. Expected '${targetName}'.`,
                    property,
                    {
                        targetName,
                        relationshipType,
                        availableEntities: this._allEntities.map(e => e.__name)
                    }
                );
            }

            // Coerce primitive into object with primary key if user passed an id
            if (typeof propertyModel[propertykey] !== 'object' || propertyModel[propertykey] === null) {
                const childPrimaryKey = tools.getPrimaryKeyObject(resolved);
                const primitiveValue = propertyModel[propertykey];
                propertyModel[propertykey] = {};
                propertyModel[propertykey][childPrimaryKey] = primitiveValue;
            }

            propertyModel[propertykey].__entity = resolved;
            propertyModel[propertykey][currentModel.__entity.__name] = SQL.id;
            await this.runQueries(propertyModel[propertykey]);
        }
    }

    /**
     * Resolve entity with multiple fallback strategies
     *
     * @private
     * @param {string} property - Property name
     * @param {string} targetName - Target entity name
     * @returns {object|null} Resolved entity or null
     */
    _resolveEntityWithFallback(property, targetName) {
        // Try: exact match → capitalized → property name
        return tools.getEntity(targetName, this._allEntities)
            || tools.getEntity(tools.capitalize(targetName), this._allEntities)
            || tools.getEntity(property, this._allEntities);
    }

    /**
     * Validate identifier is safe for SQL queries
     *
     * @private
     * @param {string} identifier - Identifier to validate
     * @returns {boolean} True if safe
     */
    _isValidIdentifier(identifier) {
        // Allow only alphanumeric and underscore, must start with letter/underscore
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
    }

    /**
     * Insert belongsTo relationships first and return updated model
     * Will insert belongs to row first and return the id so that next call can be made correctly
     *
     * @param {object} currentModel - Current model being inserted
     * @param {object} modelEntity - Entity definition
     * @returns {object} Updated model with foreign keys populated
     */
    async belongsToInsert(currentModel, modelEntity) {
        for (const entity of Object.keys(modelEntity)) {
            if (modelEntity[entity].relationshipType === RELATIONSHIP_TYPES.BELONGS_TO) {
                const foreignKey = modelEntity[entity].foreignKey === undefined
                    ? modelEntity[entity].name
                    : modelEntity[entity].foreignKey;
                const newPropertyModel = currentModel[foreignKey];

                // check if model is an object. If so insert the child first then the parent.
                if (typeof newPropertyModel === 'object' && newPropertyModel !== null) {
                    newPropertyModel.__entity = tools.getEntity(entity, this._allEntities);
                    const propertyCleanCurrentModel = tools.clearAllProto(newPropertyModel);
                    this.validateEntity(propertyCleanCurrentModel, newPropertyModel, newPropertyModel.__entity);
                    const propertySQL = await this._SQLEngine.insert(newPropertyModel);
                    currentModel[foreignKey] = propertySQL.id;
                }
            }
        }
        // todo:
        // loop through all modelEntity and find all the belongs to
        // if belongs to is true then make sql call to insert
        // update the currentModel.
        return currentModel;
    }

    /**
     * Validate entity for nullable fields and if the entity has any values at all
     *
     * @param {object} currentModel - Clean model (no prototypes)
     * @param {object} currentRealModel - Real tracked model
     * @param {object} entityModel - Entity definition
     */
    validateEntity(currentModel, currentRealModel, entityModel) {
        for (const entity of Object.keys(entityModel)) {
            const currentEntity = entityModel[entity];

            if (!entityModel.hasOwnProperty(entity)) {
                continue;
            }

            // Detect non-primitive values (Promise, Array, plain Object) on scalar columns
            const isRelationship = currentEntity.type === RELATIONSHIP_TYPES.BELONGS_TO ||
                currentEntity.type === RELATIONSHIP_TYPES.HAS_MANY ||
                currentEntity.type === RELATIONSHIP_TYPES.HAS_MANY_THROUGH ||
                currentEntity.type === RELATIONSHIP_TYPES.HAS_ONE ||
                currentEntity.relationshipType === RELATIONSHIP_TYPES.BELONGS_TO;

            if (!isRelationship) {
                const val = currentRealModel[entity];
                if (val != null && typeof val === 'object') {
                    // Always reject Promises — a set() transform cannot meaningfully handle them
                    if (typeof val.then === 'function') {
                        const entityName = entityModel.__name || 'unknown';
                        this._errorModel.isValid = false;
                        this._errorModel.errors.push(
                            `Property '${entity}' on entity '${entityName}' contains a Promise. Did you forget to await an async call?`
                        );
                    } else if (!currentEntity.set) {
                        // Only flag Array/Object when there is no custom set() transform,
                        // since the setter may serialize them to a scalar (e.g. JSON.stringify)
                        const entityName = entityModel.__name || 'unknown';
                        if (Array.isArray(val)) {
                            this._errorModel.isValid = false;
                            this._errorModel.errors.push(
                                `Property '${entity}' on entity '${entityName}' contains an Array, expected a scalar value`
                            );
                        } else if (!(val instanceof Date)) {
                            this._errorModel.isValid = false;
                            this._errorModel.errors.push(
                                `Property '${entity}' on entity '${entityName}' contains an Object, expected a scalar value`
                            );
                        }
                    }
                }
            }

            // check if there is a default value
            if (currentEntity.default) {
                if (currentRealModel[entity] === undefined || currentRealModel[entity] === null) {
                    // if its empty add the default value
                    currentRealModel[entity] = currentEntity.default;
                }
            }

            // SKIP belongs too ----- // call sets for correct data for DB
            if (currentEntity.type !== RELATIONSHIP_TYPES.BELONGS_TO && currentEntity.type !== RELATIONSHIP_TYPES.HAS_MANY) {
                if (currentEntity.relationshipType !== RELATIONSHIP_TYPES.BELONGS_TO) {
                    // Auto-populate common timestamp fields if required and missing
                    if ((entity === TIMESTAMP_FIELDS.CREATED_AT || entity === TIMESTAMP_FIELDS.UPDATED_AT) &&
                        (currentRealModel[entity] === undefined || currentRealModel[entity] === null)) {
                        const nowVal = Date.now().toString();
                        currentRealModel[entity] = nowVal;
                        currentModel[entity] = nowVal;
                    }

                    // primary is always null in an insert so validation insert must be null
                    if (currentEntity.nullable === false && !currentEntity.primary) {
                        // if it doesnt have a get method then call error
                        if (currentEntity.set === undefined) {
                            const realVal = currentRealModel[entity];
                            const cleanVal = currentModel[entity];
                            let hasValue = (realVal !== undefined && realVal !== null) ||
                                (cleanVal !== undefined && cleanVal !== null);

                            // For strings, empty string should be considered invalid for notNullable
                            const candidate = (realVal !== undefined && realVal !== null) ? realVal : cleanVal;
                            if (typeof candidate === 'string' && candidate.trim() === '') {
                                hasValue = false;
                            }

                            // Fallback: check backing field on tracked model if both reads were undefined/null
                            if (!hasValue && currentRealModel && currentRealModel.__proto__) {
                                const backing = currentRealModel.__proto__['_' + entity];
                                hasValue = (backing !== undefined && backing !== null);
                                if (hasValue) {
                                    // normalize into both models so downstream sees it
                                    currentRealModel[entity] = backing;
                                    currentModel[entity] = backing;
                                }
                            }

                            if (!hasValue) {
                                this._errorModel.isValid = false;
                                const errorMessage = `Entity ${currentModel.__entity.__name} column ${entity} is a required Field`;
                                this._errorModel.errors.push(errorMessage);
                                //throw errorMessage;
                            }
                        } else {
                            const realData = currentEntity.set(currentModel[entity]);
                            currentRealModel[entity] = realData;
                            currentModel[entity] = realData;
                        }
                    }
                }
            }
        }
    }
}

module.exports = InsertManager;
