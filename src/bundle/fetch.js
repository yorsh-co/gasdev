// @ts-check
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { BundleError } from './errors.js';
import { git } from './git.js';

/** Metadata written next to the fetched files; its presence marks a complete cache entry. */
export const METADATA_FILE = '.gasdev-bundle.json';

/**
 * Lists the versions of a repository's `dist/vX.Y.Z` tags, ignoring unparseable ones.
 *
 * @param {string} repository
 * @returns {string[]}
 */
function listDistVersions(repository) {
  const output = git([
    'ls-remote',
    '--tags',
    '--refs',
    repository,
    'refs/tags/dist/v*',
  ]);
  /** @type {string[]} */
  const versions = [];
  for (const line of output.split('\n')) {
    const version = /\trefs\/tags\/dist\/v(.+)$/.exec(line)?.[1];
    if (version !== undefined && semver.valid(version) === version) {
      versions.push(version);
    }
  }
  return versions;
}

/**
 * Picks the highest `dist/v*` tag of a library that satisfies a range.
 *
 * @param {string} name
 * @param {string} range
 * @param {string} repository
 * @returns {string} The matching version without the `dist/v` prefix.
 * @throws {BundleError} When git fails or no tag satisfies the range.
 */
export function resolveVersion(name, range, repository) {
  const versions = listDistVersions(repository);
  const match = semver.maxSatisfying(versions, range);
  if (match === null) {
    const available =
      versions.length === 0
        ? 'none'
        : [...versions].sort(semver.compare).join(', ');
    throw new BundleError(
      `${name}: no dist tag satisfies "${range}" in ${repository} (available versions: ${available}).`,
    );
  }
  return match;
}

/**
 * @param {string} dir
 * @param {string} repository The entry must have been fetched from this repository.
 * @returns {string | undefined} The recorded commit SHA of a complete cache entry.
 */
function readCachedSha(dir, repository) {
  try {
    const metadata = JSON.parse(readFileSync(join(dir, METADATA_FILE), 'utf8'));
    const { sha } = metadata;
    return metadata.repository === repository &&
      typeof sha === 'string' &&
      sha !== ''
      ? sha
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Makes the `dist/v<version>` tree of a library available in the cache and returns its location.
 * The clone happens in a temporary sibling directory that is renamed into place, so an interrupted
 * fetch never looks cached. An existing complete entry from the same repository is reused without
 * cloning.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.version
 * @param {string} options.repository
 * @param {string} options.cacheDir
 * @returns {{ dir: string, sha: string }}
 * @throws {BundleError} When git fails.
 */
export function fetchLibrary({ name, version, repository, cacheDir }) {
  const dir = join(cacheDir, `${name}@${version}`);
  const cachedSha = readCachedSha(dir, repository);
  if (cachedSha !== undefined) return { dir, sha: cachedSha };

  mkdirSync(cacheDir, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  const staging = mkdtempSync(join(cacheDir, `.${name}@${version}-`));
  try {
    const clone = join(staging, 'clone');
    git([
      'clone',
      '--depth',
      '1',
      '--branch',
      `dist/v${version}`,
      '--quiet',
      repository,
      clone,
    ]);
    const sha = git(['rev-parse', 'HEAD'], clone);
    rmSync(join(clone, '.git'), { recursive: true, force: true });
    const metadataPath = join(clone, METADATA_FILE);
    // The dist tag may commit this name as a symbolic link; remove it so the write cannot follow it.
    rmSync(metadataPath, { recursive: true, force: true });
    writeFileSync(
      metadataPath,
      `${JSON.stringify({ name, version, repository, sha }, null, 2)}\n`,
      { flag: 'wx' },
    );
    try {
      renameSync(clone, dir);
    } catch (error) {
      // A concurrent run may have completed the same entry first.
      const existing = readCachedSha(dir, repository);
      if (existing === undefined || !existsSync(dir)) throw error;
      return { dir, sha: existing };
    }
    return { dir, sha };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
