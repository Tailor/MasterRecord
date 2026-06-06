// https://channel9.msdn.com/Blogs/EF/Migrations-Under-the-Hood
// version 0.0.4

import os from 'node:os';

class MigrationTemplate {

    constructor(name) {
        this.name = name;
    }

    #up = ''
    #down = ''

    /**
     * Render the migration file source (ESM only).
     */
    get(){
        return `import masterrecord from 'masterrecord';

class ${this.name} extends masterrecord.schema {
    constructor(context){
        super(context);
    }

    async up(table){
        await this.init(table);
        ${this.#up}
    }

    async down(table){
        await this.init(table);
        ${this.#down}
    }
}
export default ${this.name};
`;
    }

    alterColumn(type, name, _parent){
        if(type === "up"){
            this.#up += os.EOL + `     await this.alterColumn(table.${name});`
        }
        else{
            this.#down += os.EOL + `     await this.alterColumn(table.${name});`
        }
    }
    createTable(type, name){
        if(type === "up"){
            this.#up += os.EOL + `     await this.createTable(table.${name});`
        }
        else{
            this.#down += os.EOL + `     await this.createTable(table.${name});`
        }
    }

    // Bake the resolved column spec inline so the migration is self-contained
    // and replays deterministically on every database — independent of the
    // committed snapshot's state at apply time. (Previously emitted
    // `table.<col>`, re-derived from a live diff, which silently no-op'd when
    // the snapshot was already ahead of the target DB.)
    addColumn(type, spec){
        const stmt = `     await this.addColumn(${JSON.stringify(spec)});`;
        if(type === "up"){ this.#up += os.EOL + stmt; }
        else{ this.#down += os.EOL + stmt; }
    }

    dropTable(type, name){
        if(type === "up"){
            this.#down += os.EOL + `    await this.dropTable(table.${name});`
        }
        else{
            this.#down += os.EOL + `    await this.dropTable(table.${name});`
        }
    }

    dropColumn(type, spec){
        const stmt = `     await this.dropColumn(${JSON.stringify(spec)});`;
        if(type === "up"){ this.#up += os.EOL + stmt; }
        else{ this.#down += os.EOL + stmt; }
    }

    createIndex(type, indexInfo){
        const _indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;

        const indexInfoStr = JSON.stringify({
            tableName: indexInfo.tableName,
            columnName: indexInfo.columnName,
            indexName: indexInfo.indexName
        });

        if(type === "up"){
            this.#up += os.EOL + `     await this.createIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     await this.dropIndex(${indexInfoStr});`
        }
    }

    dropIndex(type, indexInfo){
        const _indexName = indexInfo.indexName === true
            ? `idx_${indexInfo.tableName.toLowerCase()}_${indexInfo.columnName.toLowerCase()}`
            : indexInfo.indexName;

        const indexInfoStr = JSON.stringify({
            tableName: indexInfo.tableName,
            columnName: indexInfo.columnName,
            indexName: indexInfo.indexName
        });

        if(type === "up"){
            this.#up += os.EOL + `     await this.dropIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     await this.createIndex(${indexInfoStr});`
        }
    }

    createCompositeIndex(type, indexInfo){
        const baked = {
            tableName: indexInfo.tableName,
            columns: indexInfo.columns,
            indexName: indexInfo.indexName,
            unique: indexInfo.unique
        };
        if (indexInfo.where) baked.where = indexInfo.where; // partial/filtered index
        const indexInfoStr = JSON.stringify(baked);

        if(type === "up"){
            this.#up += os.EOL + `     await this.createCompositeIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     await this.dropCompositeIndex(${indexInfoStr});`
        }
    }

    dropCompositeIndex(type, indexInfo){
        const indexInfoStr = JSON.stringify({
            tableName: indexInfo.tableName,
            columns: indexInfo.columns,
            indexName: indexInfo.indexName,
            unique: indexInfo.unique
        });

        if(type === "up"){
            this.#up += os.EOL + `     await this.dropCompositeIndex(${indexInfoStr});`
        }
        else{
            this.#down += os.EOL + `     await this.createCompositeIndex(${indexInfoStr});`
        }
    }

    seedData(type, tableName, records, currentEnv = 'development'){
        if(!records || records.length === 0) return;

        if(type === "up"){
            // Filter records by environment first
            const filteredRecords = records.filter(record => {
                const envCondition = record.__seedEnv;
                if (envCondition && envCondition.strategy === 'generation-time') {
                    return envCondition.conditions.includes(currentEnv);
                }
                return true; // No environment condition, include record
            });

            if (filteredRecords.length === 0) return;

            // Check if all records are factory-generated
            const allGenerated = filteredRecords.every(r => r.__seedMeta?.generated);

            // Use optimized loop syntax for bulk factory data (10+ records)
            if (allGenerated && filteredRecords.length >= 10) {
                this.#up += os.EOL + `     const factoryRecords = [`;

                filteredRecords.forEach((record, i) => {
                    const cleanRecord = { ...record };
                    delete cleanRecord.__rollback;
                    delete cleanRecord.__seedEnv;
                    delete cleanRecord.__seedStrategy;
                    delete cleanRecord.__seedMeta;

                    const recordStr = JSON.stringify(cleanRecord);
                    this.#up += os.EOL + `         ${recordStr}${i < filteredRecords.length - 1 ? ',' : ''}`;
                });

                this.#up += os.EOL + `     ];`;
                this.#up += os.EOL + `     for (const record of factoryRecords) {`;
                this.#up += os.EOL + `         await this.seed('${tableName}', record);`;
                this.#up += os.EOL + `     }`;
            } else {
                // Standard individual inserts for non-factory or small batches
                filteredRecords.forEach(record => {
                    const strategy = record.__seedStrategy;

                    // Clean up metadata before generating migration code
                    const cleanRecord = { ...record };
                    delete cleanRecord.__rollback;
                    delete cleanRecord.__seedEnv;
                    delete cleanRecord.__seedStrategy;
                    delete cleanRecord.__seedMeta;

                    // Handle upsert strategy
                    if (strategy && strategy.type === 'upsert') {
                        this._generateUpsert(tableName, cleanRecord, strategy);
                    } else {
                        // Standard insert
                        const recordStr = JSON.stringify(cleanRecord);

                        // Check if record is too long for single line (> 80 chars)
                        if (recordStr.length > 80) {
                            // Multi-line format with proper indentation
                            const formattedRecord = JSON.stringify(cleanRecord, null, 12)
                                .split('\n')
                                .join(os.EOL + '            ');
                            this.#up += os.EOL + `     await this.seed('${tableName}', ${formattedRecord});`;
                        } else {
                            // Single-line format
                            this.#up += os.EOL + `     await this.seed('${tableName}', ${recordStr});`;
                        }
                    }
                });
            }
        }
    }

    _generateUpsert(tableName, cleanRecord, strategy) {
        const conflictKey = strategy.conflictKey === 'primaryKey'
            ? (cleanRecord.id !== undefined ? 'id' : Object.keys(cleanRecord)[0])
            : strategy.conflictKey;

        const conflictValue = cleanRecord[conflictKey];
        if (conflictValue === undefined) {
            throw new Error(`Upsert requires a value for conflict key: ${conflictKey}`);
        }

        this.#up += os.EOL + `     {`;
        this.#up += os.EOL + `         const existing = await this.context.${tableName}.where(r => r.${conflictKey} == ${JSON.stringify(conflictValue)}).single();`;
        this.#up += os.EOL + `         if (existing) {`;

        // Update logic
        if (strategy.updateFields && Array.isArray(strategy.updateFields)) {
            strategy.updateFields.forEach(field => {
                if (cleanRecord[field] !== undefined) {
                    this.#up += os.EOL + `             existing.${field} = ${JSON.stringify(cleanRecord[field])};`;
                }
            });
        } else {
            // Update all fields except conflict key
            Object.keys(cleanRecord).forEach(field => {
                if (field !== conflictKey) {
                    this.#up += os.EOL + `             existing.${field} = ${JSON.stringify(cleanRecord[field])};`;
                }
            });
        }

        this.#up += os.EOL + `             await existing.save();`;
        this.#up += os.EOL + `         } else {`;
        this.#up += os.EOL + `             await this.seed('${tableName}', ${JSON.stringify(cleanRecord)});`;
        this.#up += os.EOL + `         }`;
        this.#up += os.EOL + `     }`;
    }

    seedDataDown(type, tableName, records, config){
        if(type !== "down" || !config || !config.generateDownMigrations) return;
        if(!records || records.length === 0) return;

        // Reverse order for safe FK deletion (children before parents)
        const reversed = [...records].reverse();

        reversed.forEach(record => {
            const rollback = record.__rollback;
            if (!rollback || !rollback.value) {
                // Skip if no rollback metadata (e.g., no primary key specified)
                return;
            }

            const pkValue = rollback.value;
            const _pkKey = rollback.key || 'id';

            // Generate delete code with error handling
            this.#down += os.EOL + `     try {`;
            this.#down += os.EOL + `         const record = await table.${tableName}.findById(${JSON.stringify(pkValue)});`;
            this.#down += os.EOL + `         if (record) await record.delete();`;
            this.#down += os.EOL + `     } catch (e) {`;

            if (config.onRollbackError === 'throw') {
                this.#down += os.EOL + `         throw new Error('Seed rollback failed: ${tableName} id=${pkValue} - ' + e.message);`;
            } else if (config.onRollbackError === 'warn') {
                this.#down += os.EOL + `         console.warn('Seed rollback: ${tableName} id=${pkValue} not found or error:', e.message);`;
            }
            // else ignore (onRollbackError === 'ignore')

            this.#down += os.EOL + `     }`;
        });
    }

}

export default MigrationTemplate;

