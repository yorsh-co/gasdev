// @ts-check
import { updateEnv } from '../env.js';
import { DeployError } from '../../errors.js';

/** @typedef {import('./login.js').StepContext} StepContext */
/** @typedef {import('../../clasp.js').Deployment} Deployment */

const INSTRUCTIONS = `
You are about to be redirected to the Apps Script IDE.

In the Apps Script editor:

1. Click "Deploy"
2. Click "New deployment"
3. Select "Web app"
4. Execute as "Me"
5. Set access to "Anyone"
6. Click "Deploy"
7. Complete the Google authorization flow
`;

/**
 * @param {string} deploymentId
 * @returns {string}
 */
function webappUrl(deploymentId) {
  return `https://script.google.com/macros/s/${deploymentId}/exec`;
}

/**
 * Versioned (non-HEAD) deployments, highest version first.
 *
 * @param {Deployment[]} deployments
 * @returns {(Deployment & { versionNumber: number })[]}
 */
function versioned(deployments) {
  return /** @type {(Deployment & { versionNumber: number })[]} */ (
    deployments.filter((d) => typeof d.versionNumber === 'number')
  ).sort((a, b) => b.versionNumber - a.versionNumber);
}

/**
 * Guides the manual web app deployment, then records the resulting deployment.
 *
 * @param {StepContext} ctx
 * @returns {Promise<void>} Sets `state.deployment`.
 * @throws {DeployError} If no deployment is found or none is confirmed.
 */
export async function deployment({ config, clasp, io, state }) {
  io.log.section('Deployment');
  const { scriptId } = state;
  if (scriptId === undefined) {
    throw new DeployError('No Apps Script project selected.');
  }
  io.log.warn('Manual web app deployment required.');
  io.log.raw(INSTRUCTIONS);
  clasp.openScript();
  await io.prompt({
    type: 'text',
    name: 'done',
    message: 'Press Enter once the deployment is created',
  });

  let candidates = versioned(clasp.listDeployments(scriptId));
  while (candidates.length === 0) {
    const { retry } = await io.prompt({
      type: 'confirm',
      name: 'retry',
      message: 'No versioned deployment found. Check again?',
      initial: true,
    });
    if (!retry) {
      throw new DeployError('No web app deployment found.');
    }
    candidates = versioned(clasp.listDeployments(scriptId));
  }

  let chosen = /** @type {Deployment & { versionNumber: number }} */ (
    candidates[0]
  );
  const { accept } = await io.prompt({
    type: 'confirm',
    name: 'accept',
    message: `Web app URL ${webappUrl(chosen.deploymentId)} (version ${chosen.versionNumber}). Correct?`,
    initial: true,
  });
  if (!accept) {
    const others = candidates.slice(1);
    if (others.length === 0) {
      throw new DeployError('No other deployment to choose from.');
    }
    const { id } = await io.prompt({
      type: 'select',
      name: 'id',
      message: 'Deployment',
      choices: others.map((d) => ({
        title: `${webappUrl(d.deploymentId)} (version ${d.versionNumber})`,
        value: d.deploymentId,
      })),
    });
    const selected = others.find((d) => d.deploymentId === id);
    if (selected === undefined) {
      throw new DeployError('No deployment selected.');
    }
    chosen = selected;
  }

  const url = webappUrl(chosen.deploymentId);
  const version = String(chosen.versionNumber);
  updateEnv(config.paths.env, {
    GAS_WEBAPP_URL: url,
    GAS_DEPLOYMENT_ID: chosen.deploymentId,
    GAS_VERSION: version,
  });
  state.deployment = {
    scriptId,
    webappUrl: url,
    deploymentId: chosen.deploymentId,
    version,
  };
  io.log.success(`Deployment ${chosen.deploymentId} (version ${version}).`);
}
