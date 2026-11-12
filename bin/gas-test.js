// @ts-check
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleError, bundle } from '../src/bundle/index.js';
import { resolveProjectClaspBin } from '../src/clasp-bin.js';
import ts from 'typescript';
import { loadConfig } from './check.js';

/** Default location of the built script, relative to the project root. */
const DEFAULT_OUT = join('node_modules', '.cache', 'gasdev', 'gas-test.js');

const RUNTIME = fileURLToPath(
  new URL('../gas-test/runtime.js', import.meta.url),
);
const RESULT = /@@GAS_TEST@@([A-Za-z0-9+/=]+)@@END@@/;
const SCOPE_PROBLEM = /scope|PERMISSION_DENIED|insufficient/i;
export const INSTALL_HINT =
  '@google/clasp is not installed. Install it with `npm install -D @google/clasp`, then run `npx clasp login`.';

/**
 * @typedef {object} TestResult
 * @property {string} name
 * @property {'PASS' | 'FAIL' | 'INFO'} status
 * @property {number} ms
 * @property {string} [message]
 */

/**
 * @typedef {import('./check.js').ResolvedConfig} ResolvedConfig
 */

/** Raised for an expected failure of a `gas-test` command; its message is shown without a stack trace. */
export class GasTestError extends Error {}

/**
 * Transpiles TypeScript files to JavaScript without type-checking. Each file is
 * written to its own subdirectory of `dir` under its original basename, so the
 * bundle markers stay readable and equal basenames cannot collide.
 *
 * @param {string[]} paths Absolute `.ts` paths.
 * @param {string} dir Output directory.
 * @returns {string[]} The written `.js` paths, in the order given.
 * @throws {GasTestError} When a file cannot be read or has a syntax error.
 */
function transpileAll(paths, dir) {
  return paths.map((path, index) => {
    /** @type {string} */
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch (cause) {
      throw new GasTestError(`cannot read ${path}`, { cause });
    }
    const { outputText, diagnostics = [] } = ts.transpileModule(source, {
      // Matches tsconfig/gas.json: Apps Script rejects ES2021 syntax at push.
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
      fileName: path,
      reportDiagnostics: true,
    });
    const errors = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      const text = errors
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        .join('; ');
      throw new GasTestError(`cannot transpile ${path}: ${text}`);
    }
    const target = join(
      dir,
      String(index),
      basename(path).replace(/\.ts$/, '.js'),
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, outputText);
    return target;
  });
}

/**
 * Lists `gas-test/*.ts` (declaration files excluded) sorted by name.
 *
 * @param {string} cwd Project root.
 * @returns {string[]} Absolute paths.
 * @throws {GasTestError} When there are none.
 */
function testFiles(cwd) {
  const dir = join(cwd, 'gas-test');
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    // Reported below as "no tests".
  }
  const files = names
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))
    .sort();
  if (files.length === 0) {
    throw new GasTestError('no tests found: gas-test/*.ts');
  }
  return files.map((n) => join(dir, n));
}

/**
 * Builds the self-contained Apps Script test file: peers, the library in load
 * order, the test runtime and the tests, validated by the bundle module. The
 * first line is unique per build because `clasp push --force` skips the push
 * when every local file equals the remote, which would leave stale files.
 *
 * @param {string} cwd Project root.
 * @param {ResolvedConfig} config
 * @returns {string} The script.
 * @throws {GasTestError} When `loadOrder` is not set, a source cannot be read or transpiled, there are no tests, or bundling fails.
 */
export function buildGasTest(cwd, { loadOrder, peers }) {
  if (!loadOrder) {
    throw new GasTestError(
      'package.json: "gasdev.loadOrder" is required by gas-test',
    );
  }
  const tests = testFiles(cwd);
  const tmp = mkdtempSync(join(tmpdir(), 'gasdev-build-'));
  try {
    const library = transpileAll(
      loadOrder.map((file) => join(cwd, 'src', file)),
      join(tmp, 'src'),
    );
    const compiled = transpileAll(tests, join(tmp, 'gas-test'));
    const { code } = bundle({
      libraries: peers ?? {},
      cwd,
      extraFiles: [...library, RUNTIME, ...compiled],
    });
    const stamp = `${new Date().toISOString()} ${randomBytes(8).toString('hex')}`;
    return `// gasdev gas-test build ${stamp}\n${code}`;
  } catch (error) {
    if (error instanceof BundleError) {
      throw new GasTestError(error.message, { cause: error });
    }
    throw error;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * `gas-test build`: writes the script and prints its path.
 *
 * @param {string} cwd Project root.
 * @param {{ out?: string | undefined }} options `out` defaults to `node_modules/.cache/gasdev/gas-test.js`.
 * @returns {number} The exit code.
 * @throws {GasTestError} On an unusable project.
 */
export function runBuild(cwd, { out }) {
  const code = buildGasTest(cwd, loadConfig(cwd));
  const file = resolve(cwd, out ?? DEFAULT_OUT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  process.stdout.write(
    `${file}\nRun runGasTests from the Apps Script editor, or npm run test:gas.\n`,
  );
  return 0;
}

/**
 * Locates clasp: the project's own install first, then the one next to this package.
 *
 * @param {string} root Project root.
 * @param {(from?: string | URL) => string} [resolve] Bin resolver.
 * @returns {string}
 * @throws {GasTestError} When clasp is not installed.
 */
export function claspBin(root, resolve) {
  try {
    return resolveProjectClaspBin(root, resolve);
  } catch {
    throw new GasTestError(INSTALL_HINT);
  }
}

/**
 * Runs clasp through the current Node binary, without a shell or PATH lookup.
 *
 * @param {string} bin Path of the clasp bin script.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 * @throws {GasTestError} When clasp cannot be started.
 */
function clasp(bin, args, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new GasTestError(`cannot run clasp: ${result.error.message}`);
  }
  return result;
}

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @returns {string} Trimmed stdout and stderr.
 */
function output(result) {
  return `${result.stdout}${result.stderr}`.trim();
}

/**
 * Runs a clasp command that must succeed.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 * @throws {GasTestError} With clasp's output when it exits non-zero.
 */
function claspStep(bin, args, cwd) {
  const result = clasp(bin, args, cwd);
  if (result.status !== 0) {
    throw new GasTestError(
      `clasp ${args[0]} failed (exit ${result.status}):\n${output(result)}`,
    );
  }
}

/**
 * Creates a temporary Apps Script project holding only the built script.
 * `clasp clone` writes `.clasp.json`; everything else it fetched is removed so
 * `clasp push --force` replaces the whole project.
 *
 * @param {string} bin Path of the clasp bin script.
 * @param {string} dir Empty directory.
 * @param {string} scriptId
 * @param {string[]} scopes
 * @param {string} code The built script.
 * @throws {GasTestError} When clasp fails.
 */
function prepareProject(bin, dir, scriptId, scopes, code) {
  claspStep(bin, ['clone', scriptId, '--rootDir', dir], dir);
  for (const name of readdirSync(dir)) {
    if (name !== '.clasp.json') rmSync(join(dir, name), { recursive: true });
  }
  const manifest = {
    timeZone: 'Etc/UTC',
    runtimeVersion: 'V8',
    exceptionLogging: 'STACKDRIVER',
    executionApi: { access: 'MYSELF' },
    oauthScopes: scopes,
  };
  writeFileSync(
    join(dir, 'appsscript.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'gas-test.js'), code);
}

/**
 * Decodes the results printed by `runGasTests`.
 *
 * @param {string} text Output of `clasp run`.
 * @returns {{ results: TestResult[], elapsedMs: number } | undefined} `undefined` when the output holds no results.
 */
function decodeResults(text) {
  const match = RESULT.exec(text);
  if (!match?.[1]) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(match[1], 'base64').toString('utf8'),
    );
    if (!Array.isArray(decoded?.results)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

/**
 * Formats results like the runtime's execution log, with a summary line.
 *
 * @param {TestResult[]} results
 * @param {number} elapsedMs
 * @returns {string[]}
 */
function formatResults(results, elapsedMs) {
  /** @type {string[]} */
  const lines = [];
  for (const { name, status, ms, message } of results) {
    if (status === 'PASS') lines.push(`PASS ${name} (${ms} ms)`);
    else if (status === 'FAIL') {
      lines.push(`FAIL ${name} (${ms} ms)`, `  ${message}`);
    } else lines.push(`INFO ${name}: ${message}`);
  }
  const count = (/** @type {string} */ s) =>
    results.filter((r) => r.status === s).length;
  lines.push(
    `${count('PASS')} passed, ${count('FAIL')} failed, ${count('INFO')} info in ${(elapsedMs / 1000).toFixed(1)} s`,
  );
  return lines;
}

/**
 * `gas-test run`: pushes the built script to the dedicated test project with
 * clasp, runs `runGasTests` and prints the results. The project's whole
 * contents are replaced.
 *
 * @param {string} cwd Project root.
 * @param {{ keep?: boolean }} options `keep` leaves the temporary project in place.
 * @returns {number} 1 when a test failed or no results came back, else 0.
 * @throws {GasTestError} On an unusable project or a clasp failure.
 */
export function runRun(cwd, { keep = false }) {
  const config = loadConfig(cwd);
  if (!config.gasTest) {
    throw new GasTestError(
      'package.json: "gasdev.gasTest" is required by gas-test run',
    );
  }
  const { scopes } = config.gasTest;
  const scriptId = process.env['GAS_TEST_SCRIPT_ID'] || config.gasTest.scriptId;
  if (!scriptId) {
    throw new GasTestError(
      'no script ID: set GAS_TEST_SCRIPT_ID or "gasdev.gasTest.scriptId"',
    );
  }
  const spreadsheetId = process.env['GAS_TEST_SPREADSHEET_ID'] || undefined;
  const code = buildGasTest(cwd, config);
  const bin = claspBin(cwd);

  const dir = mkdtempSync(join(tmpdir(), 'gasdev-run-'));
  try {
    prepareProject(bin, dir, scriptId, scopes, code);
    claspStep(bin, ['push', '--force'], dir);
    const run = clasp(
      bin,
      [
        'run',
        'runGasTests',
        ...(spreadsheetId ? ['--params', JSON.stringify([spreadsheetId])] : []),
      ],
      dir,
    );
    const decoded = decodeResults(run.stdout);
    if (!decoded) {
      const text = output(run);
      process.stderr.write(`${text}\n`);
      process.stderr.write('gasdev: clasp run returned no test results.\n');
      if (SCOPE_PROBLEM.test(text)) {
        process.stderr.write(
          `The OAuth scopes may be missing. Run: npx clasp login --extra-scopes ${scopes.join(',')}\n`,
        );
      }
      return 1;
    }
    process.stdout.write(
      `${formatResults(decoded.results, decoded.elapsedMs).join('\n')}\n`,
    );
    return decoded.results.some((r) => r.status === 'FAIL') ? 1 : 0;
  } finally {
    if (keep) process.stdout.write(`Test project kept at ${dir}\n`);
    else rmSync(dir, { recursive: true, force: true });
  }
}
