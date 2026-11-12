// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { DeployError } from '../../errors.js';

/** @typedef {import('./login.js').StepContext} StepContext */

/**
 * Reads the `scriptId` of an existing `.clasp.json`, if any.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
function readScriptId(path) {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const { scriptId } = JSON.parse(readFileSync(path, 'utf8'));
    return typeof scriptId === 'string' && scriptId !== ''
      ? scriptId
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chooses between reusing the project in `.clasp.json` and creating a new one.
 *
 * @param {StepContext} ctx
 * @returns {Promise<void>} Sets `state.scriptId`.
 * @throws {DeployError} If an unusable project is not replaced.
 */
export async function project({ config, clasp, io, state }) {
  io.log.section('Apps Script project');
  const existing = readScriptId(config.paths.clasp);
  if (existing !== undefined) {
    const { choice } = await io.prompt({
      type: 'select',
      name: 'choice',
      message: 'Project',
      choices: [
        { title: `Use existing project ${existing}`, value: 'reuse' },
        { title: 'Create a new project', value: 'create' },
      ],
    });
    if (choice === 'reuse') {
      try {
        clasp.listDeployments(existing);
        state.scriptId = existing;
        io.log.success(`Using project ${existing}.`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.log.warn(`Cannot use project ${existing}: ${message}`);
        const { create } = await io.prompt({
          type: 'confirm',
          name: 'create',
          message: 'Create a new project instead?',
          initial: true,
        });
        if (!create) {
          throw new DeployError(`Project ${existing} is not usable.`, {
            cause: error,
          });
        }
      }
    }
  }
  const { scriptId } = clasp.create(config.title);
  state.scriptId = scriptId;
  io.log.success(`Created project ${scriptId}.`);
}
