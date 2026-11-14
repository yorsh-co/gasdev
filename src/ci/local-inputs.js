// @ts-check
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { git } from '../release/git.js';
import { CancelledError, DeployError } from './errors.js';
import { readEnv } from './setup/env.js';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Prompt function compatible with `prompts`.
 *
 * @typedef {(question: any) => Promise<Record<string, any>>} Prompt
 */

/**
 * Validates a required ID.
 *
 * @param {string} value
 * @returns {true | string}
 */
function validateRequiredId(value) {
  return ID_PATTERN.test(value.trim()) || 'Use letters, digits, "-" and "_".';
}

/**
 * Validates an optional ID.
 *
 * @param {string} value
 * @returns {true | string}
 */
function validateOptionalId(value) {
  return value === '' || validateRequiredId(value);
}

/**
 * Reads HEAD from git.
 *
 * @param {string} cwd
 * @returns {string | undefined} Undefined when git fails.
 */
function defaultReadHead(cwd) {
  try {
    return git(['rev-parse', 'HEAD'], cwd);
  } catch {
    return undefined;
  }
}

/**
 * Completes the deploy environment for a local interactive run. Credentials come from
 * `~/.clasprc.json` and are never prompted for. Answers are not persisted.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {object} options
 * @param {Prompt} options.prompt
 * @param {string} [options.home] Defaults to the user's home directory.
 * @param {string} [options.cwd] Defaults to the current directory.
 * @param {() => string | undefined} [options.readHead] Defaults to `git rev-parse HEAD`.
 * @returns {Promise<NodeJS.ProcessEnv>} A new object; `env` is not mutated.
 * @throws {CancelledError} If a prompt is cancelled.
 * @throws {DeployError} If `~/.clasprc.json` is missing (before any prompt) or
 *   unreadable, or if `.env` exists but cannot be read.
 */
export async function completeLocalEnv(
  env,
  { prompt, home = homedir(), cwd = process.cwd(), readHead },
) {
  const completed = { ...env };
  const head = readHead ?? (() => defaultReadHead(cwd));
  /** @type {Record<string, string> | undefined} */
  let dotenv;
  const readDotenv = () => {
    if (!dotenv) {
      const file = join(cwd, '.env');
      try {
        dotenv = readEnv(file);
      } catch (error) {
        throw new DeployError(
          `Cannot read ${file} (${/** @type {NodeJS.ErrnoException} */ (error).code})`,
          { cause: error },
        );
      }
    }
    return dotenv;
  };

  /**
   * Asks one text question and fails on cancel.
   *
   * @param {string} message
   * @param {string} initial
   * @param {(value: string) => true | string} validate
   * @returns {Promise<string>}
   */
  async function ask(message, initial, validate) {
    const { value } = await prompt({
      type: 'text',
      name: 'value',
      message,
      initial,
      validate,
    });
    if (value === undefined) {
      throw new CancelledError();
    }
    return String(value).trim();
  }

  if (!completed.CLASPRC_JSON) {
    const file = join(home, '.clasprc.json');
    try {
      completed.CLASPRC_JSON = readFileSync(file, 'utf8');
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT') {
        throw new DeployError(
          `CLASPRC_JSON is not set and ${file} was not found. Run \`clasp login\`, then retry.`,
          { cause: error },
        );
      }
      throw new DeployError(`Cannot read ${file} (${code})`, { cause: error });
    }
  }

  if (!completed.GAS_SCRIPT_ID) {
    completed.GAS_SCRIPT_ID = await ask(
      'Script ID (GAS_SCRIPT_ID)',
      readDotenv().GAS_SCRIPT_ID ?? '',
      validateRequiredId,
    );
  }

  if (completed.GAS_DEPLOYMENT_ID === undefined) {
    const answer = await ask(
      'Deployment ID (GAS_DEPLOYMENT_ID, empty: push only)',
      readDotenv().GAS_DEPLOYMENT_ID ?? '',
      validateOptionalId,
    );
    if (answer !== '') {
      completed.GAS_DEPLOYMENT_ID = answer;
    }
  }

  if (completed.GAS_DEPLOYMENT_ID && !completed.GITHUB_SHA) {
    completed.GITHUB_SHA = await ask(
      'Version description',
      head() ?? '',
      (value) => value.trim() !== '' || 'Required.',
    );
  }

  return completed;
}
