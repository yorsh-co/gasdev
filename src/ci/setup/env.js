// @ts-check
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DeployError } from '../errors.js';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reads a dotenv file.
 *
 * @param {string} path
 * @returns {Record<string, string>} Empty when the file does not exist.
 */
export function readEnv(path) {
  if (!existsSync(path)) {
    return {};
  }
  return /** @type {Record<string, string>} */ (
    parseEnv(readFileSync(path, 'utf8'))
  );
}

/**
 * Quotes a value when needed. `util.parseEnv` has no escape syntax and expands `\n` inside
 * double quotes, so a quote character that does not occur in the value is used instead
 * (double quotes only for values without a backslash).
 *
 * @param {string} value
 * @returns {string}
 * @throws {DeployError} If no quote character can safely wrap the value.
 */
function formatValue(value) {
  if (!/[\s#'"`]/.test(value)) {
    return value;
  }
  const quote = ["'", '`', '"'].find(
    (char) => !value.includes(char) && (char !== '"' || !value.includes('\\')),
  );
  if (quote === undefined) {
    throw new DeployError('.env value cannot be quoted safely.');
  }
  return `${quote}${value}${quote}`;
}

/**
 * Tells whether a `KEY=value` line opens a quoted value that it does not close.
 *
 * @param {string} line
 * @returns {boolean}
 */
function opensMultilineValue(line) {
  const value = line.slice(line.indexOf('=') + 1).trimStart();
  const quote = value[0];
  return (
    quote !== undefined &&
    ['"', "'", '`'].includes(quote) &&
    !value.slice(1).includes(quote)
  );
}

/**
 * Updates a dotenv file in place: the last line of each existing key is replaced (the one
 * `util.parseEnv` reads), new keys are appended, and comments and other lines are kept. The
 * file ends up with mode 0600.
 *
 * @param {string} path
 * @param {Record<string, string>} values
 * @throws {DeployError} On an invalid key, a value containing a newline, an unquotable value,
 *   or an existing multi-line value for a key being replaced.
 */
export function updateEnv(path, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!KEY_PATTERN.test(key)) {
      throw new DeployError(`Invalid .env key "${key}".`);
    }
    if (/[\r\n]/.test(value)) {
      throw new DeployError(`.env value for ${key} must not contain newlines.`);
    }
  }
  const exists = existsSync(path);
  const text = exists ? readFileSync(path, 'utf8') : '';
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  const keyOf = (/** @type {string} */ line) =>
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
  /** @type {Map<string, number>} */
  const lastIndex = new Map();
  lines.forEach((line, index) => {
    const key = keyOf(line);
    if (key !== undefined) {
      lastIndex.set(key, index);
    }
  });
  const updated = lines.map((line, index) => {
    const key = keyOf(line);
    if (
      key !== undefined &&
      Object.hasOwn(values, key) &&
      lastIndex.get(key) === index
    ) {
      if (opensMultilineValue(line)) {
        throw new DeployError(
          `.env value for ${key} spans several lines; edit it by hand.`,
        );
      }
      return `${key}=${formatValue(/** @type {string} */ (values[key]))}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!lastIndex.has(key)) {
      updated.push(`${key}=${formatValue(value)}`);
    }
  }
  if (exists) {
    chmodSync(path, 0o600);
  }
  writeFileSync(path, `${updated.join('\n')}\n`, { mode: 0o600 });
}

/**
 * Ensures `.env` is git-ignored when `cwd` is inside a git work tree. A missing `git` binary
 * is treated as "not in a work tree", so the check is skipped.
 *
 * @param {string} cwd
 * @throws {DeployError} If `.env` is not ignored.
 */
export function assertEnvIgnored(cwd) {
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return;
  }
  try {
    git(['check-ignore', '-q', '.env']);
  } catch {
    throw new DeployError(
      '.env is not ignored by git and would hold secrets. Add `.env` to .gitignore.',
    );
  }
}
