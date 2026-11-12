// @ts-check
import { appendFileSync } from 'node:fs';
import { DeployError } from './errors.js';

/**
 * Appends a step output to the `GITHUB_OUTPUT` file.
 *
 * @param {string | undefined} path Does nothing when undefined.
 * @param {string} name
 * @param {string} value Single-line value.
 * @throws {DeployError} When the name or value contains a line break.
 */
export function writeOutput(path, name, value) {
  if (/[\r\n]/.test(name + value)) {
    throw new DeployError('Step output name and value must be single-line.');
  }
  if (path !== undefined) {
    appendFileSync(path, `${name}=${value}\n`);
  }
}

/**
 * Appends markdown to the `GITHUB_STEP_SUMMARY` file.
 *
 * @param {string | undefined} path Does nothing when undefined.
 * @param {string} markdown
 */
export function writeSummary(path, markdown) {
  if (path !== undefined) {
    appendFileSync(path, markdown);
  }
}
