const assert = require('assert');
const QueryCache = require('../Cache/QueryCache');

describe('QueryCache', () => {
    let cache;

    beforeEach(() => {
        cache = new QueryCache({ ttl: 1000, maxSize: 3 });
    });

    test('cache miss returns null', () => {
        const key = cache.generateKey('SELECT * FROM users', [], 'users');
        assert.strictEqual(cache.get(key), null);
    });

    test('cache hit returns stored data', () => {
        const key = cache.generateKey('SELECT * FROM users', [], 'users');
        const data = [{ id: 1, name: 'John' }];

        cache.set(key, data, 'users');
        const cached = cache.get(key);

        assert.deepStrictEqual(cached, data);
    });

    test('TTL expiration removes entries', (done) => {
        const key = cache.generateKey('SELECT * FROM users', [], 'users');
        cache.set(key, { id: 1 }, 'users');

        setTimeout(() => {
            assert.strictEqual(cache.get(key), null);
            done();
        }, 1100);  // Wait for TTL expiration
    });

    test('LRU eviction removes oldest entry', () => {
        cache.set('key1', 'data1', 'table1');
        cache.set('key2', 'data2', 'table2');
        cache.set('key3', 'data3', 'table3');

        // Access key1 to make it recently used
        cache.get('key1');

        // Add key4 - should evict key2 (least recently used)
        cache.set('key4', 'data4', 'table4');

        assert.strictEqual(cache.get('key1'), 'data1');  // Still in cache
        assert.strictEqual(cache.get('key2'), null);     // Evicted
        assert.strictEqual(cache.get('key3'), 'data3');  // Still in cache
        assert.strictEqual(cache.get('key4'), 'data4');  // Newly added
    });

    test('invalidateTable removes all entries for table', () => {
        cache.set('key1', 'data1', 'users');
        cache.set('key2', 'data2', 'users');
        cache.set('key3', 'data3', 'posts');

        cache.invalidateTable('users');

        assert.strictEqual(cache.get('key1'), null);
        assert.strictEqual(cache.get('key2'), null);
        assert.strictEqual(cache.get('key3'), 'data3');  // Different table
    });

    test('getStats returns accurate metrics', () => {
        const key1 = cache.generateKey('query1', [], 'users');
        const key2 = cache.generateKey('query2', [], 'posts');

        cache.set(key1, 'data1', 'users');
        cache.get(key1);  // Hit
        cache.get(key2);  // Miss

        const stats = cache.getStats();
        assert.strictEqual(stats.size, 1);
        assert.strictEqual(stats.hits, 1);
        assert.strictEqual(stats.misses, 1);
        assert.strictEqual(stats.hitRate, '50.00%');
    });

    test('clear removes all cache entries', () => {
        const key1 = cache.generateKey('query1', [], 'users');
        const key2 = cache.generateKey('query2', [], 'posts');

        cache.set(key1, 'data1', 'users');
        cache.set(key2, 'data2', 'posts');

        assert.strictEqual(cache.cache.size, 2);

        cache.clear();

        assert.strictEqual(cache.cache.size, 0);
        assert.strictEqual(cache.hitCount, 0);
        assert.strictEqual(cache.missCount, 0);
    });

    test('disabled cache does not store or retrieve data', () => {
        cache.enabled = false;

        const key = cache.generateKey('SELECT * FROM users', [], 'users');
        cache.set(key, 'data', 'users');

        assert.strictEqual(cache.get(key), null);
        assert.strictEqual(cache.cache.size, 0);
    });

    test('generateKey creates consistent keys for same query', () => {
        const key1 = cache.generateKey('SELECT * FROM users WHERE id = ?', [1], 'users');
        const key2 = cache.generateKey('SELECT * FROM users WHERE id = ?', [1], 'users');
        const key3 = cache.generateKey('SELECT * FROM users WHERE id = ?', [2], 'users');

        assert.strictEqual(key1, key2);  // Same query + params = same key
        assert.notStrictEqual(key1, key3);  // Different params = different key
    });

    test('generateKey normalizes whitespace', () => {
        const key1 = cache.generateKey('SELECT   *   FROM   users', [], 'users');
        const key2 = cache.generateKey('SELECT * FROM users', [], 'users');

        assert.strictEqual(key1, key2);  // Whitespace normalized
    });

    test('cache updates lastAccess on hit', () => {
        const key = cache.generateKey('query', [], 'users');
        cache.set(key, 'data', 'users');

        const entry1 = cache.cache.get(key);
        const originalAccess = entry1.lastAccess;

        // Wait a bit
        setTimeout(() => {
            cache.get(key);
            const entry2 = cache.cache.get(key);
            assert(entry2.lastAccess > originalAccess);
        }, 10);
    });

    test('cache tracks hit count per entry', () => {
        const key = cache.generateKey('query', [], 'users');
        cache.set(key, 'data', 'users');

        cache.get(key);
        cache.get(key);
        cache.get(key);

        const entry = cache.cache.get(key);
        assert.strictEqual(entry.hits, 3);
    });
});
