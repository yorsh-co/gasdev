// @ts-check
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectClaspBin } from '../clasp-bin.js';
import { DeployError } from './errors.js';

const STRIPPED_ENV = new Set([
  'clasprc_json',
  'clasp_config_auth',
  'clasp_config_project',
  'clasp_config_ignore',
]);

/**
 * Resolves the `@google/clasp` bin, project-first.
 *
 * @param {string} root Project root.
 * @returns {string}
 * @throws {DeployError} When clasp is not installed.
 */
export function resolveClaspBin(root) {
  try {
    return resolveProjectClaspBin(root);
  } catch (error) {
    throw new DeployError(/** @type {Error} */ (error).message);
  }
}

/**
 * @typedef {object} Deployment
 * @property {string} deploymentId
 * @property {number} [versionNumber] Absent for the HEAD deployment.
 * @property {string} [description]
 */

/**
 * @typedef {object} Clasp
 * @property {string} bin Absolute path of the clasp entry script in use.
 * @property {() => { loggedIn: boolean, email: string | undefined }} whoAmI
 * @property {() => void} login Interactive; inherits the terminal.
 * @property {(title: string) => { scriptId: string }} create
 * @property {() => void} openScript Interactive; inherits the terminal.
 * @property {() => void} push
 * @property {(scriptId?: string) => Deployment[]} listDeployments
 * @property {(description: string) => number} createVersion
 * @property {(id: string, version: number, description: string) => void} updateDeployment
 * @property {(scriptId: string, version: number) => any} readVersionManifest
 */

/**
 * Creates a wrapper around the clasp CLI. clasp runs through the current Node binary, without a
 * shell or PATH lookup; its output is redacted before it reaches any error message.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(text: string) => string} [options.redact] Applied to clasp output in error messages; identity by default.
 * @param {string} [options.bin] clasp entry script; defaults to the project's `@google/clasp`, then this package's.
 * @param {string} [options.auth] Credentials file passed to every command as `-A`; clasp defaults to `~/.clasprc.json`.
 * @returns {Clasp}
 */
export function createClasp({ cwd, env, redact = (text) => text, bin, auth }) {
  const claspBin = bin ?? resolveClaspBin(cwd);
  // clasp reads clasp_config_* from the environment and they could redirect it to other credentials,
  // project or ignore file; CLASPRC_JSON holds the raw credentials and clasp must not see them.
  // Keys are matched case-insensitively (Windows env is case-insensitive).
  const claspEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => !STRIPPED_ENV.has(key.toLowerCase())),
  );

  /**
   * @param {string[]} args
   * @param {{ cwd?: string, inherit?: boolean }} [options] `inherit` attaches clasp to the terminal,
   *   so its output is not captured or included in failure messages.
   * @returns {string}
   */
  function run(args, options = {}) {
    const fullArgs = auth === undefined ? args : ['-A', auth, ...args];
    let rest = fullArgs;
    while (rest[0] === '-A' || rest[0] === '-P') rest = rest.slice(2);
    const name = rest.find((arg) => !arg.startsWith('-')) ?? rest[0];
    const result = spawnSync(process.execPath, [claspBin, ...fullArgs], {
      cwd: options.cwd ?? cwd,
      env: claspEnv,
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
      throw new DeployError(
        `clasp ${name} failed to start: ${redact(result.error.message)}`,
      );
    }
    if (result.status !== 0) {
      const status = result.status ?? result.signal;
      const output = options.inherit
        ? ''
        : `\n${redact(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim())}`;
      throw new DeployError(`clasp ${name} failed (exit ${status}):${output}`);
    }
    return result.stdout ?? '';
  }

  /**
   * Runs a `--json` command and checks the shape of its result.
   *
   * @param {string[]} args
   * @param {'object' | 'array'} [shape]
   * @param {{ cwd?: string }} [options]
   * @returns {any}
   */
  function runJson(args, shape = 'object', options = {}) {
    const stdout = run(['--json', ...args], options);
    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new DeployError(
        `clasp ${args[0]} returned invalid JSON:\n${redact(stdout.trim())}`,
      );
    }
    const valid =
      shape === 'array'
        ? Array.isArray(data)
        : typeof data === 'object' && data !== null && !Array.isArray(data);
    if (!valid) {
      throw new DeployError(
        `clasp ${args[0]} returned an unexpected result:\n${redact(stdout.trim())}`,
      );
    }
    return data;
  }

  return {
    bin: claspBin,
    push() {
      run(['push', '--force']);
    },
    listDeployments(scriptId) {
      return runJson(
        ['list-deployments', ...(scriptId ? [scriptId] : [])],
        'array',
      );
    },
    whoAmI() {
      const data = /** @type {{ loggedIn?: boolean, email?: string }} */ (
        runJson(['show-authorized-user'])
      );
      return { loggedIn: data.loggedIn === true, email: data.email };
    },
    login() {
      run(['login'], { inherit: true });
    },
    create(title) {
      const dir = mkdtempSync(join(tmpdir(), 'gasdev-create-'));
      try {
        const data = /** @type {{ scriptId?: string }} */ (
          runJson(
            ['create-script', '--title', title, '--rootDir', dir],
            'object',
            { cwd: dir },
          )
        );
        if (typeof data.scriptId !== 'string' || data.scriptId === '') {
          throw new DeployError(
            'clasp create-script did not return a scriptId.',
          );
        }
        return { scriptId: data.scriptId };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    openScript() {
      run(['open-script'], { inherit: true });
    },
    createVersion(description) {
      const data = runJson(['create-version', description]);
      if (!Number.isInteger(data.versionNumber) || data.versionNumber < 1) {
        throw new DeployError(
          'clasp create-version did not return a valid version number.',
        );
      }
      return data.versionNumber;
    },
    updateDeployment(id, version, description) {
      const data = runJson([
        'create-deployment',
        '-i',
        id,
        '-V',
        String(version),
        '-d',
        description,
      ]);
      if (data.deploymentId !== id) {
        throw new DeployError(
          'clasp create-deployment returned a different deployment than requested.',
        );
      }
    },
    readVersionManifest(scriptId, version) {
      const dir = mkdtempSync(join(tmpdir(), 'gasdev-pull-'));
      try {
        writeFileSync(
          join(dir, '.clasp.json'),
          JSON.stringify({ scriptId, rootDir: '.' }),
        );
        run(['-P', dir, 'pull', '--versionNumber', String(version)]);
        const path = join(dir, 'appsscript.json');
        try {
          const manifest = JSON.parse(readFileSync(path, 'utf8'));
          if (
            typeof manifest !== 'object' ||
            manifest === null ||
            Array.isArray(manifest)
          ) {
            throw new Error('not an object');
          }
          return manifest;
        } catch {
          throw new DeployError(
            `Version ${version} of the script has no readable appsscript.json.`,
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
