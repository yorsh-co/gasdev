// @ts-check
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { legacyKeyMessage } from '../legacy-keys.js';
import { ReleaseError } from './errors.js';

/**
 * @typedef {object} Include
 * @property {string} from Build directory, relative to the project root.
 * @property {string} to Destination directory, relative to the branch root.
 * @property {string[]} hide Globs of files in `from` that are never shipped.
 */

/**
 * @typedef {object} FileEntry
 * @property {string} src Project-root file, relative to the project root.
 * @property {string} dest Destination path, relative to the branch root.
 */

/**
 * @typedef {object} Target
 * @property {string} branch Release branch; also the release tag prefix.
 * @property {string} from Build directory, relative to the project root, copied to the branch root.
 * @property {string[]} hide Globs of build files that are never shipped.
 * @property {string[]} exclude Globs of `from` subpaths skipped entirely; a trailing `/` matches directories only.
 * @property {Include[]} include Extra build trees copied into the branch.
 * @property {FileEntry[]} files Project-root files copied into the branch.
 * @property {boolean} packageJson Whether to write the trimmed package.json.
 */

/**
 * @typedef {object} ReleaseConfig
 * @property {string} remote Remote that receives the branches and tags.
 * @property {string} version The project's version.
 * @property {Record<string, unknown>} pkg The project's package.json.
 * @property {Target[]} targets Resolved release targets.
 * @property {boolean} githubRelease Whether to create a GitHub Release for `vX.Y.Z` after the push.
 * @property {string[]} [loadOrder] `gasdev.loadOrder`: `.ts` paths relative to `src/`, in load order.
 * @property {Record<string, string>} [peers] `gasdev.peers`: optional libraries and their version ranges.
 */

const DEFAULT_FILES = ['README.md', 'LICENSE.md', 'CHANGELOG.md'];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects keys that are not known options, so typos do not silently fall back to defaults.
 *
 * @param {Record<string, unknown>} object
 * @param {string[]} known
 * @param {string} key Path of the object, for the error message.
 * @returns {void}
 * @throws {ReleaseError} Naming the first unknown key.
 */
function rejectUnknownKeys(object, known, key) {
  const unknown = Object.keys(object).find((name) => !known.includes(name));
  if (unknown !== undefined) {
    throw new ReleaseError(`${key}.${unknown} is not a known option.`);
  }
}

/**
 * @param {unknown} value
 * @param {string} key Config key, for the error message.
 * @param {string[]} fallback
 * @returns {string[]}
 * @throws {ReleaseError} When the value is set but not an array of strings.
 */
function stringArray(value, key, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ReleaseError(`${key} must be an array of strings.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} key Config key, for the error message.
 * @returns {string}
 * @throws {ReleaseError} When the value is not a non-empty string.
 */
function requiredString(value, key) {
  if (typeof value !== 'string' || value === '') {
    throw new ReleaseError(`${key} must be a non-empty string.`);
  }
  return value;
}

/**
 * Rejects absolute paths and paths that climb out of the branch root.
 *
 * @param {string} path
 * @param {string} key Config key, for the error message.
 * @returns {string}
 * @throws {ReleaseError}
 */
function insideBranch(path, key) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new ReleaseError(`${key} must be a path inside the branch: ${path}`);
  }
  return path;
}

/**
 * @param {unknown} value
 * @param {string} key Config key, for the error message.
 * @returns {Include}
 * @throws {ReleaseError}
 */
function resolveInclude(value, key) {
  if (!isObject(value)) {
    throw new ReleaseError(`${key} must be an object with "from" and "to".`);
  }
  rejectUnknownKeys(value, ['from', 'to', 'hide'], key);
  return {
    from: requiredString(value.from, `${key}.from`),
    to: insideBranch(requiredString(value.to, `${key}.to`), `${key}.to`),
    hide: stringArray(value.hide, `${key}.hide`, []),
  };
}

/**
 * Parses a `files` entry: `"path"` or `"src:dest"`.
 *
 * @param {string} entry
 * @param {string} key Config key, for the error message.
 * @returns {FileEntry}
 * @throws {ReleaseError}
 */
function resolveFile(entry, key) {
  const separator = entry.indexOf(':');
  const src = separator === -1 ? entry : entry.slice(0, separator);
  const dest = separator === -1 ? entry : entry.slice(separator + 1);
  if (src === '' || dest === '') {
    throw new ReleaseError(`${key} must be "path" or "src:dest": ${entry}`);
  }
  return { src, dest: insideBranch(dest, key) };
}

/**
 * Merges a user target over the defaults.
 *
 * @param {unknown} value
 * @param {number} index Position in `targets`, for the error message.
 * @returns {Target}
 * @throws {ReleaseError}
 */
function resolveTarget(value, index) {
  const key = `gasdev.release.targets[${index}]`;
  if (!isObject(value)) {
    throw new ReleaseError(`${key} must be an object.`);
  }
  rejectUnknownKeys(
    value,
    ['branch', 'from', 'hide', 'exclude', 'include', 'files', 'packageJson'],
    key,
  );
  if (
    value.packageJson !== undefined &&
    typeof value.packageJson !== 'boolean'
  ) {
    throw new ReleaseError(`${key}.packageJson must be a boolean.`);
  }
  if (value.include !== undefined && !Array.isArray(value.include)) {
    throw new ReleaseError(`${key}.include must be an array.`);
  }
  return {
    branch: requiredString(value.branch, `${key}.branch`),
    from:
      value.from === undefined
        ? 'dist'
        : requiredString(value.from, `${key}.from`),
    hide: stringArray(value.hide, `${key}.hide`, ['*.types.js']),
    exclude: stringArray(value.exclude, `${key}.exclude`, []),
    include: (value.include ?? []).map((item, i) =>
      resolveInclude(item, `${key}.include[${i}]`),
    ),
    files: stringArray(value.files, `${key}.files`, DEFAULT_FILES).map(
      (entry) => resolveFile(entry, `${key}.files`),
    ),
    packageJson: value.packageJson ?? true,
  };
}

/**
 * Resolves the configured targets, or the single default target.
 *
 * @param {unknown} targets The `gasdev.release.targets` value.
 * @returns {Target[]}
 * @throws {ReleaseError} When a target is invalid or two targets share a branch.
 */
function resolveTargets(targets) {
  if (targets === undefined) return [resolveTarget({ branch: 'dist' }, 0)];
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new ReleaseError('gasdev.release.targets must be a non-empty array.');
  }
  const resolved = targets.map(resolveTarget);
  const seen = new Set();
  for (const { branch } of resolved) {
    if (seen.has(branch)) {
      throw new ReleaseError(
        `gasdev.release.targets has more than one target for branch "${branch}".`,
      );
    }
    seen.add(branch);
  }
  return resolved;
}

/**
 * Resolves the library metadata from `gasdev`. Shape checks only; `gasdev check`
 * validates the paths and versions.
 *
 * @param {unknown} value The `gasdev` value.
 * @returns {{ loadOrder?: string[], peers?: Record<string, string> }}
 * @throws {ReleaseError} When `loadOrder` or `peers` has the wrong shape.
 */
function resolveLibraryMetadata(value) {
  if (!isObject(value)) return {};
  const { loadOrder, peers } = value;
  if (
    loadOrder !== undefined &&
    (!Array.isArray(loadOrder) ||
      loadOrder.length === 0 ||
      loadOrder.some(
        (item) => typeof item !== 'string' || !item.endsWith('.ts'),
      ))
  ) {
    throw new ReleaseError(
      'gasdev.loadOrder must be a non-empty array of .ts paths.',
    );
  }
  if (
    peers !== undefined &&
    (!isObject(peers) ||
      Object.values(peers).some((range) => typeof range !== 'string'))
  ) {
    throw new ReleaseError('gasdev.peers must be an object of version ranges.');
  }
  return {
    ...(loadOrder && { loadOrder }),
    ...(peers && { peers: /** @type {Record<string, string>} */ (peers) }),
  };
}

/**
 * Reads the project's package.json and resolves the release configuration.
 * Each target is merged over the defaults; without `targets` the single default target is used.
 *
 * @param {string} cwd Project root.
 * @returns {ReleaseConfig}
 * @throws {ReleaseError} When package.json is missing or has no version, or the config is invalid.
 */
export function loadConfig(cwd) {
  /** @type {Record<string, unknown> & { version?: unknown, gasdev?: unknown }} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  } catch (error) {
    throw new ReleaseError(
      `Cannot read package.json in ${cwd}: ${/** @type {Error} */ (error).message}`,
    );
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    throw new ReleaseError('package.json has no "version".');
  }
  const legacy = legacyKeyMessage(pkg);
  if (legacy) {
    throw new ReleaseError(legacy);
  }
  const options = (isObject(pkg.gasdev) ? pkg.gasdev.release : undefined) ?? {};
  if (!isObject(options)) {
    throw new ReleaseError('gasdev.release must be an object.');
  }
  rejectUnknownKeys(
    options,
    ['remote', 'targets', 'githubRelease'],
    'gasdev.release',
  );
  if (
    options.githubRelease !== undefined &&
    typeof options.githubRelease !== 'boolean'
  ) {
    throw new ReleaseError('gasdev.release.githubRelease must be a boolean.');
  }
  return {
    remote:
      options.remote === undefined
        ? 'origin'
        : requiredString(options.remote, 'gasdev.release.remote'),
    version: pkg.version,
    pkg,
    targets: resolveTargets(options.targets),
    githubRelease: options.githubRelease ?? false,
    ...resolveLibraryMetadata(pkg.gasdev),
  };
}
