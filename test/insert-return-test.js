/**
 * Test to check what insert() returns
 */

const SQLLiteEngine = require('../SQLLiteEngine');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'insertReturnTest.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
}

const engine = new SQLLiteEngine({ database: dbPath, prefix: '' });

// Create table
engine._run(`CREATE TABLE test_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
)`);

// Test insert
const queryObject = {
    __entity: {
        __name: 'test_users',
        id: { type: 'integer', primary: true, auto: true },
        name: { type: 'string' }
    },
    name: 'Test User'
};

async function test() {
    const result = await engine.insert(queryObject);
    console.log('Insert result:', result);
    console.log('result.id:', result.id);
    console.log('typeof result.id:', typeof result.id);
}

test().catch(console.error);
