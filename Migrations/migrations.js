// version 0.0.11
// learn more about seeding info -  https://www.pauric.blog/Database-Updates-and-Migrations-with-Entity-Framework/

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as diff from 'deep-object-diff';
import { globSync } from 'glob';
import MigrationTemplate from './migrationTemplate.js';
import { resolveMigrationsDirectory, toPosixPath } from './pathUtils.js';

// https://blog.tekspace.io/code-first-multiple-db-context-migration/

// node masterrecord add-migration josh C:\Users\rbatista\Downloads\kollege\freshmen\app\models\context
class Migrations{

    #organizeSchemaByTables(oldSchema, newSchema){
            const tables = []
            const seenTableNames = new Set();  // Track processed table names to prevent duplicates

            if(oldSchema.length === 0){
                newSchema.forEach(function (item, _index) {
                    const tableName = item["__name"];

                    // Skip if we've already processed this table name
                    if(seenTableNames.has(tableName)){
                        console.warn(`Warning: Duplicate table definition detected for "${tableName}" - using first occurrence only`);
                        return;
                    }
                    seenTableNames.add(tableName);

                    const table = {
                        name: tableName,
                        new :item,
                        old : {},
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : [],
                        newIndexes : [],
                        deletedIndexes : [],
                        newCompositeIndexes : [],
                        deletedCompositeIndexes : [],
                        newSeedData : []
                    }
                    tables.push(table);
                });
            }
            else{
                newSchema.forEach(function (item, _index) {
                    const tableName = item["__name"];

                    // Skip if we've already processed this table name
                    if(seenTableNames.has(tableName)){
                        console.warn(`Warning: Duplicate table definition detected for "${tableName}" - using first occurrence only`);
                        return;
                    }
                    seenTableNames.add(tableName);

                    const table = {
                        name: tableName,
                        old: {},
                        new :item,
                        newColumns : [],
                        newTables : [],
                        deletedColumns : [],
                        updatedColumns : [],
                        newIndexes : [],
                        deletedIndexes : [],
                        newCompositeIndexes : [],
                        deletedCompositeIndexes : [],
                        newSeedData : []
                    }

                    oldSchema.forEach(function (oldItem, _index) {
                        const oldItemName = oldItem["__name"];
                        if(table.name === oldItemName){
                            table.old = oldItem;
                        }
                    });
                    tables.push(table);

                });
            }

            return tables;
    }

    #findDeletedColumns(tables){
            tables.forEach(function (item, _index) {
                let deletedColumn = null;
                if(item.new && item.old){
                    Object.keys(item.old).forEach(function (key) {
                        // Only real column objects carry a `.name`. Metadata keys
                        // like `__name` are plain strings; reading `.name` off them
                        // yields undefined, which used to be pushed as a phantom
                        // deleted column — making hasChanges() spuriously true and
                        // baking a malformed `addColumn({"tableName":"X"})` no-op
                        // into the generated migration's down(). Skip non-columns.
                        // (This guard mirrors #findNewColumns, which already had it.)
                        if(typeof item.old[key] !== "object" || item.old[key] === null){
                            return;
                        }
                        const value = item.old[key].name;
                        if(value === undefined || value === null || value === ''){
                            return;
                        }
                        deletedColumn = null;
                        Object.keys(item.new).forEach(function (newKey) {
                            if(typeof item.new[newKey] !== "object" || item.new[newKey] === null){
                                return;
                            }
                            const newValue = item.new[newKey].name;
                            if(value === newValue){
                                deletedColumn = value;
                            }
                        });
                        if(deletedColumn === null){
                            item.deletedColumns.push(value);
                        }
                    });
                }
            });
            return tables;
    }

    // Flag POSSIBLE column renames. Like EF Core, the differ does NOT silently
    // turn a drop+add into a rename — it cannot know whether `title` became
    // `headline` or `title` was dropped and an unrelated `headline` added, and
    // guessing wrong would move the old column's data under the new name. EF
    // scaffolds dropColumn + addColumn and tells you to review and change it to
    // RenameColumn; we do the same, but make the review easy: when exactly ONE
    // deleted column and ONE new column share an identical definition signature,
    // the generated migration carries an advisory comment with the exact
    // renameColumn(...) call to use instead (and add-migration prints a warning).
    #findRenamedColumns(tables){
        const columnByName = (schema, name) => {
            for (const key of Object.keys(schema || {})) {
                const c = schema[key];
                if (c && typeof c === 'object' && c.name === name) return c;
            }
            return null;
        };
        const signature = (c) => JSON.stringify({
            type: c.type, nullable: !!c.nullable, unique: !!c.unique,
            primary: !!c.primary, auto: !!c.auto,
            default: c.default === undefined ? null : c.default,
            relationshipType: c.relationshipType || null,
            foreignTable: c.foreignTable || null, foreignKey: c.foreignKey || null,
        });
        tables.forEach(function (item) {
            item.possibleRenames = item.possibleRenames || [];
            if (!item.deletedColumns || !item.newColumns) return;
            if (item.deletedColumns.length === 0 || item.newColumns.length === 0) return;
            if (item.newTables && item.newTables.length > 0) return;

            const bySigOld = new Map(), bySigNew = new Map();
            for (const name of item.deletedColumns) {
                const c = columnByName(item.old, name); if (!c) continue;
                const s = signature(c); if (!bySigOld.has(s)) bySigOld.set(s, []); bySigOld.get(s).push(name);
            }
            for (const name of item.newColumns) {
                const c = columnByName(item.new, name); if (!c) continue;
                const s = signature(c); if (!bySigNew.has(s)) bySigNew.set(s, []); bySigNew.get(s).push(name);
            }
            for (const [s, olds] of bySigOld) {
                const news = bySigNew.get(s);
                if (!news || olds.length !== 1 || news.length !== 1) continue;   // ambiguous -> no advisory
                item.possibleRenames.push({ from: olds[0], to: news[0] });
            }
            if (item.possibleRenames.length && process.env.MR_SILENT_MIGRATIONS !== 'true') {
                for (const r of item.possibleRenames) {
                    console.warn(
                        `[masterrecord:add-migration] ${item.name}: '${r.from}' was removed and '${r.to}' was added with the same definition. ` +
                        `If this is a RENAME, edit the generated migration: replace the dropColumn/addColumn pair with ` +
                        `await this.renameColumn({ tableName: '${item.name}', name: '${r.from}', newName: '${r.to}' }) ` +
                        `(drop + add would DESTROY the column's data).`
                    );
                }
            }
        });
        return tables;
    }

    #findUpdatedColumns(tables){


        tables.forEach(function (item, _index) {
           
            const UD = diff.updatedDiff(item.old, item.new);
            const isEmpty = Object.keys(UD).length === 0;
            if(!isEmpty){
                for (const key in UD) {
                    const tableChanges = {
                        changes : UD[key],
                        table : item.new[key],
                        tableName : item.name
                    };
                    item.updatedColumns.push(tableChanges);
                }
            }
           
        });
        return tables;
    }

    #findNewColumns(tables){
            tables.forEach(function (item, _index) {
                if(item.new && item.old){
                    Object.keys(item.new).forEach(function (key) {
                        if(typeof item.new[key] === "object"){
                            const value = item.new[key].name;
                            let columnNotFound = false;
                            Object.keys(item.old).forEach(function (oldKey) {
                                if(typeof item.old[oldKey] === "object"){
                                    const oldValue = item.old[oldKey].name;
                                    if(value === oldValue){
                                        columnNotFound = true;
                                    }
                                }
                            });

                            if(columnNotFound === false){
                                // this means it did not find the column
                                
                                if(item.new[key].type !== "hasOne" && item.new[key].type !== "hasMany" && item.new[key].type !== "hasManyThrough"){
                                    // if you have to create a new table no need to create the columns
                                    if(item.newTables.length === 0){
                                        item.newColumns.push(value);
                                    }
                                
                                }
                            }
                        }
                        
                    });
                }
                else{
                    console.log("Table object has no old or new values");
                }
            });
            return tables;
    }

    #findNewTables(tables){
        // find new tables 
        tables.forEach(function (item, _index) {
            if(item.new && item.old){
                    if(Object.keys(item.old).length === 0){
                        item.newTables.push(item);
                    }
            }else{
                console.log("Cannot find NEW or and Old Objects");
            }

        });
        return tables;
    }

    // build table to build new migration snapshot
    #buildMigrationObject(oldSchema, newSchema, newSeedData = {}){

        let tables = this.#organizeSchemaByTables(oldSchema, newSchema);

        tables = this.#findNewTables(tables);
        tables = this.#findNewColumns(tables);
        tables = this.#findDeletedColumns(tables);
        tables = this.#findRenamedColumns(tables);
        tables = this.#findUpdatedColumns(tables);
        tables = this.#findNewIndexes(tables);
        tables = this.#findDeletedIndexes(tables);
        tables = this.#findNewCompositeIndexes(tables);
        tables = this.#findDeletedCompositeIndexes(tables);
        tables = this.#findNewSeedData(tables, newSeedData);
        return tables;
    }

    #findNewIndexes(tables){
        tables.forEach(function (item, _index) {
            // Skip new tables — createTable() in schema.js already creates their indexes
            if(item.newTables && item.newTables.length > 0) return;

            if(item.new && item.old){
                Object.keys(item.new).forEach(function (key) {
                    if(typeof item.new[key] === "object" && item.new[key].indexes){
                        const columnName = item.new[key].name;
                        const newIndexes = item.new[key].indexes;

                        // Check if this column existed before
                        let oldColumn = null;
                        Object.keys(item.old).forEach(function (oldKey) {
                            if(typeof item.old[oldKey] === "object" && item.old[oldKey].name === columnName){
                                oldColumn = item.old[oldKey];
                            }
                        });

                        // If column didn't exist before, or didn't have indexes, all indexes are new
                        if(!oldColumn || !oldColumn.indexes){
                            newIndexes.forEach(function(indexName){
                                item.newIndexes.push({
                                    tableName: item.name,
                                    columnName: columnName,
                                    indexName: indexName
                                });
                            });
                        } else {
                            // Check for new indexes that weren't in the old column
                            newIndexes.forEach(function(indexName){
                                if(!oldColumn.indexes.includes(indexName)){
                                    item.newIndexes.push({
                                        tableName: item.name,
                                        columnName: columnName,
                                        indexName: indexName
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });
        return tables;
    }

    #findDeletedIndexes(tables){
        tables.forEach(function (item, _index) {
            if(item.new && item.old){
                Object.keys(item.old).forEach(function (key) {
                    if(typeof item.old[key] === "object" && item.old[key].indexes){
                        const columnName = item.old[key].name;
                        const oldIndexes = item.old[key].indexes;

                        // Check if this column still exists
                        let newColumn = null;
                        Object.keys(item.new).forEach(function (newKey) {
                            if(typeof item.new[newKey] === "object" && item.new[newKey].name === columnName){
                                newColumn = item.new[newKey];
                            }
                        });

                        // If column doesn't exist anymore, or doesn't have indexes, all indexes are deleted
                        if(!newColumn || !newColumn.indexes){
                            oldIndexes.forEach(function(indexName){
                                item.deletedIndexes.push({
                                    tableName: item.name,
                                    columnName: columnName,
                                    indexName: indexName
                                });
                            });
                        } else {
                            // Check for indexes that were removed
                            oldIndexes.forEach(function(indexName){
                                if(!newColumn.indexes.includes(indexName)){
                                    item.deletedIndexes.push({
                                        tableName: item.name,
                                        columnName: columnName,
                                        indexName: indexName
                                    });
                                }
                            });
                        }
                    }
                });
            }
        });
        return tables;
    }

    #findNewCompositeIndexes(tables) {
        tables.forEach(function (item, _index) {
            // Skip new tables — createTable() in schema.js already creates their composite indexes
            if(item.newTables && item.newTables.length > 0) return;

            if (item.new && item.old) {
                const newComposite = item.new.__compositeIndexes || [];
                const oldComposite = item.old.__compositeIndexes || [];

                newComposite.forEach(function(newIdx) {
                    const exists = oldComposite.some(oldIdx =>
                        oldIdx.name === newIdx.name
                    );

                    if (!exists) {
                        const info = {
                            tableName: item.name,
                            columns: newIdx.columns,
                            indexName: newIdx.name,
                            unique: newIdx.unique
                        };
                        if (newIdx.where) info.where = newIdx.where; // partial/filtered index
                        item.newCompositeIndexes.push(info);
                    }
                });
            }
        });
        return tables;
    }

    #findDeletedCompositeIndexes(tables) {
        tables.forEach(function (item, _index) {
            if (item.new && item.old) {
                const newComposite = item.new.__compositeIndexes || [];
                const oldComposite = item.old.__compositeIndexes || [];

                oldComposite.forEach(function(oldIdx) {
                    const exists = newComposite.some(newIdx =>
                        newIdx.name === oldIdx.name
                    );

                    if (!exists) {
                        item.deletedCompositeIndexes.push({
                            tableName: item.name,
                            columns: oldIdx.columns,
                            indexName: oldIdx.name,
                            unique: oldIdx.unique
                        });
                    }
                });
            }
        });
        return tables;
    }

    #findNewSeedData(tables, newSeedData) {
        // newSeedData is from schema snapshot: { tableName: [records] }
        tables.forEach(function(item) {
            const tableSeedData = newSeedData[item.name];
            if (tableSeedData && tableSeedData.length > 0) {
                item.newSeedData = tableSeedData;
            }
        });
        return tables;
    }



    findContextFile(executedLocation, contextFileName){
        const files = globSync(`**/*${contextFileName}.js`, {
            cwd: executedLocation,
            dot: true,
            windowsPathsNoEscape: true
        });
        const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
        return file;
    }

    async findContext(executedLocation, contextFileName){
        const files = globSync(`**/*${contextFileName}.js`, {
            cwd: executedLocation,
            dot: true,
            windowsPathsNoEscape: true
        });
        const file = files && files[0] ? path.resolve(executedLocation, files[0]) : null;
        if(!file){
            return null;
        }
        const mod = await import(pathToFileURL(file).href);
        const context = (mod && mod.default !== undefined) ? mod.default : mod;
        return {
            context : context,
            fileLocation : file
            }
    }

    // remove hasMany and hasOne and hasManyThrough
    cleanEntities(entities){
        const newEntity = [];
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const newObj = {}

            for (const key in entity) {
                if (Object.prototype.hasOwnProperty.call(entity, key)) {
              
                    if(entity[key].type !== "hasOne" && entity[key].type  !== "hasMany" && entity[key].type  !== "hasManyThrough"){
                        // if(entity[key].relationshipType == "belongsTo" ){
                        //     entity[key].name = entity[key].foreignKey;
                        // }
                        newObj[key] = entity[key];
                    }
                }
            }
            newEntity.push(newObj);
        }

        return newEntity;
    }

    // Produce a clean, snapshot-safe copy of the schema: shallow-copy each
    // entity and each column definition, dropping the transient `tableName`
    // key (attached at migration-build time). Functions on column defs
    // (transform/validators/get/set) are not JSON-serializable and are
    // already dropped by JSON.stringify, so omitting them here is harmless.
    #normalizeSchemaForSnapshot(entities){
        if (!Array.isArray(entities)) return entities;
        return entities.map((entity) => {
            if (!entity || typeof entity !== 'object') return entity;
            const cleanEntity = {};
            for (const key of Object.keys(entity)) {
                const value = entity[key];
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const { tableName, ...rest } = value; // drop transient tableName
                    void tableName;
                    cleanEntity[key] = rest;
                } else {
                    cleanEntity[key] = value;
                }
            }
            return cleanEntity;
        });
    }

    createSnapShot(snap){
        // Place migrations alongside the Context file by default:
        // <ContextDir>/db/migrations/<context>_contextSnapShot.json
        // BUT: if the context file is already inside db/migrations, use that directly
        // Uses shared utility to prevent duplicate db/migrations in path
        const migrationsDirectory = resolveMigrationsDirectory(snap.file);

        // Ensure migrations directory exists
        if (!fs.existsSync(migrationsDirectory)){
            fs.mkdirSync(migrationsDirectory, { recursive: true });
        }

        const snapshotPath = path.join(migrationsDirectory, `${snap.contextFileName}_contextSnapShot.json`);

        // Store relative paths (portable): values are relative to the snapshot file
        // directory (migrationsDirectory). path.relative() emits backslashes on
        // Windows, which are literal characters on POSIX — normalize to forward
        // slashes so a snapshot generated on Windows deploys cleanly on Linux.
        // (migrationFolder is the literal '.' and snapShotLocation a basename, so
        // neither can carry a separator today.)
        const relContextLocation = toPosixPath(path.relative(migrationsDirectory, snap.file));
        const relMigrationFolder = '.'; // the snapshot sits inside migrationsDirectory
        const relSnapshotLocation = path.basename(snapshotPath);

        // Order seed data by dependencies if context instance is available
        const orderedSeedData = snap.context && snap.context.getOrderedSeedData
            ? snap.context.getOrderedSeedData()
            : snap.contextSeedData || {};

        // Normalize the schema before serializing so the snapshot is
        // DETERMINISTIC: strip the transient `tableName` field that the
        // migration builder may have attached to column objects. It is not
        // part of the schema definition (a column's table is implied by its
        // parent entity's __name), and leaking it produced run-to-run diffs.
        const normalizedSchema = this.#normalizeSchemaForSnapshot(snap.contextEntities);

        const content = {
            contextLocation: relContextLocation,
            migrationFolder: relMigrationFolder,
            snapShotLocation: relSnapshotLocation,
            schema : normalizedSchema,
            seedData: orderedSeedData,
            seedConfig: snap.contextSeedConfig || {},
            // EF 11: the latest migration id is recorded in the snapshot so two
            // branches that each add a migration conflict on merge (surfacing a
            // divergent migration tree) instead of silently diverging.
            latestMigration: snap.latestMigration || null
        };

        const jsonContent = JSON.stringify(content, null, 2);
        try{
            fs.writeFileSync(snapshotPath, jsonContent);
            console.log(`✓ Snapshot created at: ${snapshotPath}`);
        }catch (e){
            console.log("Cannot write file ", e);
            throw e;
        }
    }

    // validate if schema has changed based on new and old
    buildUpObject(oldSchema, newSchema){
        const tableObj = {}
        const tables = this.#buildMigrationObject(oldSchema, newSchema);

        tables.forEach(function (item, index) {
                    // add new columns for table
                    const columnInfo = tables[index];
                    // Always expose each table under its name so templates like
                    // this.createTable(table.TableName) can safely access it.
                    tableObj[item.name] = columnInfo.new;
                    
                    item.newTables.forEach(function (_column, _ind) {
                        tableObj[item.name] = columnInfo.new;
                    });

                    // NOTE: `tableName` is a transient field the migration
                    // template/query-builder needs to know which table a
                    // column belongs to. It must be attached to a COPY — the
                    // source column objects are shared (cleanEntities shallow-
                    // copies them) with the schema that gets serialized into
                    // the snapshot. Mutating them in place leaked `tableName`
                    // into the snapshot non-deterministically (only on the
                    // columns that happened to change that run), producing
                    // noisy diffs and spurious "schema changed" detections.
                    item.newColumns.forEach(function (column, _ind) {
                        tableObj[column] = { ...columnInfo.new[column], tableName: item.name };
                    });

                    item.deletedColumns.forEach(function (column, _ind) {
                        tableObj[column] = { ...columnInfo.old[column], tableName: item.name };
                    });

                    item.updatedColumns.forEach(function (column, _ind) {
                        tableObj[column.table.name] = column;
                    });

                    if(item.new === null){
                        tableObj["new"] = { ...columnInfo.old, tableName: item.name };
                    }
                
                    tableObj.___table = item;
                });
        return tableObj;
    }

    // Returns true if there are any changes between old and new schema
    hasChanges(oldSchema, newSchema, newSeedData = {}){
        const tables = this.#buildMigrationObject(oldSchema, newSchema, newSeedData);
        for(const t of tables){
            if(!t) continue;
            if((t.newTables && t.newTables.length) ||
               (t.newColumns && t.newColumns.length) ||
               (t.deletedColumns && t.deletedColumns.length) ||
               (t.updatedColumns && t.updatedColumns.length) ||
               (t.newIndexes && t.newIndexes.length) ||
               (t.deletedIndexes && t.deletedIndexes.length) ||
               (t.newCompositeIndexes && t.newCompositeIndexes.length) ||
               (t.deletedCompositeIndexes && t.deletedCompositeIndexes.length) ||
               (t.newSeedData && t.newSeedData.length) ||
               (t.old === null) || (t.new === null)){
                return true;
            }
        }
        return false;
    }

    // Resolve a column's full, JSON-safe definition (for baking a
    // self-contained add/drop into a generated migration). Looks the column
    // up by its DB name (or belongsTo foreignKey) in the entity and copies
    // the DDL-relevant fields plus an explicit tableName. Functions
    // (transform/validators/get/set) are intentionally omitted — they aren't
    // needed for DDL and aren't serializable.
    #columnLiteral(entity, columnName, tableName){
        let def = null;
        for (const key of Object.keys(entity || {})) {
            const d = entity[key];
            if (d && typeof d === 'object') {
                if (d.name === columnName) { def = d; break; }
                if (d.relationshipType === 'belongsTo' && d.foreignKey === columnName) { def = d; break; }
            }
        }
        if (!def) {
            // Should not happen for a detected column; keep minimal + let the
            // schema layer's loud guard catch any incompleteness at apply time.
            return { tableName, name: columnName };
        }
        const spec = { tableName, name: def.name, type: def.type };
        for (const k of ['nullable', 'default', 'unique', 'auto', 'primary', 'typeSize', 'relationshipType', 'foreignKey', 'foreignTable']) {
            if (def[k] !== undefined && def[k] !== null) spec[k] = def[k];
        }
        return spec;
    }

    template(name, oldSchema, newSchema, newSeedData = {}, seedConfig = {}, currentEnv = null){
        const MT = new MigrationTemplate(name);
        // Determine current environment if not provided
        if (!currentEnv) {
            currentEnv = process.env.NODE_ENV || process.env.master || 'development';
        }
        const tables = this.#buildMigrationObject(oldSchema, newSchema, newSeedData);
        const self = this;

        tables.forEach(function (item, _index) {
            // (Whole-table create/drop is handled below via item.newTables /
            //  item.deletedColumns. The previous `if (item.old === null)` /
            //  `if (item.new === null)` branches here referenced an undefined
            //  `column` and never ran — old/new are always {} or an object,
            //  never null — so they were dead, broken code and were removed.)

            item.newTables.forEach(function (_column, _ind) {
                MT.createTable("up", item.name);
                MT.dropTable("down", item.name);
            });

            // Possible renames: like EF, emit drop + add (below) but flag the
            // likely rename in the migration so the developer can swap in the
            // data-preserving renameColumn call before applying.
            (item.possibleRenames || []).forEach(function (r) {
                MT.renameAdvisory("up",   { tableName: item.name, name: r.from, newName: r.to });
                MT.renameAdvisory("down", { tableName: item.name, name: r.to,   newName: r.from });
            });

            // Add new columns. Bake the FULL column spec into the generated
            // migration (self-contained) instead of `table.<col>`, which was
            // re-derived from a live snapshot↔entities diff at apply time and
            // silently no-op'd on any database whose diff was empty (snapshot
            // already advanced by the first DB migrated).
            item.newColumns.forEach(function (column, _index) {
                const spec = self.#columnLiteral(item.new, column, item.name);
                MT.addColumn("up", spec);
                MT.dropColumn("down", spec);
            });

            item.deletedColumns.forEach(function (column, _index) {
                const spec = self.#columnLiteral(item.old, column, item.name);
                MT.dropColumn("up", spec);
                MT.addColumn("down", spec);
            });

            item.updatedColumns.forEach(function (column, _index) {
                const isEmpty = Object.keys(column).length === 0;
                if(!isEmpty){
                    const name = column.table && column.table.name;
                    if(!name){ return; }
                    // up applies the NEW definition, down restores the OLD one (EF's Down
                    // reverts the change rather than re-applying it).
                    MT.alterColumn("up", self.#columnLiteral(item.new, name, item.name));
                    const revert = item.old && item.old[name] ? self.#columnLiteral(item.old, name, item.name) : null;
                    MT.alterColumn("down", revert);
                }
            });

            item.newIndexes.forEach(function (indexInfo, _index) {
                MT.createIndex("up", indexInfo);
            });

            item.deletedIndexes.forEach(function (indexInfo, _index) {
                MT.dropIndex("up", indexInfo);
            });

            item.newCompositeIndexes.forEach(function (indexInfo, _index) {
                MT.createCompositeIndex("up", indexInfo);
            });

            item.deletedCompositeIndexes.forEach(function (indexInfo, _index) {
                MT.dropCompositeIndex("up", indexInfo);
            });

            // Generate seed data code
            if (item.newSeedData && item.newSeedData.length > 0) {
                MT.seedData("up", item.name, item.newSeedData, currentEnv);
                MT.seedDataDown("down", item.name, item.newSeedData, seedConfig);
            }

        });

       return MT.get();
    }

}

export default Migrations;