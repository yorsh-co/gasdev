import { gasEslint } from './eslint/index.js';

export default gasEslint(
  { preset: 'node', ignores: ['test/fixtures/**', 'templates/gas/files/**'] },
  // The Apps Script test runtime is a global script, not a Node module.
  {
    files: ['gas-test/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        console: 'readonly',
        PropertiesService: 'readonly',
        SpreadsheetApp: 'readonly',
        Utilities: 'readonly',
      },
    },
    rules: { 'no-unused-vars': 'off' },
  },
);
