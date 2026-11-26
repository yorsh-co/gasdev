// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRootDir } from '../src/ci/clasp-config.js';
import { DeployError } from '../src/ci/errors.js';

const TEMPLATE = 'appsscript.example.json';

/** Raised when the manifest cannot be written from the template. */
export class ManifestError extends Error {}

/**
 * @param {string} cwd
 * @returns {Record<string, unknown>}
 * @throws {ManifestError} If the template is missing or not a JSON object.
 */
function readManifestTemplate(cwd) {
  let text;
  try {
    text = readFileSync(join(cwd, TEMPLATE), 'utf8');
  } catch (error) {
    const message =
      /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
        ? `${TEMPLATE} not found`
        : `cannot read ${TEMPLATE}: ${/** @type {Error} */ (error).message}`;
    throw new ManifestError(message, { cause: error });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ManifestError(
      `${TEMPLATE} is not valid JSON: ${/** @type {Error} */ (error).message}`,
      { cause: error },
    );
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ManifestError(`${TEMPLATE} must contain a JSON object`);
  }
  return data;
}

/**
 * Writes `<rootDir>/appsscript.json` from `appsscript.example.json`, verbatim
 * and overwriting any existing file. `rootDir` comes from
 * `.clasp.example.json`, validated as in `gasdev deploy`.
 *
 * @param {string} cwd Project root.
 * @param {{ stderr?: { write: (text: string) => unknown } }} [options]
 * @returns {number} Exit code 0.
 * @throws {ManifestError} If the template or `rootDir` is invalid.
 */
export function runManifest(cwd, { stderr = process.stderr } = {}) {
  const template = readManifestTemplate(cwd);
  /** @type {string} */
  let rootDir;
  try {
    rootDir = resolveRootDir(cwd);
  } catch (error) {
    if (error instanceof DeployError) {
      throw new ManifestError(error.message, { cause: error.cause });
    }
    throw error;
  }
  mkdirSync(join(cwd, rootDir), { recursive: true });
  writeFileSync(
    join(cwd, rootDir, 'appsscript.json'),
    JSON.stringify(template, null, 2) + '\n',
  );
  if (typeof template.timeZone !== 'string' || template.timeZone === '') {
    stderr.write(
      `gasdev manifest: ${TEMPLATE} has no timeZone; add one so every build uses the same time zone\n`,
    );
  }
  return 0;
}
