/**
 * Path utilities for MasterRecord migrations
 * Handles path resolution to prevent duplicate db/migrations in paths
 */

import path from 'node:path';

/**
 * Resolve migrations directory, avoiding duplicate db/migrations paths
 *
 * If the context file is already inside a db/migrations folder structure,
 * returns that directory. Otherwise, appends db/migrations to the context directory.
 *
 * This prevents the bug where:
 * /components/qa/app/models/db/migrations/qaContext.js
 * becomes:
 * /components/qa/app/models/db/migrations/db/migrations/qacontext_contextSnapShot.json
 *
 * @param {string} contextFilePath - Absolute path to the context file
 * @returns {string} Absolute path to the migrations directory
 *
 * @example
 * // Context already in migrations folder
 * resolveMigrationsDirectory('/app/models/db/migrations/Context.js')
 * // Returns: /app/models/db/migrations
 *
 * @example
 * // Context NOT in migrations folder
 * resolveMigrationsDirectory('/app/models/Context.js')
 * // Returns: /app/models/db/migrations
 */
function resolveMigrationsDirectory(contextFilePath) {
    const contextDir = path.dirname(contextFilePath);
    const contextDirNormalized = contextDir.split(path.sep).join('/');

    // Check if context is already inside a db/migrations folder
    const alreadyInMigrations = contextDirNormalized.includes('/db/migrations') ||
                                contextDirNormalized.includes('\\db\\migrations');

    if (alreadyInMigrations) {
        // Context is already in db/migrations - find and use that directory
        let currentDir = contextDir;
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const dirName = path.basename(currentDir);
            const parentName = path.basename(path.dirname(currentDir));

            if (dirName === 'migrations' && parentName === 'db') {
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }

        // Fallback if we couldn't find it (shouldn't happen)
        console.warn(`[pathUtils] Warning: Context is in a path containing 'db/migrations' but couldn't locate exact directory. Using context directory: ${contextDir}`);
        return contextDir;
    } else {
        // Context is NOT in db/migrations - return standard path
        return path.join(contextDir, 'db', 'migrations');
    }
}

/**
 * Check if a path is already inside a db/migrations directory structure
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if path contains db/migrations
 */
function isInMigrationsDirectory(filePath) {
    const normalized = filePath.split(path.sep).join('/');
    return normalized.includes('/db/migrations') || normalized.includes('\\db\\migrations');
}

export { resolveMigrationsDirectory, isInMigrationsDirectory };
