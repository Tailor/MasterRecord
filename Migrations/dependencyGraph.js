/**
 * Dependency graph for topological sorting of seed data
 * Uses Kahn's algorithm to order tables by foreign key dependencies
 */
class DependencyGraph {
    constructor(entities) {
        this.entities = entities;
        this.graph = new Map();    // adjacency list: parent -> [children]
        this.inDegree = new Map(); // in-degree for each table (number of dependencies)
    }

    /**
     * Build dependency graph from entity relationships
     * Tables with belongsTo relationships depend on their foreign tables
     */
    buildFromEntities() {
        // Initialize graph structure for all entities
        this.entities.forEach(entity => {
            const tableName = entity.__name;
            if (!tableName) return;

            this.graph.set(tableName, []);
            this.inDegree.set(tableName, 0);
        });

        // Build edges from belongsTo relationships
        this.entities.forEach(entity => {
            const tableName = entity.__name;
            if (!tableName) return;

            // Find belongsTo relationships (dependencies)
            Object.keys(entity).forEach(key => {
                const field = entity[key];

                // Check if this is a belongsTo relationship with a foreign table
                if (field && typeof field === 'object' &&
                    field.relationshipType === 'belongsTo' &&
                    field.foreignTable) {

                    const foreignTable = field.foreignTable;

                    // Ensure foreign table exists in graph
                    if (!this.graph.has(foreignTable)) {
                        this.graph.set(foreignTable, []);
                        this.inDegree.set(foreignTable, 0);
                    }

                    // Add edge: foreignTable -> tableName (tableName depends on foreignTable)
                    this.graph.get(foreignTable).push(tableName);
                    this.inDegree.set(tableName, this.inDegree.get(tableName) + 1);
                }
            });
        });
    }

    /**
     * Perform topological sort using Kahn's algorithm
     * @returns {Array<string>} Ordered list of table names
     * @throws {Error} If circular dependency detected
     */
    topologicalSort() {
        const result = [];
        const queue = [];
        const inDegreeCopy = new Map(this.inDegree);

        // Start with nodes that have no dependencies (in-degree = 0)
        for (const [node, degree] of inDegreeCopy.entries()) {
            if (degree === 0) {
                queue.push(node);
            }
        }

        while (queue.length > 0) {
            const current = queue.shift();
            result.push(current);

            // Process all neighbors (tables that depend on current)
            const neighbors = this.graph.get(current) || [];
            neighbors.forEach(neighbor => {
                inDegreeCopy.set(neighbor, inDegreeCopy.get(neighbor) - 1);
                if (inDegreeCopy.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            });
        }

        // Detect cycles: if we couldn't visit all nodes, there's a cycle
        if (result.length !== this.inDegree.size) {
            const unvisited = Array.from(this.inDegree.keys()).filter(k => !result.includes(k));
            throw new Error(`Circular dependency detected in tables: ${unvisited.join(' <-> ')}`);
        }

        return result;
    }

    /**
     * Get topologically sorted list filtered to only tables with seed data
     * @param {Object} seedData - Object with table names as keys
     * @returns {Array<string>} Ordered list of table names that have seed data
     */
    filterToSeededTables(seedData) {
        const sorted = this.topologicalSort();
        const seededTables = Object.keys(seedData);
        return sorted.filter(table => seededTables.includes(table));
    }
}

module.exports = DependencyGraph;
