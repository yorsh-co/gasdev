// @ts-check
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import semver from 'semver';
import { legacyKeyMessage } from '../legacy-keys.js';
import { BundleError } from './errors.js';

/**
 * @typedef {object} LibraryConfig
 * @property {string} version Semver range matched against the library's `dist/vX.Y.Z` tags.
 * @property {string} repository Git URL or path of the library repository.
 */

/**
 * @typedef {object} BundleConfig
 * @property {Record<string, LibraryConfig>} libraries Libraries by name, in config order.
 * @property {string} outFile Bundle path relative to the project root.
 * @property {string} [typesFile] Declarations path relative to the project root.
 */

export const DEFAULT_OUT_FILE = 'src/gas-libraries.js';
const DEFAULT_ORG = 'https://github.com/yorsh-co';
const GITHUB_PATTERN =
  /^(?:git\+)?(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:|github:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const CONFIG_KEYS = ['libraries', 'outFile', 'typesFile'];
const LIBRARY_KEYS = ['version', 'repository'];

/**
 * Browsable documentation link for a released library version. GitHub
 * repositories map to the version-pinned dist tag; any other repository is
 * returned as configured with URL credentials (userinfo) removed.
 *
 * @param {string} repository
 * @param {string} version
 * @returns {string}
 */
export function docsUrl(repository, version) {
  const match = GITHUB_PATTERN.exec(repository);
  return match
    ? `https://github.com/${match[1]}/${match[2]}/tree/dist/v${version}`
    : repository.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} object
 * @param {string[]} known
 * @param {string} path
 */
function rejectUnknownKeys(object, known, path) {
  for (const key of Object.keys(object)) {
    if (!known.includes(key)) {
      throw new BundleError(`${path}.${key} is not a known option.`);
    }
  }
}

/**
 * Validates and normalizes the `libraries` map.
 *
 * @param {unknown} libraries A map of name to a range string or `{ version, repository? }`.
 * @param {string} path Key path used in error messages.
 * @param {boolean} [allowEmpty] Whether an empty map is valid.
 * @returns {Record<string, LibraryConfig>}
 * @throws {BundleError} On any invalid entry.
 */
export function normalizeLibraries(libraries, path, allowEmpty = false) {
  if (!isObject(libraries)) {
    throw new BundleError(
      `${path} must be ${allowEmpty ? 'an' : 'a non-empty'} object.`,
    );
  }
  if (!allowEmpty && Object.keys(libraries).length === 0) {
    throw new BundleError(`${path} must be a non-empty object.`);
  }
  /** @type {Record<string, LibraryConfig>} */
  const result = {};
  for (const [name, entry] of Object.entries(libraries)) {
    const entryPath = `${path}.${name}`;
    if (!NAME_PATTERN.test(name)) {
      throw new BundleError(
        `${path}: "${name}" is not a valid library name (expected ${NAME_PATTERN}).`,
      );
    }
    let version = entry;
    let repository = `${DEFAULT_ORG}/${name}.git`;
    if (isObject(entry)) {
      rejectUnknownKeys(entry, LIBRARY_KEYS, entryPath);
      version = entry.version;
      if (entry.repository !== undefined) {
        if (typeof entry.repository !== 'string' || entry.repository === '') {
          throw new BundleError(
            `${entryPath}.repository must be a non-empty string.`,
          );
        }
        repository = entry.repository;
      }
    }
    const versionPath = isObject(entry) ? `${entryPath}.version` : entryPath;
    if (typeof version !== 'string' || semver.validRange(version) === null) {
      throw new BundleError(
        `${versionPath} must be a valid semver range, got ${JSON.stringify(version)}.`,
      );
    }
    result[name] = { version, repository };
  }
  return result;
}

/**
 * @param {unknown} value
 * @param {string} path Key path used in error messages.
 * @param {string} extension Required file extension, e.g. `.js`.
 * @returns {string}
 */
function validateFilePath(value, path, extension) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes('..')
  ) {
    throw new BundleError(
      `${path} must be a relative path without "..", got ${JSON.stringify(value)}.`,
    );
  }
  if (!value.endsWith(extension)) {
    throw new BundleError(`${path} must end with ${extension}.`);
  }
  return value;
}

/**
 * Reads and validates `gasdev.bundle` from the project's package.json.
 *
 * @param {string} cwd Project root.
 * @returns {BundleConfig}
 * @throws {BundleError} When package.json is unreadable or the configuration is invalid.
 */
export function loadConfig(cwd) {
  const file = join(cwd, 'package.json');
  /** @type {Record<string, unknown>} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BundleError(
      `Cannot read package.json in ${cwd}: ${/** @type {Error} */ (error).message}`,
    );
  }
  const legacy = legacyKeyMessage(pkg);
  if (legacy) {
    throw new BundleError(legacy);
  }
  const parent = pkg.gasdev;
  const config = isObject(parent) ? parent.bundle : undefined;
  if (!isObject(config)) {
    throw new BundleError('package.json has no "gasdev.bundle" object.');
  }
  rejectUnknownKeys(config, CONFIG_KEYS, 'gasdev.bundle');
  /** @type {BundleConfig} */
  const result = {
    libraries: normalizeLibraries(config.libraries, 'gasdev.bundle.libraries'),
    outFile:
      config.outFile === undefined
        ? DEFAULT_OUT_FILE
        : validateFilePath(config.outFile, 'gasdev.bundle.outFile', '.js'),
  };
  if (config.typesFile !== undefined) {
    result.typesFile = validateFilePath(
      config.typesFile,
      'gasdev.bundle.typesFile',
      '.d.ts',
    );
  }
  return result;
}
