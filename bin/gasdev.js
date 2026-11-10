#!/usr/bin/env node
// @ts-check
import { parseArgs } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { main as bundleMain } from '../src/bundle/cli.js';
import { main as ciMain } from '../src/ci/cli.js';
import { main as releaseMain } from '../src/release/cli.js';
import {
  CheckError,
  checkProject,
  formatReport,
  initProject,
  loadConfig,
} from './check.js';
import { GasTestError, runBuild, runRun } from './gas-test.js';
import { GithubError, runGithub } from './github.js';
import { HtmlError, runHtml } from './html.js';
import { PeersError, runPeers } from './peers.js';

const OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
  out: { type: 'string' },
  keep: { type: 'boolean' },
  check: { type: 'boolean' },
  fix: { type: 'boolean' },
});

const USAGE = `Usage: gasdev check [--fix]
       gasdev init
       gasdev github [--fix]
       gasdev gas-test build [--out <file>]
       gasdev gas-test run [--keep]
       gasdev html [--check]
       gasdev bundle
       gasdev release [--dry-run] [--target <branch>]...
       gasdev setup
       gasdev deploy
       gasdev peers sync [--check]

Reports drift of .gitignore, .prettierignore, .github/dependabot.yml and the
standard package.json scripts from the preset templates. Writes only with --fix
or init, which do the same: create or complete those ignore files, create
.github/dependabot.yml when absent, add the missing required scripts and add a
failing placeholder for each missing script the project must supply (reported as
a warning until replaced). They never overwrite an existing file or script, then
print the check report, listing what still needs a manual edit.

The preset is read from package.json: "gasdev": { "preset": "gas" | "node" }
(default: gas). "loadOrder", "peers", "gasTest" and "html" (gas preset only)
and "bundle", "release" and "ci" are also validated.

Commands:
  check            Compare the project in the current directory with the templates
  init             Same as check --fix; for scaffolding a new project
  gas-test build   Build one self-contained script (peers, library, test runtime
                   and gas-test/*.ts) to paste into the Apps Script editor
  gas-test run     Push that script to the dedicated test project with clasp
                   (replacing its whole contents), run it and print the results;
                   needs GAS_TEST_SCRIPT_ID or "gasTest.scriptId"
  github           Compare this repository's GitHub rulesets with the template
                   through gh; needs network access and an authenticated gh
  html             Inline each "html" entry's local stylesheets and scripts
                   (TypeScript is transpiled) into a generated .ts file that
                   declares the page as a string constant
  bundle           Bundle gas-* libraries from their dist tags into one global
                   script file (see "gasdev.bundle"; run bundle --help)
  release          Publish the build of a gas-* library to its dist branch(es)
                   with tags (see "gasdev.release"; run release --help)
  setup            Guided setup of a Google Apps Script web app deployment
                   (see "gasdev.ci"; run setup --help)
  deploy           Push with clasp and redeploy the web app, as the reusable
                   workflow does (run deploy --help)
  peers sync       Write src/internal/<peer>.peer.types.d.ts for each
                   "peers" entry from the peer's highest release tag that
                   satisfies its range (without the @version line); needs
                   network access

Options:
  -h, --help       Show this help
  --version        Show the version
  --out <file>     gas-test build: output file
                   (default: node_modules/.cache/gasdev/gas-test.js)
  --keep           gas-test run: keep the temporary project directory
  --check          html, peers sync: write nothing; exit 1 when a generated
                   file is stale
  --fix            check: write what init writes, then report what is left
                   github: create or update the rulesets
`;

/**
 * @param {string} message
 * @returns {number} Exit code 2.
 */
function usageError(message) {
  process.stderr.write(`gasdev: ${message}\nRun gasdev --help for usage.\n`);
  return 2;
}

/**
 * Runs the CLI.
 *
 * @param {string[]} argv Command-line arguments, without the node and script paths.
 * @returns {Promise<number>} The process exit code: 0 when clean, 1 on drift or error, 2 on invalid usage.
 */
export async function main(argv) {
  if (argv[0] === 'bundle') return bundleMain(argv.slice(1));
  if (argv[0] === 'release') return releaseMain(argv.slice(1));
  if (argv[0] === 'setup' || argv[0] === 'deploy') {
    return ciMain(argv, {
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      cwd: process.cwd(),
    });
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    const { code, message } = /** @type {Error & { code?: string }} */ (error);
    if (!code?.startsWith('ERR_PARSE_ARGS_')) throw error;
    return usageError(message.split('. ')[0]?.replace(/\.$/, '') + '.');
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (command === undefined) return usageError('missing command.');
  const isBuild = command === 'gas-test' && rest.join(' ') === 'build';
  const isRun = command === 'gas-test' && rest.join(' ') === 'run';
  const isCheck = command === 'check' && rest.length === 0;
  const isInit = command === 'init' && rest.length === 0;
  const isGithub = command === 'github' && rest.length === 0;
  const isHtml = command === 'html' && rest.length === 0;
  const isPeers = command === 'peers' && rest.join(' ') === 'sync';
  if (
    !isCheck &&
    !isInit &&
    !isGithub &&
    !isBuild &&
    !isRun &&
    !isHtml &&
    !isPeers
  ) {
    return usageError(`unknown command: ${positionals.join(' ')}.`);
  }
  if (values.out !== undefined && !isBuild) {
    return usageError('--out is only valid with gas-test build.');
  }
  if (values.keep && !isRun) {
    return usageError('--keep is only valid with gas-test run.');
  }
  if (values.check && !isHtml && !isPeers) {
    return usageError('--check is only valid with html or peers sync.');
  }
  if (values.fix && !isCheck && !isGithub) {
    return usageError('--fix is only valid with check or github.');
  }
  try {
    if (isGithub) return runGithub({ fix: values.fix === true });
    if (isHtml) {
      const { html } = loadConfig(process.cwd());
      return runHtml(process.cwd(), html, { check: values.check === true });
    }
    if (isPeers) {
      const { peers } = loadConfig(process.cwd());
      return runPeers(process.cwd(), peers, { check: values.check === true });
    }
    if (isBuild) return runBuild(process.cwd(), { out: values.out });
    if (isRun) return runRun(process.cwd(), { keep: values.keep === true });
    const fixed = isInit || values.fix === true;
    if (fixed) {
      for (const message of initProject(process.cwd())) {
        process.stdout.write(`${message}\n`);
      }
    }
    const { drift } = checkProject(process.cwd());
    const passed = drift.every((d) => d.warning);
    const out = formatReport(drift, { fixed }).join('\n') + '\n';
    (passed ? process.stdout : process.stderr).write(out);
    return passed ? 0 : 1;
  } catch (error) {
    if (
      error instanceof CheckError ||
      error instanceof GasTestError ||
      error instanceof GithubError ||
      error instanceof HtmlError ||
      error instanceof PeersError
    ) {
      process.stderr.write(`gasdev: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
