// @ts-check
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { legacyKeyMessage } from '../../legacy-keys.js';
import { DeployError } from '../errors.js';

const KNOWN_KEYS = ['title', 'steps'];

/**
 * @typedef {object} DeployConfig
 * @property {Record<string, unknown> & { name: string }} pkg The project's package.json.
 * @property {string} title Apps Script project title.
 * @property {Record<string, unknown>} claspTemplate Parsed `.clasp.example.json`.
 * @property {Record<string, unknown>} manifestTemplate Parsed `appsscript.example.json`.
 * @property {string | undefined} stepsPath Absolute path of the project-defined steps module.
 * @property {string} rootDir Manifest directory, relative to the project (default `.`).
 * @property {{ env: string, clasp: string, manifest: string, claspTemplate: string, manifestTemplate: string }} paths
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads and parses a JSON object file.
 *
 * @param {string} path
 * @param {string} label File name used in messages.
 * @returns {Record<string, unknown>}
 * @throws {DeployError} If the file is missing, not valid JSON or not an object.
 */
function readJsonObject(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new DeployError(`${label} not found.`, { cause: error });
    }
    throw new DeployError(`Cannot read ${label}: ${errorMessage(error)}.`, {
      cause: error,
    });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new DeployError(
      `${label} is not valid JSON: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isObject(data)) {
    throw new DeployError(`${label} must contain a JSON object.`);
  }
  return data;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates the `gasdev.ci` package.json key.
 *
 * @param {unknown} options
 * @param {string} cwd Project root, used to resolve and check `steps`.
 * @returns {{ title: string | undefined, stepsPath: string | undefined }}
 * @throws {DeployError} Naming the offending key.
 */
function validateOptions(options, cwd) {
  if (options === undefined) {
    return { title: undefined, stepsPath: undefined };
  }
  if (!isObject(options)) {
    throw new DeployError('gasdev.ci must be an object.');
  }
  const unknown = Object.keys(options).find((k) => !KNOWN_KEYS.includes(k));
  if (unknown !== undefined) {
    throw new DeployError(`gasdev.ci.${unknown} is not a known option.`);
  }
  const { title } = options;
  if (
    title !== undefined &&
    (typeof title !== 'string' || title.trim() === '')
  ) {
    throw new DeployError('gasdev.ci.title must be a non-empty string.');
  }
  return { title, stepsPath: validateSteps(options.steps, cwd) };
}

/**
 * Validates `gasdev.ci.steps`: a relative `.js`/`.mjs` file inside the project.
 *
 * @param {unknown} value
 * @param {string} cwd
 * @returns {string | undefined} The absolute path.
 * @throws {DeployError} If the value is invalid or the file does not exist.
 */
function validateSteps(value, cwd) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeployError('gasdev.ci.steps must be a non-empty string.');
  }
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new DeployError(
      `gasdev.ci.steps "${value}" must be a relative path inside the project.`,
    );
  }
  if (!/\.m?js$/.test(value)) {
    throw new DeployError(
      `gasdev.ci.steps "${value}" must end in .js or .mjs.`,
    );
  }
  const path = resolve(cwd, value);
  let isFile = false;
  try {
    isFile = statSync(path).isFile();
  } catch {
    // Reported below.
  }
  if (!isFile) {
    throw new DeployError(`gasdev.ci.steps file "${value}" not found.`);
  }
  return path;
}

/**
 * Validates the template's `rootDir`: relative and inside the project.
 *
 * @param {unknown} value
 * @returns {string}
 * @throws {DeployError} If it is not a string, is absolute or contains `..`.
 */
function validateRootDir(value) {
  if (value === undefined) {
    return '.';
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeployError(
      '.clasp.example.json rootDir must be a non-empty string.',
    );
  }
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new DeployError(
      `.clasp.example.json rootDir "${value}" must be a relative path inside the project.`,
    );
  }
  return value;
}

/**
 * Loads the project's package.json, `gasdev.ci` options and templates.
 *
 * @param {string} cwd Project root.
 * @returns {DeployConfig}
 * @throws {DeployError} On any invalid or missing input.
 */
export function loadConfig(cwd) {
  const pkg = readJsonObject(join(cwd, 'package.json'), 'package.json');
  if (typeof pkg.name !== 'string' || pkg.name === '') {
    throw new DeployError('package.json has no "name".');
  }
  const legacy = legacyKeyMessage(pkg);
  if (legacy) {
    throw new DeployError(legacy);
  }
  const root = /** @type {{ ci?: unknown } | undefined} */ (pkg.gasdev);
  const { title, stepsPath } = validateOptions(root?.ci, cwd);

  const paths = {
    env: join(cwd, '.env'),
    clasp: join(cwd, '.clasp.json'),
    claspTemplate: join(cwd, '.clasp.example.json'),
    manifestTemplate: join(cwd, 'appsscript.example.json'),
    manifest: '',
  };
  const claspTemplate = readJsonObject(
    paths.claspTemplate,
    '.clasp.example.json',
  );
  const manifestTemplate = readJsonObject(
    paths.manifestTemplate,
    'appsscript.example.json',
  );
  const rootDir = validateRootDir(claspTemplate.rootDir);
  paths.manifest = join(cwd, rootDir, 'appsscript.json');

  return {
    pkg: /** @type {DeployConfig['pkg']} */ (pkg),
    title: title ?? pkg.name,
    claspTemplate,
    manifestTemplate,
    stepsPath,
    rootDir,
    paths,
  };
}
