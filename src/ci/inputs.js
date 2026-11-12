// @ts-check
import { DeployError } from './errors.js';

/**
 * @typedef {object} Inputs
 * @property {Record<string, unknown>} clasprc Parsed `CLASPRC_JSON` credentials.
 * @property {string} scriptId
 * @property {string | undefined} [deploymentId] Set when a web-app deployment is redeployed.
 * @property {string | undefined} [sha] Redeploy description (`GITHUB_SHA`).
 * @property {boolean} githubActions
 * @property {string | undefined} [outputPath] `GITHUB_OUTPUT` file.
 * @property {string | undefined} [runnerTemp] `RUNNER_TEMP` directory; emptied by the runner after each job.
 * @property {string | undefined} [summaryPath] `GITHUB_STEP_SUMMARY` file.
 */

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function nonEmpty(value) {
  return value === undefined || value === '' ? undefined : value;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * @param {string} name
 * @param {string | undefined} value
 * @throws {DeployError} If the value contains characters outside an Apps Script ID.
 */
function assertId(name, value) {
  if (value !== undefined && !ID_PATTERN.test(value)) {
    throw new DeployError(`${name} contains characters not allowed in an ID.`);
  }
}

/**
 * Reads and validates the deploy inputs from the environment. Error messages
 * name the variable but never include its value.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Inputs}
 * @throws {DeployError} If a required variable is missing or invalid.
 */
export function readInputs(env) {
  const raw = nonEmpty(env.CLASPRC_JSON);
  if (raw === undefined) {
    throw new DeployError(
      'CLASPRC_JSON is not set. Add it as a secret of the deployment environment.',
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DeployError('CLASPRC_JSON is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DeployError('CLASPRC_JSON must contain a JSON object.');
  }
  const scriptId = nonEmpty(env.GAS_SCRIPT_ID);
  if (scriptId === undefined) {
    throw new DeployError(
      'GAS_SCRIPT_ID is not set. Add it as a variable of the deployment environment.',
    );
  }
  const deploymentId = nonEmpty(env.GAS_DEPLOYMENT_ID);
  assertId('GAS_SCRIPT_ID', scriptId);
  assertId('GAS_DEPLOYMENT_ID', deploymentId);
  return {
    clasprc: /** @type {Record<string, unknown>} */ (parsed),
    scriptId,
    deploymentId,
    sha: nonEmpty(env.GITHUB_SHA),
    githubActions: env.GITHUB_ACTIONS === 'true',
    outputPath: nonEmpty(env.GITHUB_OUTPUT),
    runnerTemp: nonEmpty(env.RUNNER_TEMP),
    summaryPath: nonEmpty(env.GITHUB_STEP_SUMMARY),
  };
}
