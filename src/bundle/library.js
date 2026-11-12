// @ts-check
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import semver from 'semver';
import { isObject } from './config.js';
import { BundleError } from './errors.js';

/**
 * @typedef {object} LibraryMetadata
 * @property {string[]} loadOrder `.js` paths relative to the library root, in load order.
 * @property {Record<string, string>} peers Optional "used when present" libraries and their ranges.
 */

/**
 * Reads and validates the `gasLibrary` metadata of a fetched library.
 *
 * @param {string} name Configured library name.
 * @param {string} dir Cache directory of the library.
 * @returns {LibraryMetadata}
 * @throws {BundleError} When the metadata is missing, malformed or points at missing or symlinked files.
 */
export function readLibrary(name, dir) {
  /** @type {Record<string, unknown>} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch (error) {
    throw new BundleError(
      `${name}: cannot read package.json from the dist tag: ${/** @type {Error} */ (error).message}`,
    );
  }
  if (pkg.name !== name) {
    throw new BundleError(
      `${name}: the dist tag's package.json is named ${JSON.stringify(pkg.name)}, expected "${name}".`,
    );
  }
  const hint = `${name} needs a release made with gasdev release (or gas-dev-release >= 1.1.0) and gasdev.loadOrder`;
  const meta = pkg.gasLibrary;
  if (
    !isObject(meta) ||
    !Array.isArray(meta.loadOrder) ||
    meta.loadOrder.length === 0
  ) {
    throw new BundleError(
      `${name}: package.json has no gasLibrary.loadOrder; ${hint}.`,
    );
  }
  for (const entry of meta.loadOrder) {
    if (
      typeof entry !== 'string' ||
      !entry.endsWith('.js') ||
      isAbsolute(entry) ||
      entry.split(/[\\/]/).includes('..')
    ) {
      throw new BundleError(
        `${name}: gasLibrary.loadOrder entry ${JSON.stringify(entry)} must be a relative .js path; ${hint}.`,
      );
    }
    if (hasSymlink(dir, entry)) {
      throw new BundleError(
        `${name}: gasLibrary.loadOrder lists ${entry}, which resolves through a symbolic link in the dist tag; ${hint}.`,
      );
    }
    if (!isFile(join(dir, entry))) {
      throw new BundleError(
        `${name}: gasLibrary.loadOrder lists ${entry}, which is missing from the dist tag; ${hint}.`,
      );
    }
  }
  /** @type {Record<string, string>} */
  const peers = {};
  if (meta.peers !== undefined) {
    if (!isObject(meta.peers)) {
      throw new BundleError(`${name}: gasLibrary.peers must be an object.`);
    }
    for (const [peer, range] of Object.entries(meta.peers)) {
      if (typeof range !== 'string' || semver.validRange(range) === null) {
        throw new BundleError(
          `${name}: gasLibrary.peers.${peer} must be a valid semver range.`,
        );
      }
      peers[peer] = range;
    }
  }
  return { loadOrder: /** @type {string[]} */ (meta.loadOrder), peers };
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether any segment of a path below `root` is a symbolic link. Following one would read content
 * the dist tag did not commit, such as local files or the cache metadata.
 *
 * @param {string} root
 * @param {string} path Relative to `root`.
 * @returns {boolean}
 */
function hasSymlink(root, path) {
  let current = root;
  for (const segment of relative(root, join(root, path)).split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Lists every `.d.ts` file below a library directory, recursively, sorted by path.
 *
 * @param {string} name Configured library name.
 * @param {string} dir Cache directory of the library.
 * @returns {string[]} POSIX-style paths relative to `dir`.
 * @throws {BundleError} When a declaration resolves through a symbolic link.
 */
export function listDeclarations(name, dir) {
  const entries = readdirSync(dir, {
    recursive: true,
    encoding: 'utf8',
  }).filter((entry) => entry.endsWith('.d.ts'));
  for (const entry of entries) {
    if (hasSymlink(dir, entry)) {
      throw new BundleError(
        `${name}: ${entry} resolves through a symbolic link in the dist tag.`,
      );
    }
  }
  return entries
    .filter((entry) => isFile(join(dir, entry)))
    .map((entry) => relative(dir, join(dir, entry)).split(sep).join('/'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
