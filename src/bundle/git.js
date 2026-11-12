// @ts-check
import { spawnSync } from 'node:child_process';
import { BundleError } from './errors.js';

/**
 * Runs git without a shell and returns its trimmed stdout.
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 * @throws {BundleError} With git's stderr when git cannot run or exits non-zero.
 */
export function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) {
    throw new BundleError(`Cannot run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.status}`;
    throw new BundleError(`git ${args[0]} failed: ${detail}`);
  }
  return result.stdout.trim();
}
