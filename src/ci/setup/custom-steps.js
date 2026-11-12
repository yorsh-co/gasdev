// @ts-check
import { pathToFileURL } from 'node:url';
import { CancelledError, DeployError, isDeployError } from '../errors.js';
import { readEnv, updateEnv } from './env.js';

/**
 * @typedef {import('./steps/login.js').StepContext} StepContext
 * @typedef {{ title: string, run: (ctx: PublicContext) => void | Promise<void> }} CustomStep
 * @typedef {object} PublicContext
 * @property {string} cwd
 * @property {Record<string, unknown>} pkg
 * @property {{ scriptId: string, webappUrl: string, deploymentId: string, version: string }} deployment
 * @property {{ read: () => Record<string, string>, update: (values: Record<string, string>) => void }} env
 * @property {import('./io.js').Io['prompt']} prompt
 * @property {import('./io.js').Log} log
 * @property {() => void} openScript
 */

/**
 * Imports the project's steps module and validates its default export.
 *
 * @param {string} path Absolute path of the module.
 * @returns {Promise<CustomStep[]>}
 * @throws {DeployError} If the module cannot be loaded or the export is malformed.
 */
export async function loadSteps(path) {
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (error) {
    throw new DeployError(
      `Cannot load steps module: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const steps = mod.default;
  if (!Array.isArray(steps)) {
    throw new DeployError('Steps module must default-export an array.');
  }
  steps.forEach((step, index) => {
    if (typeof step !== 'object' || step === null) {
      throw new DeployError(`Step ${index} must be an object.`);
    }
    if (typeof step.title !== 'string' || step.title.trim() === '') {
      throw new DeployError(`Step ${index}: title must be a non-empty string.`);
    }
    if (typeof step.run !== 'function') {
      throw new DeployError(`Step ${index}: run must be a function.`);
    }
  });
  return steps;
}

/**
 * Builds the context handed to project-defined steps.
 *
 * @param {object} input
 * @param {string} input.cwd
 * @param {StepContext['config']} input.config
 * @param {StepContext['io']} input.io
 * @param {{ scriptId: string, webappUrl: string, deploymentId: string, version: string }} input.result
 * @param {() => void} input.openScript
 * @returns {PublicContext}
 */
export function buildContext({ cwd, config, io, result, openScript }) {
  return {
    cwd,
    pkg: config.pkg,
    deployment: { ...result },
    env: {
      read: () => readEnv(config.paths.env),
      update: (values) => updateEnv(config.paths.env, values),
    },
    prompt: io.prompt,
    log: io.log,
    openScript,
  };
}

/**
 * Runs the steps in order.
 *
 * @param {CustomStep[]} steps
 * @param {PublicContext} ctx
 * @returns {Promise<void>}
 * @throws {DeployError} A step's own `DeployError`, or any other error wrapped with the title.
 */
export async function runSteps(steps, ctx) {
  for (const step of steps) {
    ctx.log.section(step.title);
    try {
      await step.run(ctx);
    } catch (error) {
      if (error instanceof CancelledError || isDeployError(error)) {
        throw error;
      }
      throw new DeployError(
        `Step "${step.title}" failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
