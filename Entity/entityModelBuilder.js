// version 0.0.3

import modelDB from './entityModel.js';

// creates new instance if entity model and calls inner functions to build out a valid entity
class EntityModelBuilder {

    static create(model){
        if(model.name === undefined){
            throw "dbset model declaired incorrectly. Check you dbset models for code errors."
        }
        const mod = new model(); //create new instance of Entity Model
        const obj = {};
        const methodNamesArray = Object.getOwnPropertyNames( mod.__proto__ );
        const constructorIndex = methodNamesArray.indexOf("constructor");
        // remove contructor method
        if (constructorIndex > -1) {
            methodNamesArray.splice(constructorIndex, 1);
        }

        // Define lifecycle hook method names that should not be treated as field definitions
        const lifecycleHooks = ['beforeSave', 'afterSave', 'beforeDelete', 'afterDelete'];

        // loop through all method names in the entity model
        for (let i = 0; i < methodNamesArray.length; i++) {
            const methodName = methodNamesArray[i];

            // Skip lifecycle hooks - they should not be called during entity construction
            if (lifecycleHooks.includes(methodName)) {
                // Store lifecycle hooks with the actual method function so they can be copied to entity instances
                obj[methodName] = {
                    virtual: true,
                    lifecycle: true,
                    name: methodName,
                    method: mod[methodName] // Store the method (not bound yet - will be bound to entity instance)
                };
                continue;
            }

            const MDB = new modelDB(model.name); // create a new instance of entity Model class
            mod[methodName](MDB);
            this.cleanNull(MDB.obj); // remove objects that are null or undefined
            if(Object.keys(MDB.obj).length === 0){
                MDB.obj.virtual = true;
            }
            MDB.obj.name = methodName;
            obj[methodName] = MDB.obj;
        }

        // Extract composite indexes from static property (Option A)
        if (model.compositeIndexes) {
            obj.__compositeIndexes = this.#normalizeCompositeIndexes(
                model.compositeIndexes,
                model.name
            );
        } else {
            obj.__compositeIndexes = [];  // Initialize empty array
        }

        return obj;
    }

    static cleanNull(obj) {
        for (const propName in obj) {
          if (obj[propName] === null) {
            delete obj[propName];
          }
        }
    }

    static #normalizeCompositeIndexes(indexes, tableName) {
        if (!Array.isArray(indexes)) {
            throw new Error(`compositeIndexes must be an array`);
        }

        return indexes.map((index, _i) => {
            // Simple array: ['col1', 'col2'] -> auto-generate name
            if (Array.isArray(index)) {
                const colNames = index.join('_');
                return {
                    columns: index,
                    name: `idx_${tableName.toLowerCase()}_${colNames}`,
                    unique: false
                };
            }

            // Object: { columns: [...], name?, unique?, where? }
            if (!index.columns || !Array.isArray(index.columns)) {
                throw new Error(`Composite index must have 'columns' array`);
            }

            const name = index.name ||
                `idx_${tableName.toLowerCase()}_${index.columns.join('_')}`;

            const normalized = {
                columns: index.columns,
                name: name,
                unique: index.unique || false
            };
            // Partial/filtered index predicate (Postgres/SQLite). Raw SQL,
            // developer-authored. Carried through to migration generation.
            if (index.where) normalized.where = index.where;
            return normalized;
        });
    }

}

export default EntityModelBuilder;