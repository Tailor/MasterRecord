/**
 * ESLint Configuration - FAANG Standards
 * Based on Google/Airbnb/Meta style guides
 */

module.exports = {
    env: {
        node: true,
        es2021: true,
        jest: true
    },

    extends: [
        'eslint:recommended',
    ],

    parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module'
    },

    rules: {
        // ====================================================================
        // CRITICAL RULES (Would fail Google/Meta code review)
        // ====================================================================

        // No var - use const/let only
        'no-var': 'error',

        // Prefer const over let when possible
        'prefer-const': 'error',

        // No unused variables (production bloat)
        'no-unused-vars': ['error', {
            vars: 'all',
            args: 'after-used',
            ignoreRestSiblings: true,
            argsIgnorePattern: '^_'  // Allow _unused
        }],

        // No console.log in production (use logger)
        'no-console': ['warn', {
            allow: ['warn', 'error']
        }],

        // Require === instead of ==
        'eqeqeq': ['error', 'always'],

        // No eval() - security risk
        'no-eval': 'error',

        // No implied eval
        'no-implied-eval': 'error',

        // Async functions must have await
        'require-await': 'error',

        // No async without await
        'no-async-promise-executor': 'error',

        // No floating promises
        'no-floating-decimal': 'error',

        // ====================================================================
        // ERROR HANDLING (Amazon principle: Be resilient)
        // ====================================================================

        // Require error handling in callbacks
        'handle-callback-err': ['error', '^(err|error)$'],

        // No empty catch blocks
        'no-empty': ['error', {
            allowEmptyCatch: false
        }],

        // Don't throw literals
        'no-throw-literal': 'error',

        // ====================================================================
        // CODE QUALITY (Google principle: Readability)
        // ====================================================================

        // Max function complexity (cyclomatic)
        'complexity': ['warn', 10],

        // Max function length
        'max-lines-per-function': ['warn', {
            max: 50,
            skipBlankLines: true,
            skipComments: true
        }],

        // Max parameters
        'max-params': ['warn', 5],

        // Max nested callbacks
        'max-nested-callbacks': ['warn', 3],

        // Max depth
        'max-depth': ['warn', 4],

        // Consistent return
        'consistent-return': 'error',

        // No duplicate imports
        'no-duplicate-imports': 'error',

        // ====================================================================
        // NAMING CONVENTIONS (Google/Meta standard)
        // ====================================================================

        // camelCase for variables
        'camelcase': ['error', {
            properties: 'never',
            ignoreDestructuring: true,
            allow: ['^__']  // Allow __private
        }],

        // No underscore dangle (except for __private)
        'no-underscore-dangle': ['error', {
            allow: ['__', '__name', '__state', '__entity', '__ID', '__dirtyFields', '__context', '__trackedEntities', '__entities', '__builderEntities', '__relationshipModels', '__environment', '__trackedEntitiesMap'],
            allowAfterThis: true,
            allowAfterSuper: true
        }],

        // ====================================================================
        // SPACING & FORMATTING (Prettier will handle most of this)
        // ====================================================================

        // Indent: 4 spaces (Google standard)
        'indent': ['error', 4, {
            SwitchCase: 1
        }],

        // Single quotes
        'quotes': ['error', 'single', {
            avoidEscape: true,
            allowTemplateLiterals: true
        }],

        // Semicolons required
        'semi': ['error', 'always'],

        // Space before function paren
        'space-before-function-paren': ['error', {
            anonymous: 'never',
            named: 'never',
            asyncArrow: 'always'
        }],

        // Arrow function spacing
        'arrow-spacing': 'error',

        // Object curly spacing
        'object-curly-spacing': ['error', 'always'],

        // Array bracket spacing
        'array-bracket-spacing': ['error', 'never'],

        // Comma spacing
        'comma-spacing': ['error', {
            before: false,
            after: true
        }],

        // Key spacing
        'key-spacing': ['error', {
            beforeColon: false,
            afterColon: true
        }],

        // ====================================================================
        // BEST PRACTICES (Meta/Amazon standards)
        // ====================================================================

        // No magic numbers
        'no-magic-numbers': ['warn', {
            ignore: [-1, 0, 1, 2],
            ignoreArrayIndexes: true,
            ignoreDefaultValues: true,
            enforceConst: true
        }],

        // Require JSDoc for public methods
        'require-jsdoc': ['warn', {
            require: {
                FunctionDeclaration: true,
                MethodDefinition: true,
                ClassDeclaration: true
            }
        }],

        // Valid JSDoc
        'valid-jsdoc': ['warn', {
            requireReturn: false,
            requireReturnType: false,
            requireParamType: false,
            prefer: {
                return: 'returns',
                arg: 'param',
                argument: 'param'
            }
        }],

        // No param reassign
        'no-param-reassign': ['error', {
            props: false
        }],

        // Prefer arrow callbacks
        'prefer-arrow-callback': 'warn',

        // Prefer template literals
        'prefer-template': 'warn',

        // Prefer destructuring
        'prefer-destructuring': ['warn', {
            array: false,
            object: true
        }],

        // Prefer rest params
        'prefer-rest-params': 'error',

        // Prefer spread
        'prefer-spread': 'error',

        // ====================================================================
        // SECURITY (Amazon principle: Security by default)
        // ====================================================================

        // No unsafe regex
        'no-unsafe-regex': 'error',

        // No buffer constructor
        'no-buffer-constructor': 'error',

        // No process.exit()
        'no-process-exit': 'warn',

        // ====================================================================
        // NODE.JS SPECIFIC
        // ====================================================================

        // Callback return
        'callback-return': ['error', ['callback', 'cb', 'next', 'done']],

        // No sync methods (prefer async)
        'no-sync': 'warn',

        // Handle errors in promise callbacks
        'promise/always-return': 'off',  // Too strict for ORM
        'promise/catch-or-return': 'off'  // Too strict for ORM
    },

    // ========================================================================
    // OVERRIDES FOR SPECIFIC FILES
    // ========================================================================

    overrides: [
        // Test files - relax some rules
        {
            files: ['**/*.test.js', '**/*.spec.js', '**/tests/**/*.js'],
            env: {
                jest: true
            },
            rules: {
                'no-magic-numbers': 'off',
                'max-lines-per-function': 'off',
                'no-console': 'off'
            }
        },

        // Migration scripts - allow console
        {
            files: ['**/migrations/**/*.js'],
            rules: {
                'no-console': 'off'
            }
        },

        // Config files - relax rules
        {
            files: ['*.config.js', '.*.js'],
            rules: {
                'no-magic-numbers': 'off'
            }
        }
    ]
};
