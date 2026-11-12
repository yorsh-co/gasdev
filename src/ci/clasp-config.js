// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DeployError } from './errors.js';

const TEMPLATE = '.clasp.example.json';

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} cwd
 * @returns {Record<string, unknown>}
 */
function readTemplate(cwd) {
  let text;
  try {
    text = readFileSync(join(cwd, TEMPLATE), 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new DeployError(`${TEMPLATE} not found.`, { cause: error });
    }
    throw new DeployError(`Cannot read ${TEMPLATE}: ${errorMessage(error)}.`, {
      cause: error,
    });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new DeployError(
      `${TEMPLATE} is not valid JSON: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DeployError(`${TEMPLATE} must contain a JSON object.`);
  }
  return data;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function validateRootDir(value) {
  if (value === undefined) {
    return '.';
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeployError(`${TEMPLATE} rootDir must be a non-empty string.`);
  }
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new DeployError(
      `${TEMPLATE} rootDir "${value}" must be a relative path inside the project.`,
    );
  }
  return value;
}

/**
 * Renders `.clasp.json` from `.clasp.example.json` plus the script ID,
 * overwriting any existing file.
 *
 * @param {string} cwd Project root.
 * @param {string} scriptId
 * @returns {{ rootDir: string, manifestPath: string }}
 * @throws {DeployError} If the template is missing or invalid.
 */
export function renderClaspConfig(cwd, scriptId) {
  const template = readTemplate(cwd);
  const rootDir = validateRootDir(template.rootDir);
  writeFileSync(
    join(cwd, '.clasp.json'),
    JSON.stringify({ ...template, scriptId }, null, 2) + '\n',
  );
  return { rootDir, manifestPath: join(cwd, rootDir, 'appsscript.json') };
}
