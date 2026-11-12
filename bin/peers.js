// @ts-check
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import semver from 'semver';

/** Raised for a peer sync problem that prevents the check or the write. */
export class PeersError extends Error {}

/** Matches the `@version` line of the file's JSDoc header. */
const VERSION_LINE = /^ \* @version .*\n/m;

/**
 * Runs git without a shell and without terminal prompts.
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string} Standard output.
 * @throws {PeersError} When git fails, including its standard error.
 */
function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw new PeersError(`git: ${result.error.message}`);
  if (result.status !== 0) {
    throw new PeersError(
      `git ${args.join(' ')} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Finds the highest `vX.Y.Z` tag of a peer repository that satisfies a range.
 *
 * @param {string} name Peer package name.
 * @param {string} range Semver range from `gasdev.peers`.
 * @param {(name: string) => string} repository Resolves a peer name to a git repository URL or path.
 * @returns {string} The version, without the `v` prefix.
 * @throws {PeersError} When the range is invalid or no tag satisfies it.
 */
function resolveTag(name, range, repository) {
  if (semver.validRange(range) === null) {
    throw new PeersError(`${name}: invalid version range "${range}"`);
  }
  const versions = git([
    'ls-remote',
    '--tags',
    '--refs',
    repository(name),
    'refs/tags/v*',
  ])
    .split('\n')
    .map((line) => line.split('\trefs/tags/v')[1])
    .filter((v) => v !== undefined && semver.valid(v) === v)
    .map(String);
  const version = semver.maxSatisfying(versions, range);
  if (version === null) {
    const available = versions.sort(semver.compare).join(', ') || 'none';
    throw new PeersError(
      `${name}: no version satisfies "${range}" (available: ${available})`,
    );
  }
  return version;
}

/**
 * Reads `peer/<name>.peer.types.d.ts` at a peer's `v<version>` tag.
 *
 * @param {string} name Peer package name.
 * @param {string} version Version without the `v` prefix.
 * @param {(name: string) => string} repository Resolves a peer name to a git repository URL or path.
 * @returns {string} The file contents.
 * @throws {PeersError} When the tag cannot be fetched or lacks the file.
 */
function fetchPeerTypes(name, version, repository) {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-peer-'));
  try {
    git(['init', '--quiet'], dir);
    git(
      [
        'fetch',
        '--quiet',
        '--depth',
        '1',
        repository(name),
        `refs/tags/v${version}`,
      ],
      dir,
    );
    const path = `peer/${name}.peer.types.d.ts`;
    try {
      return git(['show', `FETCH_HEAD:${path}`], dir);
    } catch (error) {
      if (
        error instanceof PeersError &&
        /does not exist|exists on disk, but not in/.test(error.message)
      ) {
        throw new PeersError(
          `${name}@${version}: ${path} not found at tag v${version}`,
        );
      }
      throw error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Removes the `@version` line of a peer type declaration file.
 *
 * @param {string} text
 * @returns {string}
 */
function stripVersion(text) {
  return text.replace(VERSION_LINE, '');
}

/**
 * Syncs `src/internal/<peer>.peer.types.d.ts` for every configured peer from the
 * highest matching release tag, or only checks that they are up to date.
 *
 * @param {string} cwd Project directory.
 * @param {Record<string, string> | undefined} peers `gasdev.peers`.
 * @param {object} [options]
 * @param {boolean} [options.check] Write nothing; return 1 when a file differs or is missing.
 * @param {(name: string) => string} [options.repository] Resolves a peer name to a git repository URL or path.
 * @returns {number} Exit code: 0 when synced or up to date, 1 on drift.
 * @throws {PeersError} When peers are not configured or a peer cannot be resolved.
 */
export function runPeers(
  cwd,
  peers,
  {
    check = false,
    repository = (name) => `https://github.com/yorsh-co/${name}.git`,
  } = {},
) {
  if (peers === undefined) {
    throw new PeersError('package.json: "gasdev.peers" is not configured');
  }
  const resolved = Object.entries(peers).map(([name, range]) => {
    const version = resolveTag(name, range, repository);
    const text = stripVersion(fetchPeerTypes(name, version, repository));
    return {
      name,
      version,
      text,
      path: `src/internal/${name}.peer.types.d.ts`,
    };
  });
  if (check) {
    const stale = resolved.filter(
      ({ path, text }) =>
        !existsSync(join(cwd, path)) ||
        readFileSync(join(cwd, path), 'utf8') !== text,
    );
    for (const { name, version, path } of stale) {
      process.stderr.write(
        `${path} is out of date with ${name}@${version}: run gasdev peers sync\n`,
      );
    }
    if (stale.length === 0) {
      process.stdout.write('✓ Peer types are up to date\n');
    }
    return stale.length === 0 ? 0 : 1;
  }
  for (const { name, version, text, path } of resolved) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
    process.stdout.write(`✓ Synced ${path} from ${name}@${version}\n`);
  }
  return 0;
}
