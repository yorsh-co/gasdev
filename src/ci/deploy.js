// @ts-check
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClasp as defaultCreateClasp } from './clasp.js';
import { renderClaspConfig } from './clasp-config.js';
import { writeCredentials } from './credentials.js';
import { DeployError } from './errors.js';
import { writeOutput, writeSummary } from './github.js';
import { readInputs } from './inputs.js';
import { diffScopes } from './scopes.js';
import { createRedactor, maskCommands, secretValues } from './secrets.js';

/**
 * @typedef {Omit<import('./cli.js').CliContext, 'stderr' | 'createClasp'> & {
 *   createClasp?: (options: Parameters<typeof defaultCreateClasp>[0]) => Pick<import('./clasp.js').Clasp, 'bin' | 'push' | 'listDeployments' | 'createVersion' | 'updateDeployment' | 'readVersionManifest'>
 * }} DeployContext
 */

/**
 * @param {string} title
 * @param {string[]} scopes
 * @returns {string[]}
 */
function scopeLines(title, scopes) {
  return scopes.length === 0
    ? []
    : [`${title}:`, ...scopes.map((scope) => `  ${scope}`)];
}

/**
 * Pushes the project and redeploys it when a web app deployment is configured.
 * The OAuth scopes are checked against the deployed version before any change.
 *
 * @param {DeployContext} context
 * @returns {Promise<void>}
 * @throws {DeployError} On invalid inputs, a scope change or a clasp failure.
 */
export async function deploy({
  env,
  cwd,
  stdout,
  createClasp = defaultCreateClasp,
}) {
  const inputs = readInputs(env);
  const secrets = secretValues(inputs.clasprc);
  if (inputs.githubActions) {
    for (const line of maskCommands(secrets)) {
      stdout.write(`${line}\n`);
    }
  }
  const redact = createRedactor(secrets);

  const authParent = inputs.runnerTemp ?? tmpdir();
  /** @type {string} */
  let authDir;
  try {
    authDir = mkdtempSync(join(authParent, 'gasdev-auth-'));
  } catch (error) {
    throw new DeployError(
      `cannot create credentials dir in ${authParent}: ${/** @type {Error} */ (error).message}`,
    );
  }
  try {
    const auth = writeCredentials(authDir, inputs.clasprc);
    const { rootDir, manifestPath } = renderClaspConfig(cwd, inputs.scriptId);

    /** @type {any} */
    let localManifest;
    try {
      localManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
        throw new DeployError(
          `${rootDir}/appsscript.json not found; run the build first.`,
        );
      }
      throw new DeployError(`${rootDir}/appsscript.json is not valid JSON.`);
    }

    const clasp = createClasp({ cwd, env, redact, auth });
    stdout.write(`Using clasp: ${clasp.bin}\n`);
    const { deploymentId, sha } = inputs;

    if (deploymentId !== undefined) {
      if (sha === undefined) {
        throw new DeployError(
          'GITHUB_SHA is not set; it is the description of the redeployed version.',
        );
      }
      const deployment = clasp
        .listDeployments()
        .find(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            item.deploymentId === deploymentId,
        );
      if (deployment === undefined) {
        throw new DeployError(
          'GAS_DEPLOYMENT_ID does not match any deployment of the script.',
        );
      }
      const { versionNumber } = deployment;
      if (
        typeof versionNumber !== 'number' ||
        !Number.isInteger(versionNumber) ||
        versionNumber < 1
      ) {
        throw new DeployError(
          'GAS_DEPLOYMENT_ID points to the HEAD deployment; use a versioned web app deployment.',
        );
      }
      const deployed = clasp.readVersionManifest(
        inputs.scriptId,
        versionNumber,
      );
      const { added, removed } = diffScopes(localManifest, deployed);
      if (added.length > 0 || removed.length > 0) {
        throw new DeployError(
          [
            `The OAuth scopes changed since version ${versionNumber}; nothing was pushed.`,
            ...scopeLines('Added', added),
            ...scopeLines('Removed', removed),
            'Authorize the new scopes manually: see the README, #scope-changes.',
          ].join('\n'),
        );
      }
    }

    clasp.push();

    if (deploymentId === undefined || sha === undefined) {
      stdout.write('Pushed (push only).\n');
      writeOutput(inputs.outputPath, 'url', '');
      writeSummary(inputs.summaryPath, '### gasdev\n\nPushed: push only.\n');
      return;
    }

    const version = clasp.createVersion(sha);
    clasp.updateDeployment(deploymentId, version, sha);
    const url = `https://script.google.com/macros/s/${deploymentId}/exec`;
    stdout.write(`Deployed version ${version}: ${url}\n`);
    writeOutput(inputs.outputPath, 'url', url);
    writeSummary(
      inputs.summaryPath,
      `### gasdev\n\nDeployed version ${version}: ${url}\n`,
    );
  } finally {
    rmSync(authDir, { recursive: true, force: true });
  }
}
