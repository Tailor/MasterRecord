/**
 * Reusing a pooled connection is routine — every context a server constructs
 * does it — so it is a DEBUG message, not an info line. At info level it
 * printed on every context construction: a CodeBook production log carried
 * thousands of "[PostgreSQL] Reusing pool for codebook (refs: N)" lines within
 * minutes, which buried the one deploy error that mattered. Creating a pool
 * (once per process) still logs; reuse is visible with configureLogging({ level: 'debug' }).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureLogging, log } from '../logging.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'context.js'), 'utf8');

test('pool reuse is logged through the logger at debug level, never console.log', () => {
    const lines = source.split('\n').filter((l) => l.includes('Reusing pool'));
    assert.equal(lines.length, 4, 'MySQL and PostgreSQL, the awaited and the resolved path');
    for (const l of lines) {
        assert.doesNotMatch(l, /console\.log/);
        assert.match(l, /log\('debug',/);
    }
});

test('a debug message is dropped at the default info level and shown at debug', () => {
    const seen = [];
    const capture = { debug: (m) => seen.push(m), info: (m) => seen.push(m), warn: () => {}, error: () => {} };
    const before = configureLogging({ logger: capture, level: 'info' });
    try {
        log('debug', '[PostgreSQL] Reusing pool for db (refs: 2)');
        assert.equal(seen.length, 0, 'hidden at info');
        configureLogging({ level: 'debug' });
        log('debug', '[PostgreSQL] Reusing pool for db (refs: 3)');
        assert.deepEqual(seen, ['[PostgreSQL] Reusing pool for db (refs: 3)']);
    } finally {
        configureLogging({ logger: console, level: before.level });
    }
});
