// @ts-check
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import pkg from '../../package.json' with { type: 'json' };
import { bundle } from './bundle.js';
import { docsUrl, loadConfig } from './config.js';
import { BundleError } from './errors.js';

const OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
});

const USAGE = `Usage: gasdev bundle

Bundles gas-* Google Apps Script libraries from their dist tags into one global script file.

Reads "gasdev.bundle" from the package.json in the current directory:
  libraries   Required. Library name -> semver range or { version, repository }
  outFile     Bundle path (default: src/gas-libraries.js)
  typesFile   Optional declarations path (must end in .d.ts)

Options:
  -h, --help  Show this help
  --version   Show the version
`;

/**
 * @param {string} cwd
 * @param {string} path Project-relative path.
 * @param {string} content
 */
function writeProjectFile(cwd, path, content) {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Runs the CLI.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @returns {number} The process exit code: 0 on success, 1 on a failed bundle, 2 on invalid usage.
 */
export function main(argv) {
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
      `gasdev: ${summary}.\nRun gasdev bundle --help for usage.\n`,
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
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const { code, types, resolved } = bundle({
      libraries: config.libraries,
      cwd,
    });
    writeProjectFile(cwd, config.outFile, code);
    if (config.typesFile) writeProjectFile(cwd, config.typesFile, types);
    const lines = resolved.map(
      ({ name, version, sha, repository }) =>
        `${name} ${version} (${sha.slice(0, 7)}) ${docsUrl(repository, version)}`,
    );
    lines.push(`Wrote ${config.outFile}`);
    if (config.typesFile) lines.push(`Wrote ${config.typesFile}`);
    lines.push(
      `Note: ${config.outFile} must load before project code that uses these globals at top level (Apps Script loads files in filePushOrder / alphabetical order).`,
    );
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } catch (error) {
    if (error instanceof BundleError) {
      process.stderr.write(`gasdev: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
