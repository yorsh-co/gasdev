// @ts-check
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ReleaseError } from './errors.js';
import { matchesAny } from './glob.js';

/** @typedef {import('./config.js').Target} Target */

/**
 * @typedef {object} GasLibrary
 * @property {string[]} loadOrder Shipped `.js` paths relative to the branch root, in load order.
 * @property {Record<string, string>} [peers] Optional "used when present" libraries and their version ranges.
 */

/** Fields of the project's package.json that ship on the release branch. */
const KEEP_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'author',
  'repository',
  'homepage',
];

/**
 * Builds the trimmed package.json committed to a release branch.
 *
 * @param {Record<string, unknown>} pkg The project's package.json.
 * @param {GasLibrary} [gasLibrary] Library metadata written after the kept fields.
 * @returns {string} Formatted JSON with a trailing newline.
 */
export function releasePackageJson(pkg, gasLibrary) {
  /** @type {Record<string, unknown>} */
  const trimmed = Object.fromEntries(
    KEEP_FIELDS.filter((field) => field in pkg).map((field) => [
      field,
      pkg[field],
    ]),
  );
  if (gasLibrary) trimmed.gasLibrary = gasLibrary;
  return `${JSON.stringify(trimmed, null, 2)}\n`;
}

/**
 * Maps the configured `.ts` load order to the `.js` files the target ships.
 * Entries that the build contains but the target hides or excludes (including through an excluded
 * parent directory) are dropped, mirroring the release copy.
 *
 * @param {Target} target
 * @param {string[]} loadOrder `gasdev.loadOrder`, relative to `src/`.
 * @param {string} cwd Project root.
 * @returns {string[]} Shipped `.js` paths relative to the branch root, in load order.
 * @throws {ReleaseError} When a built file is missing or nothing remains to load.
 */
export function shippedLoadOrder(target, loadOrder, cwd) {
  const shipped = [];
  for (const entry of loadOrder) {
    const js = entry.replace(/\.ts$/, '.js');
    if (!existsSync(join(cwd, target.from, js))) {
      throw new ReleaseError(
        `[${target.branch}] gasdev.loadOrder: ${target.from}/${js} is missing — run the build first.`,
      );
    }
    const segments = js.split('/');
    const excluded = segments
      .slice(0, -1)
      .some((_, i) =>
        matchesAny(segments.slice(0, i + 1).join('/'), target.exclude, true),
      );
    if (
      !excluded &&
      !matchesAny(js, target.exclude) &&
      !matchesAny(js, target.hide)
    ) {
      shipped.push(js);
    }
  }
  if (shipped.length === 0) {
    throw new ReleaseError(
      `[${target.branch}] gasdev.loadOrder: no entry is shipped — every file is hidden or excluded.`,
    );
  }
  return shipped;
}

/**
 * Builds the `gasLibrary` metadata for a target, or nothing when it does not apply.
 *
 * @param {import('./config.js').ReleaseConfig} config
 * @param {Target} target
 * @param {string} cwd Project root.
 * @returns {GasLibrary | undefined} Undefined unless the target writes a package.json and `loadOrder` is set.
 * @throws {ReleaseError} See {@link shippedLoadOrder}.
 */
export function gasLibraryFor(config, target, cwd) {
  if (!target.packageJson || !config.loadOrder) return undefined;
  return {
    loadOrder: shippedLoadOrder(target, config.loadOrder, cwd),
    ...(config.peers && { peers: config.peers }),
  };
}
