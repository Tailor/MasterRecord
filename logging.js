/**
 * Central, pluggable logging — EF Core's LogTo()/ILogger integration with
 * EF's default of NOT logging parameter values (EnableSensitiveDataLogging
 * opts in).
 *
 * Defaults (all overridable via configureLogging() or env):
 *   logSql        : false, or LOG_SQL=true            — log every SQL command
 *   sensitiveData : false, or MR_SENSITIVE_LOGGING=true — show parameter values
 *                   (otherwise each value is redacted to '?')
 *   slowQueryMs   : 0 (off), or MR_SLOW_QUERY_MS=<n>    — warn when a command
 *                   exceeds n ms, even if logSql is off
 *   migrations    : true unless MR_SILENT_MIGRATIONS=true — log migration DDL
 *   level         : 'info' | 'debug' | 'warn' | 'error' (min level), default 'info'
 *   logger        : { debug, info, warn, error } — default console
 *
 * Previously SQL (with parameter values) was printed whenever NODE_ENV was
 * not 'production'. That leaked PII into dev logs and was noisy; like EF,
 * nothing is logged now unless you ask, and values are redacted unless you
 * opt in.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const state = {
    logger: console,
    level: 'info',
    logSql: process.env.LOG_SQL === 'true',
    sensitiveData: process.env.MR_SENSITIVE_LOGGING === 'true',
    slowQueryMs: Number(process.env.MR_SLOW_QUERY_MS) > 0 ? Number(process.env.MR_SLOW_QUERY_MS) : 0,
    migrations: process.env.MR_SILENT_MIGRATIONS !== 'true',
};

function configureLogging(options = {}) {
    if (options.logger !== undefined) {
        const l = options.logger;
        if (l !== null && (typeof l !== 'object' && typeof l !== 'function')) {
            throw new TypeError('masterrecord: configureLogging({ logger }) expects an object with debug/info/warn/error.');
        }
        state.logger = l || console;
    }
    if (options.level !== undefined) {
        if (!(options.level in LEVELS)) throw new TypeError(`masterrecord: unknown log level ${JSON.stringify(options.level)}`);
        state.level = options.level;
    }
    if (options.logSql !== undefined) state.logSql = !!options.logSql;
    if (options.sensitiveData !== undefined) state.sensitiveData = !!options.sensitiveData;
    if (options.slowQueryMs !== undefined) state.slowQueryMs = Number(options.slowQueryMs) > 0 ? Number(options.slowQueryMs) : 0;
    if (options.migrations !== undefined) state.migrations = !!options.migrations;
    return getLoggingConfig();
}

function getLoggingConfig() {
    return { level: state.level, logSql: state.logSql, sensitiveData: state.sensitiveData, slowQueryMs: state.slowQueryMs, migrations: state.migrations };
}

function enabled(level) {
    return (LEVELS[level] || 0) >= (LEVELS[state.level] || 0);
}

function emit(level, message, data) {
    if (!enabled(level)) return;
    const l = state.logger || console;
    const fn = (typeof l[level] === 'function') ? l[level] : (typeof l.log === 'function' ? l.log : null);
    if (!fn) return;
    try { data === undefined ? fn.call(l, message) : fn.call(l, message, data); } catch (_) { /* never let logging break the ORM */ }
}

/** Parameter values are PII until proven otherwise — redact unless opted in. */
function redactParams(params) {
    if (!params || params.length === 0) return params;
    if (state.sensitiveData) return params;
    return params.map(() => '?');
}

function compact(sql) {
    return typeof sql === 'string' ? sql.replace(/\s+/g, ' ').trim() : sql;
}

/**
 * Called by every engine for every command: { sql, params, durationMs, engine,
 * error?, migration? }. Decides what to log based on config.
 */
function logCommand(info) {
    if (!info) return;
    const { sql, params, durationMs, engine, error, migration } = info;
    const ms = typeof durationMs === 'number' ? Math.round(durationMs * 100) / 100 : undefined;
    const shown = redactParams(params);
    const tag = migration ? '[masterrecord:migration]' : `[masterrecord:sql${engine ? ':' + engine : ''}]`;

    if (error) {
        emit('error', `${tag} FAILED (${ms}ms) ${compact(sql)}`, { params: shown, error: error.message });
        return;
    }
    if (migration) {
        if (state.migrations) emit('info', `${tag} ${compact(sql)}`, shown && shown.length ? { params: shown } : undefined);
        return;
    }
    if (state.slowQueryMs > 0 && ms !== undefined && ms >= state.slowQueryMs) {
        emit('warn', `${tag} SLOW ${ms}ms (threshold ${state.slowQueryMs}ms) ${compact(sql)}`, shown && shown.length ? { params: shown } : undefined);
        if (!state.logSql) return;
    }
    if (state.logSql) {
        emit('debug', `${tag} (${ms}ms) ${compact(sql)}`, shown && shown.length ? { params: shown } : undefined);
    }
}

/** General-purpose logging for non-command messages (cache, migrations, warnings). */
function log(level, message, data) { emit(level, message, data); }

export { configureLogging, getLoggingConfig, logCommand, log, redactParams };
