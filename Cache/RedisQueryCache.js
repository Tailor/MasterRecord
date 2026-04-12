import crypto from 'node:crypto';

/**
 * Distributed Query Cache using Redis
 * For multi-process/clustered deployments
 */
class RedisQueryCache {
    constructor(redisClient, options = {}) {
        this.redis = redisClient;
        this.localCache = new Map();  // L1 cache (in-memory)
        this.ttl = options.ttl || 5 * 60;  // Redis uses seconds
        this.enabled = options.enabled !== false;
        this.prefix = options.prefix || 'qcache:';

        // Subscribe to invalidation events
        this._setupInvalidationSubscription();
    }

    generateKey(query, params, tableName) {
        const hash = crypto.createHash('sha256')
            .update(JSON.stringify({query, params}))
            .digest('hex');
        return `${this.prefix}${tableName}:${hash}`;
    }

    async get(cacheKey) {
        if (!this.enabled) return null;

        // L1: Check local cache first (fast)
        if (this.localCache.has(cacheKey)) {
            const entry = this.localCache.get(cacheKey);
            if (Date.now() - entry.timestamp < 30000) {  // 30s local TTL
                return entry.data;
            }
            this.localCache.delete(cacheKey);
        }

        // L2: Check Redis (distributed)
        try {
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                const data = JSON.parse(cached);

                // Populate L1
                this.localCache.set(cacheKey, {
                    data: data,
                    timestamp: Date.now()
                });

                return data;
            }
        } catch (error) {
            console.error('[RedisQueryCache] Get error:', error);
        }

        return null;
    }

    async set(cacheKey, data, tableName) {
        if (!this.enabled) return;

        try {
            // Store in Redis with TTL
            await this.redis.setex(cacheKey, this.ttl, JSON.stringify(data));

            // Store in L1
            this.localCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('[RedisQueryCache] Set error:', error);
        }
    }

    async invalidateTable(tableName) {
        try {
            // Find all keys for this table
            const pattern = `${this.prefix}${tableName}:*`;
            const keys = await this.redis.keys(pattern);

            if (keys.length > 0) {
                await this.redis.del(...keys);
            }

            // Clear L1
            for (const [key] of this.localCache) {
                if (key.includes(tableName)) {
                    this.localCache.delete(key);
                }
            }

            // Publish invalidation to other processes
            await this.redis.publish('cache-invalidate', JSON.stringify({
                table: tableName,
                timestamp: Date.now()
            }));

        } catch (error) {
            console.error('[RedisQueryCache] Invalidate error:', error);
        }
    }

    _setupInvalidationSubscription() {
        // Subscribe to invalidation messages from other processes
        const subscriber = this.redis.duplicate();
        subscriber.subscribe('cache-invalidate', (message) => {
            try {
                const event = JSON.parse(message);

                // Clear local cache for this table
                for (const [key] of this.localCache) {
                    if (key.includes(event.table)) {
                        this.localCache.delete(key);
                    }
                }
            } catch (error) {
                console.error('[RedisQueryCache] Subscription error:', error);
            }
        });
    }

    async clear() {
        try {
            const keys = await this.redis.keys(`${this.prefix}*`);
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
            this.localCache.clear();
        } catch (error) {
            console.error('[RedisQueryCache] Clear error:', error);
        }
    }

    async getStats() {
        try {
            const keys = await this.redis.keys(`${this.prefix}*`);
            return {
                size: keys.length,
                localSize: this.localCache.size,
                enabled: this.enabled,
                ttl: this.ttl
            };
        } catch (error) {
            console.error('[RedisQueryCache] GetStats error:', error);
            return {
                size: 0,
                localSize: this.localCache.size,
                enabled: this.enabled,
                ttl: this.ttl
            };
        }
    }
}

export default RedisQueryCache;
