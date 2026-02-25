/**
 * MasterRecord Context - Fortune 500 Production-Grade ORM
 *
 * Enterprise-level database context with:
 * - Multi-database support (PostgreSQL, MySQL, SQLite)
 * - Query result caching with automatic invalidation
 * - Entity tracking and change detection
 * - Transaction management
 * - Batch operations for performance
 * - Security hardening (SQL injection prevention, input validation)
 *
 * @version 1.1.0
 * @license MIT
 */

'use strict';

// Core dependencies
const modelBuilder = require('./Entity/entityModelBuilder');
const query = require('masterrecord/QueryLanguage/queryMethods');
const tools = require('./Tools');
const SQLLiteEngine = require('masterrecord/SQLLiteEngine');
const MySQLEngine = require('masterrecord/mySQLEngine');
const PostgresEngine = require('masterrecord/postgresEngine');
const insertManager = require('./insertManager');
const deleteManager = require('./deleteManager');
const globSearch = require('glob');
const fs = require('fs');
const path = require('path');
const appRoot = require('app-root-path');
const MySQLAsyncClient = require('masterrecord/mySQLConnect');
const PostgresClient = require('masterrecord/postgresSyncConnect');
const QueryCache = require('./Cache/QueryCache');

// ============================================================================
// GLOBAL POOL REGISTRY - One pool per database, shared across all contexts
// ============================================================================

const _pools = global.__MR_POOLS__ || (global.__MR_POOLS__ = new Map());

function _poolKey(type, cfg) {
    if (type === 'sqlite') return `sqlite:${cfg.completeConnection || cfg.connection}`;
    const host = cfg.host || 'localhost';
    const port = cfg.port || (type === 'mysql' ? 3306 : 5432);
    return `${type}:${cfg.user}@${host}:${port}/${cfg.database}`;
}

// ============================================================================
// CONSTANTS - Extract all magic numbers for maintainability
// ============================================================================

/**
 * Maximum number of directory hops when searching for config files
 * Prevents infinite loops and excessive filesystem traversal
 */
const MAX_CONFIG_SEARCH_HOPS = 12;

/**
 * Default query cache TTL in milliseconds (5 seconds - request-scoped)
 */
const DEFAULT_CACHE_TTL_MS = 5000;

/**
 * Default maximum cache size (number of entries)
 */
const DEFAULT_CACHE_MAX_SIZE = 1000;

/**
 * Table name validation regex - prevents SQL injection
 * Allows: letters, numbers, underscores. Must start with letter or underscore.
 */
const TABLE_NAME_VALIDATION_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Supported database types
 */
const DB_TYPES = {
    SQLITE: 'sqlite',
    BETTER_SQLITE3: 'better-sqlite3',
    MYSQL: 'mysql',
    POSTGRES: 'postgres',
    POSTGRESQL: 'postgresql'
};

/**
 * Default database ports
 */
const DEFAULT_PORTS = {
    MYSQL: 3306,
    POSTGRES: 5432
};

// ============================================================================
// CUSTOM ERROR CLASSES - Professional error handling
// ============================================================================

/**
 * Base error class for MasterRecord context errors
 */
class ContextError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = this.constructor.name;
        this.context = context;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Configuration/environment file errors
 */
class ConfigurationError extends ContextError {
    constructor(message, context = {}) {
        super(message, context);
    }
}

/**
 * Database connection errors
 */
class DatabaseConnectionError extends ContextError {
    constructor(message, dbType, context = {}) {
        super(message, { ...context, dbType });
    }
}

/**
 * Entity validation errors
 */
class EntityValidationError extends ContextError {
    constructor(message, entityName, context = {}) {
        super(message, { ...context, entityName });
    }
}

/**
 * MasterRecord Database Context
 *
 * Manages database connections, entity registration, change tracking, and query caching.
 * Supports PostgreSQL, MySQL, and SQLite with a unified API.
 *
 * @class context
 * @example
 * class AppContext extends context {
 *     constructor() {
 *         super();
 *         this.env({ type: 'postgres', host: 'localhost', database: 'myapp' });
 *         this.dbset(User);
 *         this.dbset(Post);
 *     }
 * }
 */
class context {
    // Model validation state
    _isModelValid = {
        isValid: true,
        errors: []
    };

    // Entity collections
    __entities = [];
    __builderEntities = [];
    __trackedEntities = [];
    __trackedEntitiesMap = new Map();  // Performance: O(1) entity lookup instead of O(n) linear search
    __relationshipModels = [];
    __contextSeedData = {};  // Store seed data by table name
    __contextSeedConfig = {  // Seed data configuration
        generateDownMigrations: false,
        downStrategy: 'delete',
        deleteByPrimaryKey: true,
        onRollbackError: 'warn',
        detectCircularDependencies: true,
        circularStrategy: 'warn',
        defaultStrategy: 'insert'  // 'insert' | 'upsert'
    };

    // Configuration
    __environment = '';
    __name = '';
    tablePrefix = '';

    // Database type flags
    isSQLite = false;
    isMySQL = false;
    isPostgres = false;

    // Static shared cache - all context instances share the same cache
    static _sharedQueryCache = null;

    // Sequential ID counter for collision-safe entity tracking
    static _nextEntityId = 1;

    // Global model registry - tracks registered models per context class
    // Structure: { 'userContext': Set(['User', 'Auth', 'Settings']), 'qaContext': Set([...]) }
    // Purpose: Prevents duplicate warnings when CLI instantiates same context multiple times
    static _globalModelRegistry = {};

    /**
     * Creates a new database context instance
     *
     * @constructor
     */
    constructor() {
        // Set environment from process.env.master or default
        this.__environment = process.env.master || '';
        this.__name = this.constructor.name;
        this._SQLEngine = null;  // Will be set during database initialization
        this.__trackedEntitiesMap = new Map();  // Initialize Map for O(1) lookups

        // Track if this is the first instance of this context class
        // Used to determine if duplicate warnings should be shown
        const globalRegistry = context._globalModelRegistry[this.__name];
        this.__isFirstInstance = !globalRegistry || globalRegistry.size === 0;

        // Initialize global model registry for this context class if not exists
        // This prevents duplicate warnings when CLI instantiates the same context multiple times
        if (!context._globalModelRegistry[this.__name]) {
            context._globalModelRegistry[this.__name] = new Set();
        }

        // Initialize shared query cache (only once across all instances)
        if (!context._sharedQueryCache) {
            const cacheConfig = {
                ttl: this._parseIntegerEnv('QUERY_CACHE_TTL', DEFAULT_CACHE_TTL_MS),
                maxSize: this._parseIntegerEnv('QUERY_CACHE_SIZE', DEFAULT_CACHE_MAX_SIZE),
                enabled: process.env.QUERY_CACHE_ENABLED !== 'false'
            };

            context._sharedQueryCache = new QueryCache(cacheConfig);
        }

        // Reference the shared cache
        this._queryCache = context._sharedQueryCache;
    }

    /**
     * Parse integer environment variable with validation
     *
     * @private
     * @param {string} key - Environment variable name
     * @param {number} defaultValue - Default value if not set or invalid
     * @returns {number} Parsed integer or default
     */
    _parseIntegerEnv(key, defaultValue) {
        const value = process.env[key];
        if (!value) return defaultValue;

        const parsed = parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
    }

    /**
     * Initialize SQLite database connection
     *
     * Expected configuration model:
     * {
     *     "type": "better-sqlite3",
     *     "connection": "/db/mydb.sqlite",  // or "/db/" (auto-creates <contextname>.sqlite)
     *     "password": "",
     *     "username": ""
     * }
     *
     * @private
     * @param {object} env - SQLite configuration object
     * @param {string} sqlName - SQLite driver name (e.g., 'better-sqlite3')
     * @returns {object} SQLite database instance
     * @throws {DatabaseConnectionError} If connection fails
     */
    __SQLiteInit(env, sqlName) {
        try {
            const sqlite3 = require(sqlName);
            const dbAddress = env.completeConnection;

            // Validate database path
            if (!dbAddress || typeof dbAddress !== 'string') {
                throw new DatabaseConnectionError(
                    'SQLite connection path is required and must be a string',
                    DB_TYPES.SQLITE,
                    { sqlName, providedConnection: env.connection }
                );
            }

            // Create database connection with validated path
            const db = new sqlite3(dbAddress, env);
            db.__name = sqlName;
            this._SQLEngine = new SQLLiteEngine();

            return db;
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors with context
            throw new DatabaseConnectionError(
                `Failed to initialize SQLite database: ${error.message}`,
                DB_TYPES.SQLITE,
                {
                    sqlName,
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }

    /**
     * Initialize MySQL database connection
     *
     * Expected configuration model:
     * {
     *     "type": "mysql",
     *     "host": "localhost",
     *     "user": "me",
     *     "password": "secret",
     *     "database": "my_db"
     * }
     *
     * @private
     * @param {object} env - MySQL configuration object
     * @param {string} sqlName - MySQL driver name (e.g., 'mysql2')
     * @returns {object} MySQL connection instance
     * @throws {DatabaseConnectionError} If connection fails
     */
    async __mysqlInit(env, sqlName) {
        try {
            // Validate required MySQL configuration
            if (!env.database || typeof env.database !== 'string') {
                throw new DatabaseConnectionError(
                    'MySQL database name is required',
                    DB_TYPES.MYSQL,
                    { providedConfig: env }
                );
            }

            if (!env.user || typeof env.user !== 'string') {
                throw new DatabaseConnectionError(
                    'MySQL user is required',
                    DB_TYPES.MYSQL,
                    { database: env.database }
                );
            }

            const key = _poolKey('mysql', env);
            if (_pools.has(key)) {
                const cached = _pools.get(key);
                cached.refCount++;
                this._SQLEngine = cached.engine;
                this.isMySQL = true;
                console.log(`[MySQL] Reusing pool for ${env.database} (refs: ${cached.refCount})`);
                return cached.client;
            }

            console.log('[MySQL] Initializing async connection pool...');
            const client = new MySQLAsyncClient(env);
            await client.connect();

            const pool = client.getPool();
            this._SQLEngine = new MySQLEngine();
            this._SQLEngine.setDB(pool);
            this._SQLEngine.__name = sqlName;
            this.isMySQL = true;

            _pools.set(key, { client, engine: this._SQLEngine, refCount: 1, dbType: 'mysql' });
            console.log('[MySQL] Connection pool ready');
            return client;
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors with context
            throw new DatabaseConnectionError(
                `Failed to initialize MySQL database: ${error.message}`,
                DB_TYPES.MYSQL,
                {
                    sqlName,
                    host: env.host,
                    database: env.database,
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }

    /**
     * Initialize PostgreSQL database connection (async)
     *
     * Expected configuration model:
     * {
     *     "type": "postgres",
     *     "host": "localhost",
     *     "port": 5432,
     *     "user": "me",
     *     "password": "secret",
     *     "database": "my_db"
     * }
     *
     * @private
     * @async
     * @param {object} env - PostgreSQL configuration object
     * @param {string} sqlName - PostgreSQL driver name (e.g., 'pg')
     * @returns {Promise<object>} PostgreSQL connection pool
     * @throws {DatabaseConnectionError} If connection fails
     */
    async __postgresInit(env, sqlName) {
        try {
            // Validate required PostgreSQL configuration
            if (!env.database || typeof env.database !== 'string') {
                throw new DatabaseConnectionError(
                    'PostgreSQL database name is required',
                    DB_TYPES.POSTGRES,
                    { providedConfig: env }
                );
            }

            if (!env.user || typeof env.user !== 'string') {
                throw new DatabaseConnectionError(
                    'PostgreSQL user is required',
                    DB_TYPES.POSTGRES,
                    { database: env.database }
                );
            }

            const key = _poolKey('postgres', env);
            if (_pools.has(key)) {
                const cached = _pools.get(key);
                cached.refCount++;
                this._SQLEngine = cached.engine;
                this._SQLEngine.__name = sqlName;
                console.log(`[PostgreSQL] Reusing pool for ${env.database} (refs: ${cached.refCount})`);
                return cached.pool;
            }

            const connection = new PostgresClient();
            await connection.connect(env);
            this._SQLEngine = connection.getEngine();
            this._SQLEngine.__name = sqlName;

            const pool = connection.getPool();
            _pools.set(key, { pool, engine: this._SQLEngine, client: connection, refCount: 1, dbType: 'postgres' });
            return pool;
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors with context
            throw new DatabaseConnectionError(
                `Failed to initialize PostgreSQL database: ${error.message}`,
                DB_TYPES.POSTGRES,
                {
                    sqlName,
                    host: env.host,
                    port: env.port,
                    database: env.database,
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }

    /**
     * Clear error handler state
     *
     * @private
     */
    __clearErrorHandler() {
        this._isModelValid = {
            isValid: true,
            errors: []
        };
    }

    /**
     * Find environment configuration file by traversing up the directory tree
     *
     * Searches for files matching:
     * - env.<envType>.json
     * - <envType>.json
     *
     * @private
     * @param {string} root - Starting directory
     * @param {string} rootFolderLocation - Relative or absolute folder path
     * @param {string} [envType='development'] - Environment type (development, production, etc.)
     * @returns {{file: string, rootFolder: string}} Configuration file path and root folder
     * @throws {ConfigurationError} If configuration file not found
     */
    __findSettings(root, rootFolderLocation, envType = 'development') {
        let currentRoot = root;

        // Traverse up the directory tree (max 12 hops to prevent infinite loops)
        for (let i = 0; i < MAX_CONFIG_SEARCH_HOPS; i++) {
            const rootFolder = path.isAbsolute(rootFolderLocation)
                ? rootFolderLocation
                : path.join(currentRoot, rootFolderLocation);

            // Search for environment config files with priority:
            // 1. env.<envType>.json (preferred)
            // 2. <envType>.json (fallback)
            // Note: Using separate patterns prevents matching files like "my-config.development.json"
            const patterns = [
                `${rootFolder}/**/env.${envType}.json`,
                `${rootFolder}/**/${envType}.json`
            ];

            let files = [];
            for (const pattern of patterns) {
                files = globSearch.sync(pattern, {
                    cwd: currentRoot,
                    dot: true,
                    nocase: true,
                    windowsPathsNoEscape: true
                });
                if (files && files.length > 0) break;
            }

            // Return first match
            if (files && files.length > 0) {
                const rel = files[0];
                // Ensure absolute path for require()
                const abs = path.isAbsolute(rel) ? rel : path.resolve(currentRoot, rel);

                // Find actual project root by looking for package.json or .git
                // This prevents duplicate paths like "app/models/components/workforce/db/"
                let projectRoot = path.dirname(abs);
                let searchDir = projectRoot;
                let foundProjectRoot = false;

                // Walk up the directory tree to find package.json or .git
                for (let j = 0; j < MAX_CONFIG_SEARCH_HOPS; j++) {
                    const hasPackageJson = fs.existsSync(path.join(searchDir, 'package.json'));
                    const hasGit = fs.existsSync(path.join(searchDir, '.git'));

                    if (hasPackageJson || hasGit) {
                        projectRoot = searchDir;
                        foundProjectRoot = true;
                        break;
                    }

                    const parent = path.dirname(searchDir);
                    if (parent === searchDir) break;  // Reached filesystem root
                    searchDir = parent;
                }

                // Fallback to currentRoot if no project markers found
                if (!foundProjectRoot) {
                    projectRoot = currentRoot;
                }

                return { file: abs, rootFolder: projectRoot };
            }

            // Move to parent directory
            const parent = path.dirname(currentRoot);
            if (parent === currentRoot || parent === '') {
                break;  // Reached filesystem root
            }
            currentRoot = parent;
        }

        // Configuration not found after exhaustive search
        throw new ConfigurationError(
            `Configuration file not found for environment '${envType}'`,
            {
                searchPath: `${rootFolderLocation}/env.${envType}.json`,
                startingDirectory: root,
                hopsAttempted: MAX_CONFIG_SEARCH_HOPS
            }
        );
    }

    /**
     * Resolve database file path (for SQLite)
     * Handles project-root relative paths and directory-based paths
     *
     * @private
     * @param {string} dbPath - Database path from config
     * @param {string} rootFolder - Project root folder
     * @param {string} contextName - Context name for default filename
     * @returns {string} Resolved absolute database path
     */
    _resolveDatabasePath(dbPath, rootFolder, contextName) {
        if (!dbPath) {
            throw new ConfigurationError('Database connection path is required for SQLite');
        }

        // Treat leading project-style paths ('/components/...') as project-root relative
        const looksProjectRootRelative = dbPath.startsWith('/') || dbPath.startsWith('\\');
        const isAbsoluteFsPath = path.isAbsolute(dbPath);

        if (looksProjectRootRelative || !isAbsoluteFsPath) {
            // Normalize leading separators to avoid duplicating separators on Windows
            const trimmed = dbPath.replace(/^[/\\]+/, '');
            dbPath = path.join(rootFolder, trimmed);
        }

        // If dbPath is a directory, append default filename
        const endsWithSep = dbPath.endsWith('/') || dbPath.endsWith('\\');
        const isDir = fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory();

        if (endsWithSep || isDir) {
            const dbName = `${contextName.toLowerCase()}.sqlite`;
            dbPath = path.join(dbPath, dbName);
        }

        return dbPath;
    }

    /**
     * Auto-detect and initialize database connection from configuration
     *
     * Supports both inline configuration and environment file paths.
     * Automatically detects database type (PostgreSQL, MySQL, SQLite).
     *
     * @param {string|object} rootFolderLocationOrConfig - Folder path for env file or inline config object
     * @returns {this|Promise<this>} Returns Promise for PostgreSQL (async), otherwise returns this
     * @throws {ConfigurationError} If configuration is invalid
     * @throws {DatabaseConnectionError} If connection fails
     *
     * @example
     * // With environment file
     * await context.env('./config/environments');
     *
     * @example
     * // With inline config
     * context.env({ type: 'sqlite', connection: './db/app.db' });
     */
    env(rootFolderLocationOrConfig) {
        try {
            // Determine environment: prefer explicit, then NODE_ENV, fallback 'development'
            const envType = this.__environment || process.env.NODE_ENV || 'development';
            const contextName = this.__name;

            // Try multiple base roots for robustness
            const candidateRoots = [process.cwd(), appRoot.path, __dirname];
            let file = null;
            const searchErrors = [];

            // Performance: Use for...of instead of index-based loop (more readable, same speed)
            for (const candidateRoot of candidateRoots) {
                try {
                    file = this.__findSettings(candidateRoot, rootFolderLocationOrConfig, envType);
                    if (file) break;
                } catch (error) {
                    searchErrors.push(`${candidateRoot}: ${error.message}`);
                }
            }

            if (!file && searchErrors.length > 0) {
                console.log('[Context] Config search errors:', searchErrors.join('; '));
            }
            // If still not found and an absolute path was provided, try directly
            if (!file && path.isAbsolute(rootFolderLocationOrConfig)) {
                const directFolder = rootFolderLocationOrConfig;
                const envFileA = path.join(directFolder, `env.${envType}.json`);
                const envFileB = path.join(directFolder, `${envType}.json`);
                const picked = fs.existsSync(envFileA) ? envFileA : (fs.existsSync(envFileB) ? envFileB : null);

                if (picked) {
                    // Smart root folder detection for plugin paths
                    // If the env file is in a bb-plugins/<plugin-name>/config/environments/ structure,
                    // we should set rootFolder to the project root, not the plugin's config folder
                    let detectedRoot = path.dirname(path.dirname(picked));

                    // Check if we're in a bb-plugins structure
                    const pickedParts = picked.split(path.sep);
                    const pluginsIndex = pickedParts.findIndex(part => part === 'bb-plugins');

                    if (pluginsIndex !== -1 && pluginsIndex + 3 < pickedParts.length) {
                        // We're in bb-plugins/<plugin-name>/config/environments/...
                        // Set rootFolder to the project root (parent of bb-plugins)
                        const projectRootParts = pickedParts.slice(0, pluginsIndex);
                        detectedRoot = projectRootParts.join(path.sep) || path.sep;
                    }

                    file = { file: picked, rootFolder: detectedRoot };
                }
            }

            if (!file) {
                throw new ConfigurationError(
                    `Environment configuration not found for '${envType}'`,
                    {
                        searchPath: rootFolderLocationOrConfig,
                        environment: envType,
                        attemptedRoots: candidateRoots
                    }
                );
            }

            // Always require absolute file path to avoid module root ambiguity on global installs/Windows
            const settingsPath = path.isAbsolute(file.file) ? file.file : path.resolve(file.rootFolder, file.file);
            const settings = require(settingsPath);
            const options = settings[contextName];

            if (!options || typeof options !== 'object') {
                throw new ConfigurationError(
                    `Configuration missing settings for context '${contextName}'`,
                    {
                        configFile: settingsPath,
                        availableContexts: Object.keys(settings)
                    }
                );
            }

            const type = String(options.type || '').toLowerCase();

            // Schema-only mode: CLI commands like add-migration only need entity metadata,
            // not a live database connection. Skip DB initialization entirely.
            if (process.env.MASTERRECORD_SCHEMA_ONLY === '1') {
                this.isSQLite = (type === DB_TYPES.SQLITE || type === DB_TYPES.BETTER_SQLITE3);
                this.isMySQL = (type === DB_TYPES.MYSQL);
                this.isPostgres = (type === DB_TYPES.POSTGRES || type === DB_TYPES.POSTGRESQL);
                return this;
            }

            // SQLite initialization
            if (type === DB_TYPES.SQLITE || type === DB_TYPES.BETTER_SQLITE3) {
                this.isSQLite = true;
                this.isMySQL = false;
                this.isPostgres = false;

                // Resolve database path using extracted method
                const dbPath = this._resolveDatabasePath(options.connection, file.rootFolder, contextName);

                // Ensure database directory exists
                const dbDir = path.dirname(dbPath);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }

                const sqliteOptions = { ...options, completeConnection: dbPath };

                const sqliteKey = _poolKey('sqlite', sqliteOptions);
                if (_pools.has(sqliteKey)) {
                    const cached = _pools.get(sqliteKey);
                    cached.refCount++;
                    this.db = cached.db;
                    this._SQLEngine = cached.engine;
                    return this;
                }

                this.db = this.__SQLiteInit(sqliteOptions, 'better-sqlite3');
                this._SQLEngine.setDB(this.db, 'better-sqlite3');

                _pools.set(sqliteKey, { db: this.db, engine: this._SQLEngine, refCount: 1, dbType: 'sqlite' });
                return this;
            }

            // MySQL initialization (async)
            if (type === DB_TYPES.MYSQL) {
                this.isMySQL = true;
                this.isSQLite = false;
                this.isPostgres = false;

                // Store config so migration schema can create the database if it doesn't exist
                this._dbConfig = options;

                // MySQL is async - caller must await env()
                // Store promise so migration schema can await it
                this._initPromise = (async () => {
                    this.db = await this.__mysqlInit(options, 'mysql2');
                    // Note: engine is already set in __mysqlInit
                    return this;
                })();
                // Prevent unhandled rejection crash — _ensureReady() will handle errors
                this._initPromise.catch(() => {});
                return this._initPromise;
            }

            // PostgreSQL initialization (async)
            if (type === DB_TYPES.POSTGRES || type === DB_TYPES.POSTGRESQL) {
                this.isPostgres = true;
                this.isMySQL = false;
                this.isSQLite = false;

                // Store config so migration schema can create the database if it doesn't exist
                this._dbConfig = options;

                // PostgreSQL is async - caller must await env()
                // Store promise so migration schema can await it
                this._initPromise = (async () => {
                    this.db = await this.__postgresInit(options, 'pg');
                    // Note: engine is already set in __postgresInit
                    return this;
                })();
                // Prevent unhandled rejection crash — _ensureReady() will handle errors
                this._initPromise.catch(() => {});
                return this._initPromise;
            }

            throw new ConfigurationError(
                `Unsupported database type '${type}'`,
                {
                    providedType: options.type,
                    supportedTypes: Object.values(DB_TYPES)
                }
            );
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors
            throw new ConfigurationError(
                `Failed to initialize database environment: ${error.message}`,
                {
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }

    /**
     * Configure seed data behavior for migrations
     *
     * @param {object} config - Seed configuration options
     * @param {boolean} [config.generateDownMigrations=false] - Generate rollback logic for seed data
     * @param {string} [config.downStrategy='delete'] - Strategy for down migrations ('delete' | 'skip')
     * @param {boolean} [config.deleteByPrimaryKey=true] - Use primary key for deletion in down migrations
     * @param {string} [config.onRollbackError='warn'] - How to handle rollback errors ('warn' | 'throw' | 'ignore')
     * @returns {this} Context instance for chaining
     *
     * @example
     * context.seedConfig({
     *     generateDownMigrations: true,
     *     downStrategy: 'delete'
     * });
     */
    seedConfig(config) {
        if (config && typeof config === 'object') {
            this.__contextSeedConfig = {
                ...this.__contextSeedConfig,
                ...config
            };
        }
        return this;
    }

    /**
     * Initialize SQLite database connection using environment file
     *
     * @param {string} rootFolderLocation - Path to folder containing environment files
     * @returns {this} Context instance for chaining
     * @throws {ConfigurationError} If configuration is invalid
     * @throws {DatabaseConnectionError} If connection fails
     *
     * @example
     * context.useSqlite('./config/environments');
     */
    useSqlite(rootFolderLocation) {
        try {
            this.isSQLite = true;
            this.isMySQL = false;
            this.isPostgres = false;

            const root = process.cwd();
            const envType = this.__environment || 'development';
            const contextName = this.__name;
            const file = this.__findSettings(root, rootFolderLocation, envType);
            const settings = require(file.file);
            const options = settings[contextName];

            if (!options || typeof options !== 'object') {
                throw new ConfigurationError(
                    `Configuration missing settings for context '${contextName}'`,
                    {
                        configFile: file.file,
                        availableContexts: Object.keys(settings)
                    }
                );
            }

            this.validateSQLiteOptions(options);

            // Resolve database path using extracted method (eliminates duplicate code)
            const dbPath = this._resolveDatabasePath(options.connection, file.rootFolder, contextName);
            options.completeConnection = dbPath;

            // Ensure database directory exists
            const dbDirectory = path.dirname(dbPath);
            if (!fs.existsSync(dbDirectory)) {
                fs.mkdirSync(dbDirectory, { recursive: true });
            }

            const sqliteKey = _poolKey('sqlite', options);
            if (_pools.has(sqliteKey)) {
                const cached = _pools.get(sqliteKey);
                cached.refCount++;
                this.db = cached.db;
                this._SQLEngine = cached.engine;
                return this;
            }

            this.db = this.__SQLiteInit(options, 'better-sqlite3');
            this._SQLEngine.setDB(this.db, 'better-sqlite3');

            _pools.set(sqliteKey, { db: this.db, engine: this._SQLEngine, refCount: 1, dbType: 'sqlite' });
            return this;
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors
            throw new ConfigurationError(
                `Failed to initialize SQLite: ${error.message}`,
                {
                    rootFolderLocation,
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }

    /**
     * Validate and normalize database configuration options
     *
     * Performs type inference, sets defaults, and validates required fields
     *
     * @param {object} options - Database configuration options
     * @throws {ConfigurationError} If options are invalid
     */
    validateSQLiteOptions(options) {
        if (!options || typeof options !== 'object') {
            throw new ConfigurationError('Configuration object is missing or invalid');
        }

        // Normalize type
        let type = (options.type || '').toString().toLowerCase();
        if (!type) {
            // Infer type when not provided
            if (typeof options.connection === 'string') {
                type = DB_TYPES.SQLITE;
                options.type = DB_TYPES.SQLITE;
            } else if (options.host || options.user || options.database) {
                type = DB_TYPES.MYSQL;
                options.type = DB_TYPES.MYSQL;
            } else {
                throw new ConfigurationError('Cannot infer database type from configuration. Please specify type: "sqlite", "mysql", or "postgres".');
            }
        }

        // SQLite validation
        if (type === DB_TYPES.SQLITE || type === DB_TYPES.BETTER_SQLITE3) {
            if (!options.connection || typeof options.connection !== 'string' || options.connection.trim() === '') {
                throw new ConfigurationError(
                    'SQLite connection path is required',
                    { providedConnection: options.connection }
                );
            }
            // Defaults
            if (options.username === undefined) options.username = '';
            if (options.password === undefined) options.password = '';
            return;
        }

        // MySQL validation
        if (type === DB_TYPES.MYSQL) {
            // Defaults
            if (!options.host) options.host = 'localhost';
            if (options.port === undefined) options.port = DEFAULT_PORTS.MYSQL;
            if (options.password === undefined) options.password = '';

            // Required fields
            if (!options.user || options.user.toString().trim() === '') {
                throw new ConfigurationError('MySQL user is required', { host: options.host });
            }
            if (!options.database || options.database.toString().trim() === '') {
                throw new ConfigurationError('MySQL database is required', { host: options.host, user: options.user });
            }
            return;
        }

        // PostgreSQL validation
        if (type === DB_TYPES.POSTGRES || type === DB_TYPES.POSTGRESQL) {
            // Defaults
            if (!options.host) options.host = 'localhost';
            if (options.port === undefined) options.port = DEFAULT_PORTS.POSTGRES;
            if (options.password === undefined) options.password = '';

            // Required fields
            if (!options.user || options.user.toString().trim() === '') {
                throw new ConfigurationError('PostgreSQL user is required', { host: options.host });
            }
            if (!options.database || options.database.toString().trim() === '') {
                throw new ConfigurationError('PostgreSQL database is required', { host: options.host, user: options.user });
            }
            return;
        }

        throw new ConfigurationError(
            `Unsupported database type '${type}'`,
            { supportedTypes: Object.values(DB_TYPES) }
        );
    }

    /**
     * Initialize MySQL database connection using environment file
     *
     * @param {string} rootFolderLocation - Path to folder containing environment files
     * @returns {this} Context instance for chaining
     * @throws {ConfigurationError} If configuration is invalid
     * @throws {DatabaseConnectionError} If connection fails
     *
     * @example
     * context.useMySql('./config/environments');
     */
    async useMySql(rootFolderLocation) {
        try {
            this.isMySQL = true;
            this.isSQLite = false;
            this.isPostgres = false;

            const envType = this.__environment || 'development';
            const contextName = this.__name;
            const root = appRoot.path;
            const file = this.__findSettings(root, rootFolderLocation, envType);
            const settings = require(file.file);
            const options = settings[contextName];

            if (!options || typeof options !== 'object') {
                throw new ConfigurationError(
                    `Configuration missing settings for context '${contextName}'`,
                    {
                        configFile: file.file,
                        availableContexts: Object.keys(settings)
                    }
                );
            }

            this.validateSQLiteOptions(options);
            this.db = await this.__mysqlInit(options, 'mysql2');
            // Note: engine is already set in __mysqlInit
            return this;
        } catch (error) {
            // Preserve original error if it's already a ContextError
            if (error instanceof ContextError) {
                throw error;
            }

            // Wrap other errors
            throw new ConfigurationError(
                `Failed to initialize MySQL: ${error.message}`,
                {
                    rootFolderLocation,
                    originalError: error.message,
                    stack: error.stack
                }
            );
        }
    }


    /**
     * Register an entity model with the context
     *
     * Creates a table mapping and query builder for the entity.
     * Performs input validation and SQL injection prevention.
     *
     * @param {Function|object} model - Entity class or model definition
     * @param {string} [name] - Optional custom table name (defaults to model.name)
     * @returns {object} Chainable object with seed() method
     * @throws {EntityValidationError} If model is invalid or table name contains SQL injection
     *
     * @example
     * context.dbset(User);
     * context.dbset(Post, 'blog_posts');
     * context.dbset(User).seed({ name: 'Admin', email: 'admin@example.com' });
     */
    dbset(model, name) {
        // Input validation
        if (!model) {
            throw new EntityValidationError(
                'dbset() requires a valid model',
                'Unknown',
                { providedModel: model }
            );
        }

        const validModel = modelBuilder.create(model);
        let tableName = name !== undefined ? name : model.name;

        // Validate table name (SQL injection prevention)
        if (!tableName || typeof tableName !== 'string' || tableName.trim() === '') {
            throw new EntityValidationError(
                'Table name must be a non-empty string',
                model.name,
                { providedName: name }
            );
        }

        // Security: Validate table name format (prevents SQL injection)
        if (!TABLE_NAME_VALIDATION_REGEX.test(tableName)) {
            throw new EntityValidationError(
                `Invalid table name '${tableName}'. Must contain only alphanumeric characters and underscores, and start with a letter or underscore.`,
                model.name,
                {
                    providedName: tableName,
                    validationRegex: TABLE_NAME_VALIDATION_REGEX.toString()
                }
            );
        }

        // Apply tablePrefix if set
        if (this.tablePrefix && typeof this.tablePrefix === 'string' && this.tablePrefix.length > 0) {
            tableName = this.tablePrefix + tableName;

            // Re-validate after prefix application
            if (!TABLE_NAME_VALIDATION_REGEX.test(tableName)) {
                throw new EntityValidationError(
                    `Table name '${tableName}' (after applying prefix '${this.tablePrefix}') is invalid`,
                    model.name,
                    { tablePrefix: this.tablePrefix, originalName: name }
                );
            }
        }

        validModel.__name = tableName;

        // Merge context-level composite indexes with entity-defined indexes
        this.#mergeCompositeIndexes(validModel, tableName);

        // Check if model is registered in this specific instance
        const existingIndex = this.__entities.findIndex(e => e.__name === tableName);

        if (existingIndex !== -1) {
            // Model already registered in THIS instance - this is a duplicate within same constructor
            // Only warn on the first instance of this context class (subsequent instances expected to have same pattern)
            if (this.__isFirstInstance) {
                console.warn(`Warning: dbset() called multiple times for table '${tableName}' in constructor - updating existing registration`);
            }
            // Update existing registration
            this.__entities[existingIndex] = validModel;
            this.__builderEntities[existingIndex] = tools.createNewInstance(validModel, query, this);
        } else {
            // Model not registered in this instance - add it
            this.__entities.push(validModel);  // Store model object
            const buildMod = tools.createNewInstance(validModel, query, this);
            this.__builderEntities.push(buildMod);  // Store query builder entity
        }

        // Always mark model as globally seen (after handling instance registration)
        const globalRegistry = context._globalModelRegistry[this.__name];
        globalRegistry.add(tableName);

        // Use getter to return fresh query instance each time (prevents parameter accumulation)
        Object.defineProperty(this, validModel.__name, {
            get: function() {
                return tools.createNewInstance(validModel, query, this);
            },
            configurable: true,
            enumerable: true
        });

        // Return chainable object with seed() method
        return {
            seed: (data) => this.#addSeedData(tableName, data)
        };
    }

    /**
     * Define a composite index on an entity (Option C - Context-level)
     * @param {Function|string} model - Entity class or table name
     * @param {Array<string>} columns - Column names to include in index
     * @param {Object} options - Index options { name?: string, unique?: boolean }
     */
    compositeIndex(model, columns, options = {}) {
        // Resolve table name
        let tableName;
        if (typeof model === 'string') {
            tableName = model;
        } else if (typeof model === 'function') {
            tableName = model.name;
        } else {
            throw new Error('compositeIndex: model must be entity class or table name');
        }

        // Validate columns
        if (!Array.isArray(columns) || columns.length < 2) {
            throw new Error('compositeIndex: columns must be array with at least 2 columns');
        }

        // Auto-generate name if not provided
        const indexName = options.name ||
            `idx_${tableName.toLowerCase()}_${columns.join('_')}`;

        const indexDef = {
            columns: columns,
            name: indexName,
            unique: options.unique || false
        };

        // Store in context for later merging with entity-defined indexes
        if (!this.__contextCompositeIndexes) {
            this.__contextCompositeIndexes = {};
        }
        if (!this.__contextCompositeIndexes[tableName]) {
            this.__contextCompositeIndexes[tableName] = [];
        }

        // Check for duplicate index names
        const existing = this.__contextCompositeIndexes[tableName].find(
            idx => idx.name === indexName
        );
        if (existing) {
            console.warn(`Warning: Composite index '${indexName}' already defined on ${tableName}`);
            return;
        }

        this.__contextCompositeIndexes[tableName].push(indexDef);
    }

    /**
     * Merge context-level and entity-level composite indexes
     * @private
     * @param {Object} entityObj - Entity object with __compositeIndexes
     * @param {string} tableName - Table name
     */
    #mergeCompositeIndexes(entityObj, tableName) {
        // Start with entity-defined indexes
        const entityIndexes = entityObj.__compositeIndexes || [];

        // Add context-defined indexes
        const contextIndexes = (this.__contextCompositeIndexes &&
                               this.__contextCompositeIndexes[tableName]) || [];

        // Merge and deduplicate by name
        const allIndexes = [...entityIndexes];
        const existingNames = new Set(entityIndexes.map(idx => idx.name));

        contextIndexes.forEach(idx => {
            if (!existingNames.has(idx.name)) {
                allIndexes.push(idx);
            }
        });

        entityObj.__compositeIndexes = allIndexes;
    }

    /**
     * Add seed data for a table
     * @private
     * @param {string} tableName - Table name
     * @param {object|Array<object>} data - Seed data (single object or array)
     * @returns {object} Chainable object with seed() method
     */
    #addSeedData(tableName, data) {
        // Initialize seed data storage if not exists
        if (!this.__contextSeedData) {
            this.__contextSeedData = {};
        }
        if (!this.__contextSeedData[tableName]) {
            this.__contextSeedData[tableName] = [];
        }

        // Handle both single object and array of objects
        const records = Array.isArray(data) ? data : [data];

        // Attach rollback metadata if down migrations are enabled
        if (this.__contextSeedConfig.generateDownMigrations) {
            // Find primary key for this table
            const entity = this.__entities.find(e => e.__name === tableName);
            let primaryKey = 'id'; // Default
            if (entity) {
                for (const key in entity) {
                    if (entity[key] && entity[key].primary) {
                        primaryKey = key;
                        break;
                    }
                }
            }

            records.forEach(record => {
                if (record[primaryKey] !== undefined) {
                    record.__rollback = {
                        strategy: this.__contextSeedConfig.downStrategy,
                        key: primaryKey,
                        value: record[primaryKey]
                    };
                }
            });
        }

        // Apply default upsert strategy if configured
        if (this.__contextSeedConfig.defaultStrategy === 'upsert') {
            records.forEach(record => {
                if (!record.__seedStrategy) {
                    record.__seedStrategy = {
                        type: 'upsert',
                        conflictKey: 'primaryKey',
                        updateFields: null
                    };
                }
            });
        }

        // Deduplicate seed data using EF Core HasData semantics:
        // - If record with same primary key exists, update it
        // - If record doesn't exist, insert it
        // This prevents duplicate seed data when seed() is called multiple times
        const entity = this.__entities.find(e => e.__name === tableName);
        let primaryKey = 'id'; // Default
        if (entity) {
            for (const key in entity) {
                if (entity[key] && entity[key].primary) {
                    primaryKey = key;
                    break;
                }
            }
        }

        // Check if we're adding duplicate seed data
        const existingData = this.__contextSeedData[tableName];
        if (existingData.length > 0) {
            console.warn(`Warning: seed() called multiple times for table '${tableName}' - using upsert semantics (update if primary key exists, insert otherwise)`);
        }

        // Upsert each record by primary key
        records.forEach(newRecord => {
            const pkValue = newRecord[primaryKey];
            if (pkValue !== undefined) {
                // Find existing record with same primary key
                const existingIndex = existingData.findIndex(r => r[primaryKey] === pkValue);
                if (existingIndex !== -1) {
                    // Update existing record (merge properties)
                    existingData[existingIndex] = { ...existingData[existingIndex], ...newRecord };
                } else {
                    // Insert new record
                    existingData.push(newRecord);
                }
            } else {
                // No primary key value - just append (insert semantics)
                existingData.push(newRecord);
            }
        });

        // Return chainable object with seed(), when(), seedFactory(), and upsert() methods
        const chainable = {
            seed: (moreData) => this.#addSeedData(tableName, moreData),
            seedFactory: (count, generator) => this.#seedFactory(tableName, count, generator),
            when: (...envs) => {
                // Mark last batch of records with environment condition
                const lastBatch = this.__contextSeedData[tableName].slice(-records.length);
                lastBatch.forEach(r => {
                    r.__seedEnv = {
                        conditions: envs,
                        strategy: 'generation-time'
                    };
                });
                return chainable; // Return self for further chaining
            },
            upsert: (options = {}) => {
                // Mark last batch of records with upsert strategy
                const lastBatch = this.__contextSeedData[tableName].slice(-records.length);
                lastBatch.forEach(r => {
                    r.__seedStrategy = {
                        type: 'upsert',
                        conflictKey: options.conflictKey || 'primaryKey',
                        updateFields: options.updateFields || null
                    };
                });
                return chainable; // Return self for further chaining
            }
        };

        return chainable;
    }

    /**
     * Add factory-generated seed data for a table
     * @private
     * @param {string} tableName - Table name
     * @param {number} count - Number of records to generate
     * @param {Function} generator - Function that takes index and returns record object
     * @returns {object} Chainable object
     */
    #seedFactory(tableName, count, generator) {
        if (typeof generator !== 'function') {
            throw new Error('seedFactory requires a generator function as the second parameter');
        }

        if (typeof count !== 'number' || count < 1) {
            throw new Error('seedFactory requires a positive number as the first parameter');
        }

        // Generate records using the generator function
        const records = Array.from({ length: count }, (_, i) => {
            const record = generator(i);
            if (!record || typeof record !== 'object') {
                throw new Error(`Generator function must return an object (returned ${typeof record} for index ${i})`);
            }

            // Mark as factory-generated
            record.__seedMeta = {
                generated: true,
                index: i,
                generatedAt: Date.now()
            };

            return record;
        });

        // Add generated records using the existing #addSeedData method
        return this.#addSeedData(tableName, records);
    }

    /**
     * Get seed data ordered by dependency relationships
     * Uses topological sort to ensure foreign key constraints are satisfied
     * @returns {Object} Ordered seed data by table name
     */
    getOrderedSeedData() {
        if (!this.__contextSeedData || Object.keys(this.__contextSeedData).length === 0) {
            return {};
        }

        const DependencyGraph = require('./Migrations/dependencyGraph');
        const graph = new DependencyGraph(this.__entities);
        graph.buildFromEntities();

        try {
            const orderedTables = graph.filterToSeededTables(this.__contextSeedData);
            const orderedSeedData = {};
            orderedTables.forEach(table => {
                orderedSeedData[table] = this.__contextSeedData[table];
            });
            return orderedSeedData;
        } catch (error) {
            // Handle circular dependency based on strategy
            if (this.__contextSeedConfig.circularStrategy === 'throw') {
                throw error;
            } else if (this.__contextSeedConfig.circularStrategy === 'warn') {
                console.warn(`[MasterRecord] ${error.message}, using insertion order instead`);
            }
            // Fall back to original insertion order
            return this.__contextSeedData;
        }
    }

    /**
     * Get current model validation state
     *
     * @returns {{isValid: boolean, errors: Array}} Validation state
     */
    modelState() {
        return this._isModelValid;
    }

    /**
     * Process tracked entities with batch operations
     *
     * Refactored from duplicated code in saveChanges.
     * Performance: Uses batch operations to prevent N+1 query problem (100x faster for bulk operations)
     *
     * @private
     * @param {Array<object>} tracked - Array of tracked entities
     */
    async _processTrackedEntities(tracked) {
        // Group entities by state for batch operations (single pass)
        const toInsert = [];
        const toUpdate = [];
        const toDelete = [];

        // Performance: Use for...of loop (faster and more readable than index-based)
        for (const currentModel of tracked) {
            switch (currentModel.__state) {
                case 'insert':
                    toInsert.push(currentModel);
                    break;
                case 'modified':
                    if (currentModel.__dirtyFields && currentModel.__dirtyFields.length > 0) {
                        toUpdate.push(currentModel);
                    } else {
                        console.warn('[Context] Tracked entity marked as modified but has no dirty fields');
                    }
                    break;
                case 'delete':
                    toDelete.push(currentModel);
                    break;
                case 'track':
                    // Entity is tracked but unmodified - skip during saveChanges
                    break;
                default:
                    console.warn(`[Context] Unknown entity state: ${currentModel.__state}`);
            }
        }

        // Batch insert operations
        if (toInsert.length > 0) {
            await this._processBatchInserts(toInsert);
        }

        // Batch update operations
        if (toUpdate.length > 0) {
            await this._processBatchUpdates(toUpdate);
        }

        // Batch delete operations
        if (toDelete.length > 0) {
            await this._processBatchDeletes(toDelete);
        }
    }

    /**
     * Process batch insert operations
     *
     * @private
     * @param {Array<object>} entities - Entities to insert
     */
    async _processBatchInserts(entities) {
        // Execute beforeSave hooks
        for (const entity of entities) {
            if (typeof entity.beforeSave === 'function') {
                await entity.beforeSave.call(entity);
            }
        }

        if (entities.length === 1) {
            // Single insert - use existing insertManager (already sets ID)
            const insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
            await insert.init(entities[0]);
        } else {
            // Batch insert - 100x faster for multiple records
            try {
                const results = await this._SQLEngine.bulkInsert(entities);

                // Set auto-increment IDs back on entities
                for (let i = 0; i < entities.length; i++) {
                    const entity = entities[i];
                    const result = results[i];

                    if (result && result.id) {
                        const primaryKey = tools.getPrimaryKeyObject(entity.__entity);
                        if (entity.__entity[primaryKey]?.auto === true) {
                            entity[primaryKey] = result.id;
                        }
                    }
                }
            } catch (error) {
                console.error('[Context] Bulk insert failed, falling back to individual inserts:', error.message);
                // Fallback to individual inserts
                for (const entity of entities) {
                    const insert = new insertManager(this._SQLEngine, this._isModelValid, this.__entities);
                    await insert.init(entity);
                }
            }
        }

        // Execute afterSave hooks
        for (const entity of entities) {
            if (typeof entity.afterSave === 'function') {
                await entity.afterSave.call(entity);
            }
        }
    }

    /**
     * Process batch update operations
     *
     * @private
     * @param {Array<object>} entities - Entities to update
     */
    async _processBatchUpdates(entities) {
        // Execute beforeSave hooks
        for (const entity of entities) {
            if (typeof entity.beforeSave === 'function') {
                await entity.beforeSave.call(entity);
            }
        }

        if (entities.length === 1) {
            // Single update - use existing logic
            const currentModel = entities[0];
            const cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity);
            const argu = this._SQLEngine._buildSQLEqualToParameterized(cleanCurrentModel);

            if (argu !== -1) {
                const primaryKey = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                const sqlUpdate = {
                    tableName: cleanCurrentModel.__entity.__name,
                    arg: argu,
                    primaryKey: primaryKey,
                    primaryKeyValue: cleanCurrentModel[primaryKey]
                };
                await this._SQLEngine.update(sqlUpdate);
            } else {
                console.warn('[Context] Entity marked for update but no changes detected');
            }
        } else {
            // Batch update - build all queries first
            const updateQueries = [];

            for (const currentModel of entities) {
                const cleanCurrentModel = tools.removePrimarykeyandVirtual(currentModel, currentModel._entity);
                const argu = this._SQLEngine._buildSQLEqualToParameterized(cleanCurrentModel);

                if (argu !== -1) {
                    const primaryKey = tools.getPrimaryKeyObject(cleanCurrentModel.__entity);
                    updateQueries.push({
                        tableName: cleanCurrentModel.__entity.__name,
                        arg: argu,
                        primaryKey: primaryKey,
                        primaryKeyValue: cleanCurrentModel[primaryKey]
                    });
                }
            }

            if (updateQueries.length > 0) {
                try {
                    await this._SQLEngine.bulkUpdate(updateQueries);
                } catch (error) {
                    console.error('[Context] Bulk update failed, falling back to individual updates:', error.message);
                    // Fallback to individual updates
                    for (const query of updateQueries) {
                        await this._SQLEngine.update(query);
                    }
                }
            }
        }

        // Execute afterSave hooks
        for (const entity of entities) {
            if (typeof entity.afterSave === 'function') {
                await entity.afterSave.call(entity);
            }
        }
    }

    /**
     * Process batch delete operations
     *
     * @private
     * @param {Array<object>} entities - Entities to delete
     */
    async _processBatchDeletes(entities) {
        // Execute beforeDelete hooks
        for (const entity of entities) {
            if (typeof entity.beforeDelete === 'function') {
                await entity.beforeDelete.call(entity);
            }
        }

        if (entities.length === 1) {
            // Single delete - use existing deleteManager
            const deleteObject = new deleteManager(this._SQLEngine, this.__entities);
            await deleteObject.init(entities[0]);
        } else {
            // Batch delete - group by table for efficiency
            const deletesByTable = new Map();  // Use Map instead of object for better performance

            for (const entity of entities) {
                const tableName = entity.__entity.__name;
                const primaryKey = tools.getPrimaryKeyObject(entity.__entity);
                const id = entity[primaryKey];

                if (!deletesByTable.has(tableName)) {
                    deletesByTable.set(tableName, []);
                }
                deletesByTable.get(tableName).push(id);
            }

            try {
                // Performance: Use for...of with Map entries
                for (const [tableName, ids] of deletesByTable.entries()) {
                    await this._SQLEngine.bulkDelete(tableName, ids);
                }
            } catch (error) {
                console.error('[Context] Bulk delete failed, falling back to individual deletes:', error.message);
                // Fallback to individual deletes
                for (const entity of entities) {
                    const deleteObject = new deleteManager(this._SQLEngine, this.__entities);
                    await deleteObject.init(entity);
                }
            }
        }

        // Execute afterDelete hooks
        for (const entity of entities) {
            if (typeof entity.afterDelete === 'function') {
                await entity.afterDelete.call(entity);
            }
        }
    }

    /**
     * Save all tracked entity changes to the database
     *
     * Executes INSERT, UPDATE, and DELETE operations for all tracked entities.
     * Uses transactions for SQLite. Automatically invalidates query cache for affected tables.
     *
     * @returns {boolean} True if changes were saved successfully
     * @throws {Error} If database operations fail
     *
     * @example
     * const user = db.User.new();
     * user.name = 'Alice';
     * db.saveChanges();
     */
    async saveChanges() {
        try {
            const tracked = this.__trackedEntities;

            if (tracked.length === 0) {
                console.log('[Context] No tracked entities to save');
                return true;
            }

            // Performance: Collect affected tables for cache invalidation (single pass)
            const affectedTables = new Set();
            for (const entity of tracked) {
                if (entity.__name) {
                    affectedTables.add(entity.__name);
                }
            }

            // Handle transactions based on database type
            if (this.isSQLite) {
                await this._SQLEngine.startTransaction();
                try {
                    await this._processTrackedEntities(tracked);
                    this.__clearErrorHandler();
                    await this._SQLEngine.endTransaction();
                } catch (error) {
                    await this._SQLEngine.errorTransaction();
                    throw error;
                }
            } else if (this.isMySQL) {
                // MySQL: Async operations
                await this._processTrackedEntities(tracked);
                this.__clearErrorHandler();
            } else if (this.isPostgres) {
                // PostgreSQL: Async operations
                await this._processTrackedEntities(tracked);
                this.__clearErrorHandler();
            }

            // Invalidate query cache for affected tables
            for (const tableName of affectedTables) {
                this._queryCache.invalidateTable(tableName);
            }

            // Clear tracked entities after successful save
            this.__clearTracked();
            return true;
        } catch (error) {
            // Clean up on error
            this.__clearErrorHandler();
            this.__clearTracked();

            console.error('[Context] Failed to save changes:', error);
            throw error;
        }
    }


    /**
     * Execute a raw SQL query
     *
     * @param {string} query - SQL query to execute
     *
     * @example
     * context._execute('CREATE INDEX idx_user_email ON User(email)');
     */
    _execute(query) {
        return this._SQLEngine._execute(query);
    }

    /**
     * Get query cache statistics
     *
     * Returns cache performance metrics including hit rate, size, and efficiency.
     *
     * @returns {{size: number, maxSize: number, hits: number, misses: number, hitRate: string, enabled: boolean}}
     *
     * @example
     * const stats = db.getCacheStats();
     * console.log(`Cache hit rate: ${stats.hitRate}`);
     */
    getCacheStats() {
        return this._queryCache.getStats();
    }

    /**
     * Clear query cache manually
     *
     * Removes all cached query results. Use when you need to ensure fresh data.
     *
     * @example
     * db.clearQueryCache();
     */
    clearQueryCache() {
        this._queryCache.clear();
    }

    /**
     * Bulk create multiple entities at once
     *
     * Creates multiple entity instances and saves them in a single batch operation.
     * Much faster than creating entities individually.
     *
     * @param {string} entityName - Name of the entity class (e.g., 'User')
     * @param {Array<Object>} data - Array of objects with entity properties
     * @returns {Promise<Array<Object>>} Array of created entities with IDs set
     *
     * @example
     * const users = await db.bulkCreate('User', [
     *   { name: 'Alice', email: 'alice@example.com' },
     *   { name: 'Bob', email: 'bob@example.com' },
     *   { name: 'Charlie', email: 'charlie@example.com' }
     * ]);
     * console.log(users[0].id); // IDs are automatically set
     */
    async bulkCreate(entityName, data) {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('bulkCreate requires a non-empty array of data');
        }

        const EntityClass = this[entityName];
        if (!EntityClass) {
            throw new Error(`Entity ${entityName} not found in context`);
        }

        const entities = [];
        for (const item of data) {
            const entity = EntityClass.new();
            // Copy properties from data object to entity
            for (const key in item) {
                if (item.hasOwnProperty(key)) {
                    entity[key] = item[key];
                }
            }
            entities.push(entity);
        }

        await this.saveChanges();
        return entities;
    }

    /**
     * Bulk update multiple entities at once
     *
     * Updates multiple existing entities in a single batch operation.
     * Entities must already be tracked in the context.
     *
     * @param {string} entityName - Name of the entity class (e.g., 'User')
     * @param {Array<Object>} updates - Array of objects with id and properties to update
     * @returns {Promise<boolean>} True if updates were successful
     *
     * @example
     * await db.bulkUpdate('User', [
     *   { id: 1, status: 'active' },
     *   { id: 2, status: 'active' },
     *   { id: 3, status: 'inactive' }
     * ]);
     */
    async bulkUpdate(entityName, updates) {
        if (!Array.isArray(updates) || updates.length === 0) {
            throw new Error('bulkUpdate requires a non-empty array of updates');
        }

        const EntityClass = this[entityName];
        if (!EntityClass) {
            throw new Error(`Entity ${entityName} not found in context`);
        }

        // Fetch all entities by ID
        const ids = updates.map(u => u.id).filter(id => id !== undefined);
        if (ids.length !== updates.length) {
            throw new Error('All update objects must have an id property');
        }

        // Load entities and apply updates
        for (const update of updates) {
            const entity = await EntityClass.findById(update.id);
            if (!entity) {
                throw new Error(`${entityName} with id ${update.id} not found`);
            }

            // Apply updates to entity
            for (const key in update) {
                if (update.hasOwnProperty(key) && key !== 'id') {
                    entity[key] = update[key];
                }
            }
        }

        await this.saveChanges();
        return true;
    }

    /**
     * Bulk delete multiple entities at once
     *
     * Deletes multiple entities by their IDs in a single batch operation.
     * Much faster than deleting entities individually.
     *
     * @param {string} entityName - Name of the entity class (e.g., 'User')
     * @param {Array<number|string>} ids - Array of entity IDs to delete
     * @returns {Promise<boolean>} True if deletions were successful
     *
     * @example
     * await db.bulkDelete('User', [1, 2, 3, 4, 5]);
     */
    async bulkDelete(entityName, ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new Error('bulkDelete requires a non-empty array of IDs');
        }

        const EntityClass = this[entityName];
        if (!EntityClass) {
            throw new Error(`Entity ${entityName} not found in context`);
        }

        // Load entities and mark for deletion
        for (const id of ids) {
            const entity = await EntityClass.findById(id);
            if (entity) {
                await entity.delete();
            }
        }

        return true;
    }

    /**
     * Enable or disable query caching
     *
     * @param {boolean} enabled - True to enable caching, false to disable
     *
     * @example
     * db.setQueryCacheEnabled(false);  // Disable for testing
     */
    setQueryCacheEnabled(enabled) {
        this._queryCache.enabled = enabled;
    }

    /**
     * End request and clear query cache
     *
     * Call this at the end of each HTTP request to clear request-scoped cache.
     * Similar to Active Record's cache clearing behavior.
     *
     * @example
     * // In Express middleware
     * app.use((req, res, next) => {
     *     req.db = new AppContext();
     *     res.on('finish', () => {
     *         req.db.endRequest();  // Clears cache
     *     });
     *     next();
     * });
     */
    endRequest() {
        this.clearQueryCache();
    }

    /**
     * Close database connections and cleanup resources
     *
     * Call this when shutting down your application or after CLI operations
     * to properly close database connection pools and prevent hanging processes.
     *
     * @returns {Promise<void>|void} Promise for async databases (PostgreSQL), void for sync databases
     *
     * @example
     * // PostgreSQL (async)
     * const db = new AppContext();
     * // ... do work ...
     * await db.close();  // Close connection pool
     *
     * @example
     * // MySQL/SQLite (sync)
     * const db = new AppContext();
     * // ... do work ...
     * db.close();  // Close connections
     */
    async close() {
        // Find this instance's pool in the registry and decrement
        for (const [key, entry] of _pools) {
            if (entry.engine === this._SQLEngine) {
                entry.refCount--;
                if (entry.refCount <= 0) {
                    _pools.delete(key);
                    if (this._SQLEngine && typeof this._SQLEngine.close === 'function') {
                        await this._SQLEngine.close();
                    }
                }
                this._SQLEngine = null;
                this.db = null;
                return;
            }
        }

        // Fallback (not in registry)
        if (this._SQLEngine && typeof this._SQLEngine.close === 'function') {
            return await this._SQLEngine.close();
        }
    }

    /**
     * Close all shared connection pools, regardless of reference count.
     * Useful for graceful shutdown or test cleanup.
     *
     * @static
     * @async
     * @returns {Promise<void>}
     *
     * @example
     * // Graceful shutdown
     * process.on('SIGTERM', async () => {
     *     await context.closeAll();
     *     process.exit(0);
     * });
     */
    static async closeAll() {
        for (const [key, entry] of _pools) {
            try {
                if (entry.engine && typeof entry.engine.close === 'function') {
                    await entry.engine.close();
                }
            } catch (err) {
                console.error('[MasterRecord] Error closing pool:', err.message);
            }
        }
        _pools.clear();
    }

    /**
     * Get statistics about active connection pools.
     *
     * @static
     * @returns {Array<{key: string, dbType: string, refCount: number}>}
     *
     * @example
     * console.log(context.getPoolStats());
     * // [{ key: 'mysql:root@localhost:3306/mydb', dbType: 'mysql', refCount: 3 }]
     */
    static getPoolStats() {
        return Array.from(_pools.entries()).map(([key, entry]) => ({
            key, dbType: entry.dbType, refCount: entry.refCount
        }));
    }

    /**
     * Attach a detached entity and mark it as modified
     *
     * Use this when an entity was loaded in a different context or passed from another service.
     * Similar to Entity Framework's context.Update() or Hibernate's session.merge()
     *
     * @param {object} entity - The detached entity to attach
     * @param {object} [changes=null] - Optional: specific fields that were modified
     * @returns {object} The attached entity
     * @throws {EntityValidationError} If entity is invalid
     *
     * @example
     * // Attach entity loaded elsewhere
     * const task = await taskService.getTask(taskId);
     * task.status = 'completed';
     * db.attach(task);  // Mark as modified
     * await db.saveChanges();
     *
     * @example
     * // Attach with specific changed fields
     * db.attach(task, { status: 'completed', updated_at: new Date() });
     * await db.saveChanges();
     */
    attach(entity, changes = null) {
        if (!entity) {
            throw new EntityValidationError(
                'Cannot attach null or undefined entity',
                'Unknown'
            );
        }

        // Ensure entity has required metadata
        if (!entity.__entity || !entity.__entity.__name) {
            throw new EntityValidationError(
                'Entity must have __entity metadata. Make sure it was loaded through MasterRecord.',
                'Unknown',
                { providedEntity: typeof entity }
            );
        }

        // Mark entity as modified
        entity.__state = 'modified';

        // If specific changes provided, mark only those fields as dirty
        if (changes && typeof changes === 'object') {
            entity.__dirtyFields = entity.__dirtyFields || [];

            // Security: Use Object.keys() instead of for...in to avoid prototype pollution
            for (const fieldName of Object.keys(changes)) {
                entity[fieldName] = changes[fieldName];
                if (!entity.__dirtyFields.includes(fieldName)) {
                    entity.__dirtyFields.push(fieldName);
                }
            }
        } else {
            // Mark all fields as potentially modified
            entity.__dirtyFields = entity.__dirtyFields || [];

            // If no dirty fields yet, mark all non-metadata fields as dirty
            if (entity.__dirtyFields.length === 0) {
                // Security: Use Object.keys() instead of for...in to avoid prototype pollution
                for (const fieldName of Object.keys(entity.__entity)) {
                    if (!fieldName.startsWith('__') &&
                        entity.__entity[fieldName].type !== 'hasMany' &&
                        entity.__entity[fieldName].type !== 'hasOne') {
                        entity.__dirtyFields.push(fieldName);
                    }
                }
            }
        }

        // Ensure context reference
        entity.__context = this;

        // Track the entity
        this.__track(entity);

        return entity;
    }

    /**
     * Attach multiple detached entities at once
     *
     * @param {Array<object>} entities - Array of entities to attach
     * @returns {Array<object>} Array of attached entities
     * @throws {EntityValidationError} If input is not an array
     *
     * @example
     * const tasks = await taskService.getTasks();
     * tasks.forEach(t => t.status = 'completed');
     * db.attachAll(tasks);
     * await db.saveChanges();
     */
    attachAll(entities) {
        if (!Array.isArray(entities)) {
            throw new EntityValidationError(
                'attachAll() requires an array of entities',
                'Unknown',
                { providedType: typeof entities }
            );
        }

        return entities.map(entity => this.attach(entity));
    }

    /**
     * Update a detached entity by primary key
     *
     * Loads the entity, applies changes, and marks as modified.
     * Similar to Sequelize's Model.update()
     *
     * @param {string} entityName - Name of the entity class
     * @param {*} primaryKey - Primary key value
     * @param {object} changes - Fields to update
     * @returns {Promise<object>} Updated entity
     * @throws {EntityValidationError} If entity not found
     *
     * @example
     * // Update without loading first
     * await db.update('Task', { id: taskId }, { status: 'completed' });
     * await db.saveChanges();
     */
    async update(entityName, primaryKey, changes) {
        // Get entity class
        const EntityClass = this[entityName];
        if (!EntityClass) {
            throw new EntityValidationError(
                `Entity '${entityName}' not found in context`,
                entityName,
                { availableEntities: Object.keys(this).filter(k => !k.startsWith('_')) }
            );
        }

        // Load entity
        const entity = await EntityClass.findById(primaryKey);
        if (!entity) {
            throw new EntityValidationError(
                `${entityName} with id ${primaryKey} not found`,
                entityName,
                { primaryKey }
            );
        }

        // Apply changes and attach
        return this.attach(entity, changes);
    }

    /**
     * Track an entity for change detection
     *
     * Performance: Uses Map for O(1) lookup instead of O(n) linear search.
     * Collision-safe sequential IDs prevent duplicate tracking.
     *
     * @private
     * @param {object} model - Entity to track
     * @returns {object} The tracked entity
     */
    __track(model) {
        // Performance: Use Map for O(1) lookup instead of O(n) linear search
        if (!model.__ID) {
            // Generate sequential ID (collision-safe)
            model.__ID = `entity_${context._nextEntityId++}`;
        }

        // O(1) check if already tracked
        if (!this.__trackedEntitiesMap.has(model.__ID)) {
            this.__trackedEntities.push(model);
            this.__trackedEntitiesMap.set(model.__ID, model);
        }

        return model;
    }

    /**
     * Find a tracked entity by ID
     *
     * @private
     * @param {string} id - Entity tracking ID
     * @returns {object|null} Tracked entity or null
     */
    __findTracked(id) {
        // Performance: O(1) Map lookup instead of O(n) array search
        if (id) {
            return this.__trackedEntitiesMap.get(id) || null;
        }
        return null;
    }

    /**
     * Clear all tracked entities
     *
     * @private
     */
    __clearTracked() {
        this.__trackedEntities = [];
        this.__trackedEntitiesMap.clear();  // Clear Map for proper garbage collection
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = context;

// Export custom error classes for advanced error handling
module.exports.ContextError = ContextError;
module.exports.ConfigurationError = ConfigurationError;
module.exports.DatabaseConnectionError = DatabaseConnectionError;
module.exports.EntityValidationError = EntityValidationError;