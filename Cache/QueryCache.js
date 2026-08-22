import crypto from 'node:crypto';
import { log } from '../logging.js';

/**
 * Production-Grade Query Result Cache
 * Similar to EF Core's EFCoreSecondLevelCacheInterceptor
 */
class QueryCache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || 5 * 60 * 1000;  // 5 minutes default
        this.maxSize = options.maxSize || 1000;    // LRU eviction
        this.enabled = options.enabled !== false;
        this.hitCount = 0;
        this.missCount = 0;

        // Start cleanup timer
        this._startCleanupTimer();
    }

    /**
     * Generate deterministic cache key from query + params
     * Like Hibernate's query cache regions
     */
    generateKey(query, params, tableName) {
        const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
        const keyData = {
            query: normalizedQuery,
            params: params || [],
            table: tableName
        };
        return crypto.createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex');
    }

    /**
     * Get cached query result
     */
    get(cacheKey) {
        if (!this.enabled) return null;

        const entry = this.cache.get(cacheKey);
        if (!entry) {
            this.missCount++;
            return null;
        }

        // Check TTL expiration
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(cacheKey);
            this.missCount++;
            return null;
        }

        // Update LRU metadata
        entry.hits++;
        entry.lastAccess = Date.now();
        this.hitCount++;

        log('debug', `[QueryCache HIT] Key: ${cacheKey.substring(0, 8)}... (${entry.hits} hits)`);

        return entry.data;
    }

    /**
     * Store query result in cache
     */
    set(cacheKey, data, tableName) {
        if (!this.enabled) return;

        // LRU eviction if at capacity
        if (this.cache.size >= this.maxSize) {
            this._evictLRU();
        }

        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now(),
            lastAccess: Date.now(),
            hits: 0,
            tableName: tableName
        });

        log('debug', `[QueryCache SET] Key: ${cacheKey.substring(0, 8)}... Table: ${tableName}`);
    }

    /**
     * Invalidate all cache entries for a table
     * Called automatically on INSERT/UPDATE/DELETE
     */
    invalidateTable(tableName) {
        let invalidated = 0;
        for (const [key, entry] of this.cache) {
            if (entry.tableName === tableName) {
                this.cache.delete(key);
                invalidated++;
            }
        }

        log('debug', `[QueryCache INVALIDATE] Table: ${tableName} (${invalidated} entries)`);
    }

    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const total = this.hitCount + this.missCount;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hitCount,
            misses: this.missCount,
            hitRate: total > 0 ? (this.hitCount / total * 100).toFixed(2) + '%' : '0%',
            enabled: this.enabled
        };
    }

    /**
     * LRU eviction - remove least recently used entry
     */
    _evictLRU() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.lastAccess < oldestTime) {
                oldestTime = entry.lastAccess;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * Background cleanup of expired entries
     */
    _startCleanupTimer() {
        // .unref() so the interval does not keep the Node process alive
        // after user code finishes — callers should not have to explicitly
        // stop the cleanup timer to let their script exit.
        const timer = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;

            for (const [key, entry] of this.cache) {
                if (now - entry.timestamp > this.ttl) {
                    this.cache.delete(key);
                    cleaned++;
                }
            }

            if (cleaned > 0) log('debug', `[QueryCache CLEANUP] Removed ${cleaned} expired entries`);
        }, 60000);
        if (typeof timer.unref === 'function') timer.unref();
        this._cleanupTimer = timer;
    }
}

export default QueryCache;
