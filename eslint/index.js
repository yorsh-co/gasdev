// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * @typedef {object} WebOptions
 * @property {string[]} files Glob patterns of browser (DOM) sources.
 * @property {string} tsconfig tsconfig used for type-aware linting of those files.
 */

/**
 * @typedef {object} GasEslintOptions
 * @property {'gas' | 'node'} [preset] `gas` (default) lints Google Apps Script
 *   TypeScript projects; `node` lints plain JavaScript Node tooling.
 * @property {string[]} [ignores] Extra ignore globs, added to the preset's.
 * @property {WebOptions} [web] Browser sources, linted apart from GAS files (`gas` preset only).
 * @property {string} [cwd] Project root used to detect `tsconfig.test.json` and `gas-test/tsconfig.json`; defaults to `process.cwd()`.
 */

/** @typedef {import('eslint').Linter.Config} FlatConfig */

const KNOWN_OPTIONS = ['preset', 'ignores', 'web', 'cwd'];
const PRESETS = ['gas', 'node'];

/** Globals defined by `gasdev/gas-test`'s runtime. */
const GAS_TEST_GLOBALS = /** @type {const} */ ({
  test: 'readonly',
  info: 'readonly',
  assert: 'readonly',
  runGasTests: 'readonly',
});

/**
 * Apps Script's push-time parser rejects `async` and `await`, which
 * TypeScript emits unchanged at the ES2020 target. Applied to Apps Script
 * blocks only; a later `no-restricted-syntax` entry for the same files
 * replaces it, so extra configs must repeat these selectors.
 */
const NO_ASYNC_MESSAGE =
  'Apps Script rejects async/await on push; Apps Script code must be synchronous.';
/** @type {import('eslint').Linter.RulesRecord} */
const noAsyncRule = {
  'no-restricted-syntax': [
    'error',
    ...[
      ':function[async=true]',
      'AwaitExpression',
      'ForOfStatement[await=true]',
    ].map((selector) => ({ selector, message: NO_ASYNC_MESSAGE })),
  ],
};

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validates user options, throwing a `TypeError` that names the offending option.
 *
 * @param {unknown} options
 * @returns {asserts options is GasEslintOptions}
 */
function validate(options) {
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError('gasEslint: options must be an object');
  }
  const opts = /** @type {Record<string, unknown>} */ (options);
  for (const key of Object.keys(opts)) {
    if (!KNOWN_OPTIONS.includes(key)) {
      throw new TypeError(`gasEslint: unknown option "${key}"`);
    }
  }
  if (
    opts.preset !== undefined &&
    !PRESETS.includes(/** @type {string} */ (opts.preset))
  ) {
    throw new TypeError(
      `gasEslint: option "preset" must be one of ${PRESETS.join(', ')}`,
    );
  }
  if (opts.ignores !== undefined && !isStringArray(opts.ignores)) {
    throw new TypeError(
      'gasEslint: option "ignores" must be an array of strings',
    );
  }
  if (opts.cwd !== undefined && typeof opts.cwd !== 'string') {
    throw new TypeError('gasEslint: option "cwd" must be a string');
  }
  if (opts.web !== undefined) {
    const web = opts.web;
    if (typeof web !== 'object' || web === null || Array.isArray(web)) {
      throw new TypeError('gasEslint: option "web" must be an object');
    }
    const { files, tsconfig, ...rest } =
      /** @type {Record<string, unknown>} */ (web);
    const unknown = Object.keys(rest)[0];
    if (unknown !== undefined) {
      throw new TypeError(`gasEslint: unknown option "web.${unknown}"`);
    }
    if (!isStringArray(files) || files.length === 0) {
      throw new TypeError(
        'gasEslint: option "web.files" must be a non-empty array of strings',
      );
    }
    if (typeof tsconfig !== 'string' || tsconfig === '') {
      throw new TypeError(
        'gasEslint: option "web.tsconfig" must be a non-empty string',
      );
    }
    if (opts.preset === 'node') {
      throw new TypeError(
        'gasEslint: option "web" is not supported by the "node" preset',
      );
    }
  }
}

/**
 * Builds the flat ESLint config for a gas-* project.
 *
 * @param {GasEslintOptions} [options]
 * @param {...FlatConfig} extra Additional flat configs, applied before Prettier.
 * @returns {FlatConfig[]}
 */
export function gasEslint(options = {}, ...extra) {
  validate(options);
  const { preset = 'gas', ignores = [], web, cwd = process.cwd() } = options;

  if (preset === 'node') {
    return defineConfig(
      {
        ignores: [
          '.worktrees/**',
          '.claude/worktrees/**',
          'node_modules/**',
          ...ignores,
        ],
      },
      eslint.configs.recommended,
      // Node.js CLI, library and tests — ESM with Node globals.
      {
        files: ['**/*.js'],
        languageOptions: { sourceType: 'module', globals: globals.node },
      },
      ...extra,
      eslintConfigPrettier,
    );
  }

  const unusedVarsOff = /** @type {const} */ ({
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
  });
  const hasTestConfig = existsSync(resolve(cwd, 'tsconfig.test.json'));
  const hasGasTestConfig = existsSync(resolve(cwd, 'gas-test/tsconfig.json'));

  return defineConfig(
    // peer/ holds ambient declarations for consumers to copy; it is outside
    // tsconfig's `include`, so project-based linting cannot resolve it.
    {
      ignores: [
        'dist/**',
        '.worktrees/**',
        '.claude/worktrees/**',
        'peer/**',
        ...ignores,
      ],
    },

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    // Backend GAS files
    {
      files: ['src/**/*.ts'],
      ...(web && { ignores: web.files }),
      languageOptions: {
        sourceType: 'script', // no import/export — GAS files share one global scope
        parserOptions: { project: './tsconfig.json' },
      },
      rules: { ...unusedVarsOff, ...noAsyncRule },
    },

    // Frontend (DOM lib, no GAS types)
    ...(web
      ? [
          {
            files: web.files,
            languageOptions: {
              sourceType: /** @type {const} */ ('script'),
              globals: globals.browser,
              parserOptions: { project: web.tsconfig },
            },
            rules: unusedVarsOff,
          },
        ]
      : []),

    // Test suite — ES modules running on Node.
    ...(hasTestConfig
      ? [
          {
            files: ['test/**/*.ts'],
            languageOptions: {
              sourceType: /** @type {const} */ ('module'),
              globals: globals.node,
              parserOptions: { project: './tsconfig.test.json' },
            },
          },
        ]
      : []),

    // Apps Script tests — global scripts like src/, plus the test runtime globals.
    ...(hasGasTestConfig
      ? [
          {
            files: ['gas-test/**/*.ts'],
            languageOptions: {
              sourceType: /** @type {const} */ ('script'),
              globals: GAS_TEST_GLOBALS,
              parserOptions: { project: './gas-test/tsconfig.json' },
            },
            rules: { ...unusedVarsOff, ...noAsyncRule },
          },
        ]
      : []),

    // Node.js build scripts — ESM, full Node globals, no TS project linting.
    {
      files: ['scripts/**/*.js'],
      languageOptions: { sourceType: 'module', globals: globals.node },
    },

    ...extra,
    eslintConfigPrettier,
  );
}
