/**
 * Resolve live MySQL / Postgres connection targets for the cross-engine
 * integration suite from environment variables.
 *
 * Set a connection URL to opt in:
 *   MR_TEST_MYSQL_URL=mysql://user:pass@host:3306/dbname
 *   MR_TEST_PG_URL=postgres://user:pass@host:5432/dbname   (or MR_TEST_POSTGRES_URL)
 *
 * When a variable is unset the corresponding suite is skipped, so the default
 * `npm test` stays SQLite-only and offline. CI sets these to point at service
 * containers so every engine path is executed for real.
 *
 * Returns a masterrecord env-config object ({ type, host, port, user,
 * password, database }) or null when the URL is not provided.
 */

function parseUrl(urlStr, type, defaultPort) {
    const u = new URL(urlStr);
    return {
        type,
        host: u.hostname || 'localhost',
        port: u.port ? Number(u.port) : defaultPort,
        user: decodeURIComponent(u.username || ''),
        password: decodeURIComponent(u.password || ''),
        database: u.pathname.replace(/^\//, '') || undefined,
    };
}

export function mysqlTarget() {
    const url = process.env.MR_TEST_MYSQL_URL;
    return url ? parseUrl(url, 'mysql', 3306) : null;
}

export function postgresTarget() {
    const url = process.env.MR_TEST_PG_URL || process.env.MR_TEST_POSTGRES_URL;
    return url ? parseUrl(url, 'postgres', 5432) : null;
}
