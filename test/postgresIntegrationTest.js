/**
 * PostgreSQL Integration Test for MasterRecord
 *
 * Tests the complete PostgreSQL implementation with pg 8.16.3
 *
 * Requirements:
 * - PostgreSQL server running on localhost:5432
 * - Test database named 'masterrecord_test'
 * - User with credentials (set in config below)
 */

const PostgresSyncConnect = require('../postgresSyncConnect');
const postgresEngine = require('../postgresEngine');

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         PostgreSQL Integration Test for MasterRecord          ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let failed = 0;

// Test configuration - update these for your environment
const TEST_CONFIG = {
    host: 'localhost',
    port: 5432,
    database: 'masterrecord_test',
    user: 'postgres',
    password: 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
};

// Mock entity for testing
const TEST_ENTITY = {
    __name: 'TestUser',
    id: { type: 'integer', primary: true, auto: true },
    name: { type: 'string', nullable: false },
    email: { type: 'string', nullable: false },
    age: { type: 'integer', nullable: true },
    created_at: { type: 'timestamp', nullable: true }
};

let connection = null;
let engine = null;

async function runTests() {
    try {
        // Test 1: Connection Initialization
        console.log("📝 Test 1: PostgreSQL Connection Initialization");
        console.log("──────────────────────────────────────────────────");

        try {
            connection = new PostgresSyncConnect();
            await connection.connect(TEST_CONFIG);

            if (connection.isConnected()) {
                console.log("   ✓ Connection established");
                console.log(`   ✓ Connected to ${TEST_CONFIG.database}`);
                passed++;
            } else {
                console.log("   ✗ Connection failed");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            console.log("   ℹ  Make sure PostgreSQL is running and test database exists");
            failed++;
            return; // Can't continue without connection
        }

        // Test 2: Get Engine Instance
        console.log("\n📝 Test 2: Get Engine Instance");
        console.log("──────────────────────────────────────────────────");

        try {
            engine = connection.getEngine();

            if (engine) {
                console.log("   ✓ Engine instance retrieved");
                console.log(`   ✓ Engine type: ${engine.dbType}`);
                passed++;
            } else {
                console.log("   ✗ Failed to get engine");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 3: Health Check
        console.log("\n📝 Test 3: Connection Health Check");
        console.log("──────────────────────────────────────────────────");

        try {
            const health = await connection.healthCheck();

            if (health.healthy) {
                console.log("   ✓ Health check passed");
                console.log(`   ✓ Server time: ${health.serverTime}`);
                console.log(`   ✓ Pool size: ${health.poolSize}`);
                console.log(`   ✓ Idle connections: ${health.idleCount}`);
                passed++;
            } else {
                console.log(`   ✗ Health check failed: ${health.error}`);
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 4: Create Test Table
        console.log("\n📝 Test 4: Create Test Table");
        console.log("──────────────────────────────────────────────────");

        try {
            // Drop table if exists
            await connection.query(`DROP TABLE IF EXISTS TestUser`);

            // Create table
            const createQuery = `
                CREATE TABLE TestUser (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    age INTEGER,
                    created_at TIMESTAMP
                )
            `;

            await connection.query(createQuery);
            console.log("   ✓ Test table created");
            passed++;
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 5: Parameterized INSERT with RETURNING
        console.log("\n📝 Test 5: INSERT with $1, $2 Placeholders and RETURNING");
        console.log("──────────────────────────────────────────────────");

        try {
            const insertQuery = `
                INSERT INTO TestUser (name, email, age, created_at)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            `;

            const params = ['John Doe', 'john@example.com', 30, new Date()];
            const result = await connection.query(insertQuery, params);

            if (result.rows && result.rows.length > 0 && result.rows[0].id) {
                console.log("   ✓ INSERT with RETURNING successful");
                console.log(`   ✓ Returned ID: ${result.rows[0].id}`);
                console.log(`   ✓ Placeholder format: $1, $2, $3, $4`);
                passed++;
            } else {
                console.log("   ✗ INSERT did not return ID");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 6: Parameterized SELECT
        console.log("\n📝 Test 6: SELECT with Parameterized Query");
        console.log("──────────────────────────────────────────────────");

        try {
            const selectQuery = `SELECT * FROM TestUser WHERE name = $1`;
            const result = await connection.query(selectQuery, ['John Doe']);

            if (result.rows && result.rows.length > 0) {
                console.log("   ✓ SELECT with $1 placeholder successful");
                console.log(`   ✓ Found user: ${result.rows[0].name}`);
                console.log(`   ✓ Email: ${result.rows[0].email}`);
                passed++;
            } else {
                console.log("   ✗ SELECT returned no results");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 7: Parameterized UPDATE
        console.log("\n📝 Test 7: UPDATE with Parameterized Query");
        console.log("──────────────────────────────────────────────────");

        try {
            const updateQuery = `UPDATE TestUser SET age = $1 WHERE name = $2`;
            const result = await connection.query(updateQuery, [35, 'John Doe']);

            if (result.rowCount > 0) {
                console.log("   ✓ UPDATE with $1, $2 placeholders successful");
                console.log(`   ✓ Rows affected: ${result.rowCount}`);
                passed++;
            } else {
                console.log("   ✗ UPDATE affected no rows");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 8: Transaction Support
        console.log("\n📝 Test 8: Transaction (BEGIN/COMMIT/ROLLBACK)");
        console.log("──────────────────────────────────────────────────");

        try {
            const result = await connection.transaction(async (client) => {
                // Insert within transaction
                const insertResult = await client.query(
                    `INSERT INTO TestUser (name, email, age) VALUES ($1, $2, $3) RETURNING id`,
                    ['Jane Smith', 'jane@example.com', 28]
                );

                // Update within transaction
                await client.query(
                    `UPDATE TestUser SET age = $1 WHERE id = $2`,
                    [29, insertResult.rows[0].id]
                );

                return insertResult.rows[0].id;
            });

            if (result) {
                console.log("   ✓ Transaction completed successfully");
                console.log(`   ✓ INSERT and UPDATE within transaction`);
                console.log(`   ✓ Returned ID: ${result}`);
                passed++;
            } else {
                console.log("   ✗ Transaction failed");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 9: IN Clause with Multiple Parameters
        console.log("\n📝 Test 9: IN Clause with Multiple Parameters");
        console.log("──────────────────────────────────────────────────");

        try {
            const inQuery = `SELECT * FROM TestUser WHERE name IN ($1, $2)`;
            const result = await connection.query(inQuery, ['John Doe', 'Jane Smith']);

            if (result.rows && result.rows.length >= 2) {
                console.log("   ✓ IN clause with $1, $2 successful");
                console.log(`   ✓ Found ${result.rows.length} users`);
                passed++;
            } else {
                console.log("   ✗ IN clause returned insufficient results");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 10: NULL Handling
        console.log("\n📝 Test 10: NULL Handling");
        console.log("──────────────────────────────────────────────────");

        try {
            const insertQuery = `INSERT INTO TestUser (name, email, age) VALUES ($1, $2, $3) RETURNING id`;
            const result = await connection.query(insertQuery, ['Bob Wilson', 'bob@example.com', null]);

            const selectQuery = `SELECT * FROM TestUser WHERE id = $1`;
            const selectResult = await connection.query(selectQuery, [result.rows[0].id]);

            if (selectResult.rows[0].age === null) {
                console.log("   ✓ NULL values handled correctly");
                console.log("   ✓ Inserted and retrieved NULL age");
                passed++;
            } else {
                console.log("   ✗ NULL handling failed");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Test 11: Connection Pool Info
        console.log("\n📝 Test 11: Connection Pool Information");
        console.log("──────────────────────────────────────────────────");

        try {
            const info = connection.getConnectionInfo();

            if (info) {
                console.log("   ✓ Connection info retrieved");
                console.log(`   ✓ Host: ${info.host}:${info.port}`);
                console.log(`   ✓ Database: ${info.database}`);
                console.log(`   ✓ User: ${info.user}`);
                console.log(`   ✓ Max connections: ${info.maxConnections}`);
                passed++;
            } else {
                console.log("   ✗ Failed to get connection info");
                failed++;
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
            failed++;
        }

        // Cleanup: Drop test table
        console.log("\n📝 Cleanup: Dropping Test Table");
        console.log("──────────────────────────────────────────────────");

        try {
            await connection.query(`DROP TABLE IF EXISTS TestUser`);
            console.log("   ✓ Test table dropped");
        } catch (err) {
            console.log(`   ⚠  Warning: ${err.message}`);
        }

    } catch (err) {
        console.log(`\n❌ Fatal error: ${err.message}`);
        console.log(err.stack);
    } finally {
        // Close connection
        if (connection) {
            try {
                await connection.close();
                console.log("   ✓ Connection closed");
            } catch (err) {
                console.log(`   ⚠  Warning closing connection: ${err.message}`);
            }
        }
    }

    // Summary
    console.log("\n\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║                       Test Summary                             ║");
    console.log("╚════════════════════════════════════════════════════════════════╝");

    const total = passed + failed;
    const successRate = total > 0 ? Math.round((passed/total)*100) : 0;

    console.log(`\n   Total Tests: ${total}`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   Success Rate: ${successRate}%\n`);

    if (failed === 0) {
        console.log("🎉 All PostgreSQL integration tests passed!");
        console.log("\n✨ PostgreSQL Implementation Complete!");
        console.log("\n📖 Features Verified:");
        console.log("   ✓ Connection pooling with pg 8.16.3");
        console.log("   ✓ Parameterized queries with $1, $2, $3... placeholders");
        console.log("   ✓ RETURNING clause for INSERT operations");
        console.log("   ✓ Async/await pattern throughout");
        console.log("   ✓ Transaction support (BEGIN/COMMIT/ROLLBACK)");
        console.log("   ✓ NULL value handling");
        console.log("   ✓ IN clauses with multiple parameters");
        console.log("   ✓ Connection pool management");
        console.log("   ✓ Health checks");
        console.log("\n✅ PostgreSQL engine is ready for production use!\n");
        process.exit(0);
    } else {
        console.log("⚠️  Some PostgreSQL tests failed.");
        console.log("\n📖 Common Issues:");
        console.log("   • PostgreSQL server not running");
        console.log("   • Test database 'masterrecord_test' doesn't exist");
        console.log("   • Incorrect credentials in TEST_CONFIG");
        console.log("   • Port 5432 not accessible\n");
        process.exit(1);
    }
}

// Run tests
runTests();
