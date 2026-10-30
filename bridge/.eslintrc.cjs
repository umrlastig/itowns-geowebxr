// Standalone Node.js tool (not bundled with the web app)
module.exports = {
    env: { node: true, browser: false },
    rules: {
        // CommonJS config file
        '@typescript-eslint/no-require-imports': 'off',
    },
};
