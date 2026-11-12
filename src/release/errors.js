// @ts-check
import { GhError } from '../gh.js';

/** An expected failure; its message is shown to the user without a stack trace. */
export class ReleaseError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ReleaseError';
  }
}

/**
 * The release was pushed, but publishing the GitHub Release failed.
 * Exits with code 3 so CI can tell it apart from a release that never happened.
 */
export class GitHubReleaseError extends ReleaseError {
  /**
   * Process exit code for this failure.
   *
   * @readonly
   */
  exitCode = 3;

  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'GitHubReleaseError';
  }
}

export const MISSING_GH =
  'gh is not installed — install GitHub CLI or set githubRelease to false.';

/**
 * Runs a gh call, turning gh failures into release errors.
 *
 * @template T
 * @param {() => T} read
 * @returns {T}
 * @throws {ReleaseError} When gh is missing or the call fails.
 */
export function viaGh(read) {
  try {
    return read();
  } catch (error) {
    if (error instanceof GhError) {
      throw new ReleaseError(error.missing ? MISSING_GH : error.message);
    }
    throw error;
  }
}
