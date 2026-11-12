// @ts-check
import pkg from '../../package.json' with { type: 'json' };
import { deploy } from './deploy.js';
import { CancelledError, isDeployError } from './errors.js';
import { createIo } from './setup/io.js';
import { setup } from './setup/setup.js';

const USAGE = `Usage: gasdev setup | deploy

Commands:
  setup       Guided first-time setup and web app deployment
  deploy      Push the project with clasp and redeploy the web app, if configured

Options:
  -h, --help  Show this help
  --version   Show the version
`;

/**
 * @typedef {object} CliContext
 * @property {{ write(text: string): unknown }} stdout
 * @property {{ write(text: string): unknown }} stderr
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd Project root.
 * @property {typeof import('./clasp.js').createClasp} [createClasp] Clasp factory; tests inject a fake binary.
 */

/**
 * Runs the CLI.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @param {CliContext} context
 * @returns {Promise<number>} The exit code: 0 on success, 1 on a failed command, 2 on invalid usage,
 * 130 when the user cancels a setup prompt.
 */
export async function main(argv, context) {
  const { stdout, stderr } = context;
  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h') {
    stdout.write(USAGE);
    return 0;
  }
  if (command === '--version') {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (
    (command === 'deploy' || command === 'setup') &&
    rest.length === 1 &&
    (rest[0] === '--help' || rest[0] === '-h')
  ) {
    stdout.write(USAGE);
    return 0;
  }
  if ((command !== 'deploy' && command !== 'setup') || rest.length > 0) {
    stderr.write(USAGE);
    return 2;
  }

  if (command === 'setup') {
    try {
      await setup(
        context.cwd,
        createIo({
          stdout: context.stdout,
          stderr: context.stderr,
        }),
        context.createClasp ? { createClasp: context.createClasp } : undefined,
      );
      return 0;
    } catch (error) {
      if (error instanceof CancelledError) {
        stderr.write('Cancelled.\n');
        return 130;
      }
      if (isDeployError(error)) {
        stderr.write(`gasdev: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }

  try {
    await deploy(context);
    return 0;
  } catch (error) {
    if (isDeployError(error)) {
      stderr.write(`gasdev: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
