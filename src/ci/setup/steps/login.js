// @ts-check
import { DeployError } from '../../errors.js';

/**
 * @typedef {import('../../clasp.js').Clasp} Clasp
 * @typedef {import('../config.js').DeployConfig} DeployConfig
 * @typedef {import('../io.js').Io} Io
 * @typedef {object} StepContext
 * @property {string} cwd Project root.
 * @property {DeployConfig} config
 * @property {Clasp} clasp
 * @property {Io} io
 * @property {{ scriptId?: string, deployment?: { scriptId: string, webappUrl: string, deploymentId: string, version: string } }} state
 */

/**
 * Makes sure clasp is logged in, offering to switch accounts when it already is.
 *
 * @param {StepContext} ctx
 * @returns {Promise<void>}
 * @throws {DeployError} If clasp is still logged out after `clasp login`.
 */
export async function login({ clasp, io }) {
  io.log.section('Authentication');
  const user = clasp.whoAmI();
  if (user.loggedIn) {
    const { choice } = await io.prompt({
      type: 'select',
      name: 'choice',
      message: 'clasp account',
      choices: [
        { title: `Continue as ${user.email ?? 'current user'}`, value: 'keep' },
        { title: 'Log in with another account', value: 'login' },
      ],
    });
    if (choice === 'keep') {
      io.log.success(`Logged in as ${user.email ?? 'current user'}.`);
      return;
    }
  }
  clasp.login();
  const after = clasp.whoAmI();
  if (!after.loggedIn) {
    throw new DeployError('clasp login did not complete.');
  }
  io.log.success(`Logged in as ${after.email ?? 'current user'}.`);
}
