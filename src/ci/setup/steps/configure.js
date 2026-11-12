// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { updateEnv } from '../env.js';
import { DeployError } from '../../errors.js';

/** @typedef {import('./login.js').StepContext} StepContext */

/**
 * @param {string} path
 * @param {unknown} data
 */
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Reads the existing manifest.
 *
 * @param {string} path
 * @returns {Record<string, unknown>} Empty when the file does not exist.
 * @throws {DeployError} If the file is not a JSON object.
 */
function readManifest(path) {
  if (!existsSync(path)) {
    return {};
  }
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new DeployError(`${path} is not valid JSON.`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DeployError(`${path} must contain a JSON object.`);
  }
  return /** @type {Record<string, unknown>} */ (data);
}

/**
 * Writes `.clasp.json`, the manifest and `GAS_SCRIPT_ID`.
 *
 * @param {StepContext} ctx
 * @returns {Promise<void>}
 * @throws {DeployError} If no script ID was set by the project step.
 */
export async function configure({ config, io, state }) {
  io.log.section('Configuration');
  const { scriptId } = state;
  if (scriptId === undefined) {
    throw new DeployError('No Apps Script project selected.');
  }
  const { paths } = config;
  const existing = readManifest(paths.manifest);
  const defaultZone = [
    config.manifestTemplate.timeZone,
    existing.timeZone,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].find((zone) => typeof zone === 'string' && zone !== '');
  const { timeZone } = await io.prompt({
    type: 'text',
    name: 'timeZone',
    message: 'Time zone',
    initial: typeof defaultZone === 'string' ? defaultZone : 'Etc/UTC',
    validate: (/** @type {string} */ value) =>
      value.trim() !== '' || 'Enter a time zone.',
  });
  writeJson(paths.clasp, { ...config.claspTemplate, scriptId });
  mkdirSync(dirname(paths.manifest), { recursive: true });
  writeJson(paths.manifest, {
    ...existing,
    ...config.manifestTemplate,
    timeZone: String(timeZone).trim(),
  });
  updateEnv(paths.env, { GAS_SCRIPT_ID: scriptId });
  io.log.success('Wrote .clasp.json, appsscript.json and .env.');
}
