// @ts-check
import { spawnSync } from 'node:child_process';

/** Raised when gh cannot be started, exits non-zero or prints something unexpected. */
export class GhError extends Error {
  /**
   * @param {string} message
   * @param {boolean} [missing] True when gh is not on PATH.
   */
  constructor(message, missing = false) {
    super(message);
    this.name = 'GhError';
    /** @readonly */
    this.missing = missing;
  }
}

/**
 * Runs gh without a shell.
 *
 * @param {string[]} args
 * @param {{ cwd?: string | undefined, input?: string | undefined }} [options] Working directory and text written to stdin.
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 * @throws {GhError} When gh cannot be started.
 */
export function gh(args, { cwd, input } = {}) {
  const result = spawnSync('gh', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const { code, message } = /** @type {Error & { code?: string }} */ (
      result.error
    );
    throw new GhError(`cannot run gh: ${message}`, code === 'ENOENT');
  }
  return result;
}

/**
 * Calls `gh api` and parses the JSON response.
 *
 * @param {string} path API path.
 * @param {{ cwd?: string | undefined }} [options]
 * @returns {any}
 * @throws {GhError} When gh is missing, exits non-zero or prints something other than JSON.
 */
export function ghApi(path, { cwd } = {}) {
  const result = gh(['api', path], { cwd });
  if (result.status !== 0) {
    throw new GhError(
      `gh api ${path} failed (exit ${result.status}):\n${`${result.stdout}${result.stderr}`.trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new GhError(
      `gh api ${path} returned unexpected output: ${result.stdout.trim()}`,
    );
  }
}

/**
 * Lists the rulesets of a repository (summaries, without rules).
 *
 * @param {string} repo `owner/repo`.
 * @param {{ cwd?: string | undefined, includeParents?: boolean }} [options] `includeParents: false` leaves out organization rulesets.
 * @returns {any[]}
 * @throws {GhError} When the call fails.
 */
export function listRulesets(repo, { cwd, includeParents = true } = {}) {
  const list = ghApi(
    `repos/${repo}/rulesets?per_page=100${includeParents ? '' : '&includes_parents=false'}`,
    { cwd },
  );
  return Array.isArray(list) ? list : [];
}

/**
 * Reads one ruleset with its full body.
 *
 * @param {string} repo `owner/repo`.
 * @param {number} id Ruleset id.
 * @param {{ cwd?: string | undefined }} [options]
 * @returns {any}
 * @throws {GhError} When the call fails.
 */
export function readRuleset(repo, id, { cwd } = {}) {
  return ghApi(`repos/${repo}/rulesets/${id}`, { cwd });
}
