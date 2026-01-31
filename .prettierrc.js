/**
 * Prettier Configuration - FAANG Standards
 * Based on Meta/Google style guides
 */

module.exports = {
    // ========================================================================
    // BASIC FORMATTING
    // ========================================================================

    // Line width (Google: 80-120, Meta: 80)
    printWidth: 100,

    // Tab width (Google standard: 4 spaces for JS, Meta uses 2)
    // Using 4 for consistency with Google
    tabWidth: 4,

    // Use spaces, not tabs
    useTabs: false,

    // Semicolons required (Google/Meta standard)
    semi: true,

    // Single quotes (Google/Meta standard)
    singleQuote: true,

    // Quote object properties only when needed
    quoteProps: 'as-needed',

    // ========================================================================
    // TRAILING COMMAS (Meta standard)
    // ========================================================================

    // Trailing commas where valid in ES5 (objects, arrays, etc.)
    // Meta uses 'all', Google uses 'es5'
    trailingComma: 'es5',

    // ========================================================================
    // SPACING
    // ========================================================================

    // Spaces inside object braces
    bracketSpacing: true,

    // Spaces inside array brackets
    bracketSameLine: false,

    // Arrow function parens (Google: avoid when possible)
    arrowParens: 'avoid',

    // ========================================================================
    // LINE BREAKS
    // ========================================================================

    // End of line (Unix standard)
    endOfLine: 'lf',

    // Wrap prose (for markdown files)
    proseWrap: 'preserve',

    // ========================================================================
    // HTML/JSX (if used)
    // ========================================================================

    // HTML whitespace sensitivity
    htmlWhitespaceSensitivity: 'css',

    // Self-closing tags
    singleAttributePerLine: false,

    // ========================================================================
    // FILE-SPECIFIC OVERRIDES
    // ========================================================================

    overrides: [
        // Markdown files - wrap at 80
        {
            files: '*.md',
            options: {
                printWidth: 80,
                proseWrap: 'always',
            },
        },

        // JSON files - 2 space indent
        {
            files: '*.json',
            options: {
                tabWidth: 2,
            },
        },

        // YAML files - 2 space indent
        {
            files: ['*.yml', '*.yaml'],
            options: {
                tabWidth: 2,
            },
        },

        // Package.json - 2 space indent (npm standard)
        {
            files: 'package.json',
            options: {
                tabWidth: 2,
            },
        },
    ],
};
