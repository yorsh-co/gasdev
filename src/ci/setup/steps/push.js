// @ts-check

/** @typedef {import('./login.js').StepContext} StepContext */

/**
 * Pushes the local files to the Apps Script project.
 *
 * @param {StepContext} ctx
 * @returns {Promise<void>}
 */
export async function push({ clasp, io }) {
  io.log.section('Push');
  clasp.push();
  io.log.success('Pushed project files.');
}
