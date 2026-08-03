import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Deferred to 'warn': the engine internals are legacy var-heavy
            // code; mechanically converting var->let/const and de-duplicating
            // redeclarations across MySQL/Postgres paths that aren't covered
            // by the local (SQLite-only) test run risks silent regressions.
            // Tracked for a dedicated pass.
            'no-var': 'warn',
            'no-redeclare': 'warn',
            // Newly in @eslint/js recommended as of ESLint 10. The codebase has
            // an established catch-and-rethrow style (many intentional re-throws
            // and throws-after-logging); attaching `{ cause }` at every site is
            // a good future improvement but a large mechanical change. Deferred
            // to 'warn' (same treatment as no-var/no-redeclare) so it surfaces
            // without failing lint. Newer code (e.g. Tools.missingTableError)
            // already sets `.cause`.
            'preserve-caught-error': 'warn',
            // Also newly in recommended as of ESLint 10 — flags dead assignments
            // in the legacy var-heavy engine code. Deferred to 'warn' with the
            // same rationale; a dedicated cleanup pass can promote it to 'error'.
            'no-useless-assignment': 'warn',
            'prefer-const': 'error',
            'no-unused-vars': ['error', {
                vars: 'all',
                args: 'after-used',
                ignoreRestSiblings: true,
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
            'no-console': 'off',
            // 'smart' permits the `x == null` null-or-undefined idiom while
            // still flagging other loose comparisons.
            eqeqeq: ['error', 'smart'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
        },
    },
    {
        ignores: ['node_modules/**', '_migrations/**', 'test/**'],
    },
];
