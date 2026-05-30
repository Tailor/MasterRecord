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
