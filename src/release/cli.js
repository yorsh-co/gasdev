// @ts-check
import { parseArgs } from 'node:util';
import pkg from '../../package.json' with { type: 'json' };
import { GitHubReleaseError, ReleaseError } from './errors.js';
import { release } from './release.js';

const OPTIONS = /** @type {const} */ ({
  'dry-run': { type: 'boolean' },
  target: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
});

const USAGE = `Usage: gasdev release [--dry-run] [--target <branch>]...

Publishes the build of a gas-* library to its dist branch(es) with tags.

Options:
  --dry-run          Run all checks and show the staged changes; commit, tag and push nothing
  --target <branch>  Release only the given target (repeatable; default: all configured targets)
  -h, --help         Show this help
  --version          Show the version
`;

/**
 * Runs the CLI.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @returns {Promise<number>} The process exit code: 0 on success, 1 on a failed release, 2 on invalid usage,
 * 3 when the release was pushed but the GitHub Release failed.
 */
export async function main(argv) {
  /** @type {ReturnType<typeof parseArgs<{ options: typeof OPTIONS, strict: true, allowPositionals: false }>>['values']} */
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const { code, message } = /** @type {Error & { code?: string }} */ (error);
    if (!code?.startsWith('ERR_PARSE_ARGS_')) throw error;
    // Node appends advice about `--` that does not apply to this CLI.
    const summary = message.split('. ')[0]?.replace(/\.$/, '');
    process.stderr.write(
      `gasdev: ${summary}.\nRun gasdev release --help for usage.\n`,
    );
    return 2;
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  try {
    release(process.cwd(), (message) => process.stdout.write(`${message}\n`), {
      dryRun: values['dry-run'] ?? false,
      targets: values.target ?? [],
    });
    return 0;
  } catch (error) {
    if (error instanceof ReleaseError) {
      process.stderr.write(`gasdev: ${error.message}\n`);
      return error instanceof GitHubReleaseError ? error.exitCode : 1;
    }
    throw error;
  }
}
