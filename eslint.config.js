import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
            },
        },
        rules: {
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['error', {
                vars: 'all',
                args: 'after-used',
                ignoreRestSiblings: true,
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            'no-console': 'off',
            eqeqeq: ['error', 'always'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
        },
    },
    {
        ignores: ['node_modules/**', '_migrations/**', 'test/**'],
    },
];
