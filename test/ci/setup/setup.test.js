// @ts-check
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClasp } from '../../../src/ci/clasp.js';
import { CancelledError, DeployError } from '../../../src/ci/errors.js';
import { createIo } from '../../../src/ci/setup/io.js';
import { setup } from '../../../src/ci/setup/setup.js';
import { fakeClaspBin, readCalls } from '../helpers/fake-clasp.js';
import { cleanup, createFakeLog, createProject } from './helpers/project.js';

const { version } = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
);

const DEPLOYMENTS = JSON.stringify([
  { deploymentId: 'HEAD-id', description: '@HEAD' },
  { deploymentId: 'AKfy-1', versionNumber: 1, description: 'one' },
  { deploymentId: 'AKfy-2', versionNumber: 2, description: 'two' },
]);

/** @type {{ logPath: string, cleanup: () => void }} */
let fake;

beforeEach(() => {
  fake = createFakeLog();
});

afterEach(() => {
  /** @type {any} */ (prompts)._injected = [];
  fake.cleanup();
  cleanup();
});

/**
 * Runs `setup()` in process with the fake clasp and injected prompt answers.
 *
 * @param {string} cwd
 * @param {unknown[]} answers Values for `prompts.inject`; `null` cancels the prompt.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function run(cwd, answers, env = {}) {
  const out = new PassThrough();
  const err = new PassThrough();
  /** @type {Buffer[]} */
  const outChunks = [];
  /** @type {Buffer[]} */
  const errChunks = [];
  out.on('data', (chunk) => outChunks.push(chunk));
  err.on('data', (chunk) => errChunks.push(chunk));
  prompts.inject(answers.map((a) => (a === null ? new Error('cancel') : a)));
  const collect = () => ({
    stdout: Buffer.concat(outChunks).toString('utf8'),
    stderr: Buffer.concat(errChunks).toString('utf8'),
  });
  try {
    await setup(
      cwd,
      createIo({
        stdout: /** @type {any} */ (out),
        stderr: /** @type {any} */ (err),
      }),
      {
        createClasp: (options) =>
          createClasp({
            ...options,
            bin: fakeClaspBin,
            env: { ...options.env, FAKE_CLASP_LOG: fake.logPath, ...env },
          }),
      },
    );
  } catch (error) {
    throw Object.assign(/** @type {object} */ (error), { output: collect() });
  }
  return collect();
}

describe('setup', () => {
  it('runs the wizard end to end', async () => {
    const cwd = createProject({
      git: true,
      gitignore: '.env\n.clasp.json\nappsscript.json\n',
      clasp: { scriptId: '', rootDir: 'src' },
    });
    const { stdout, stderr } = await run(cwd, ['keep', 'Etc/UTC', '', true], {
      FAKE_CLASP_USER: 'dev@example.com',
      FAKE_CLASP_DEPLOYMENTS: DEPLOYMENTS,
      FAKE_CLASP_SCRIPT_ID: 'script-9',
    });
    expect(stderr).toBe('Warning: Manual web app deployment required.\n');

    const commands = readCalls(fake.logPath).map((c) =>
      c.args[0] === '--json' ? c.args[1] : c.args[0],
    );
    expect(commands).toEqual([
      'show-authorized-user',
      'create-script',
      'push',
      'open-script',
      'list-deployments',
    ]);

    expect(JSON.parse(readFileSync(join(cwd, '.clasp.json'), 'utf8'))).toEqual({
      scriptId: 'script-9',
      rootDir: 'src',
    });
    expect(
      JSON.parse(readFileSync(join(cwd, 'src/appsscript.json'), 'utf8')),
    ).toMatchObject({ timeZone: 'Etc/UTC', runtimeVersion: 'V8' });
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toBe(
      [
        'GAS_SCRIPT_ID=script-9',
        'GAS_WEBAPP_URL=https://script.google.com/macros/s/AKfy-2/exec',
        'GAS_DEPLOYMENT_ID=AKfy-2',
        'GAS_VERSION=2',
        '',
      ].join('\n'),
    );
    expect(stdout).toContain(`gasdev ${version}`);
    expect(stdout).toContain('Script ID:     script-9');
    expect(stdout).toContain(
      'Web app URL:   https://script.google.com/macros/s/AKfy-2/exec',
    );
    expect(stdout).toContain('Version:       2');
  });

  it('fails without running clasp when .env is not ignored', async () => {
    const cwd = createProject({ git: true, gitignore: 'node_modules\n' });
    const error = await run(cwd, []).catch((e) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect(error.message).toMatch(/^\.env is not ignored/);
    expect(error.output.stdout).toBe('');
    expect(readCalls(fake.logPath)).toEqual([]);
    expect(existsSync(join(cwd, '.env'))).toBe(false);
  });

  it('rejects with CancelledError when a prompt is cancelled', async () => {
    const cwd = createProject();
    const error = await run(cwd, [null], {
      FAKE_CLASP_USER: 'dev@example.com',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(CancelledError);
  });

  describe('missing templates', () => {
    it('creates both defaults after confirmation and continues', async () => {
      const cwd = createProject({ clasp: null, manifest: null });
      const { stdout } = await run(cwd, [true, 'keep', 'Etc/UTC', '', true], {
        FAKE_CLASP_USER: 'dev@example.com',
        FAKE_CLASP_DEPLOYMENTS: DEPLOYMENTS,
        FAKE_CLASP_SCRIPT_ID: 'script-9',
      });
      expect(readFileSync(join(cwd, '.clasp.example.json'), 'utf8')).toBe(
        `${JSON.stringify({ rootDir: 'dist' }, null, 2)}\n`,
      );
      expect(readFileSync(join(cwd, 'appsscript.example.json'), 'utf8')).toBe(
        `${JSON.stringify(
          {
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: [],
          },
          null,
          2,
        )}\n`,
      );
      expect(stdout).toContain(
        'Created .clasp.example.json; review and commit it.',
      );
      expect(stdout).toContain(
        'Created appsscript.example.json; review and commit it.',
      );
      const commands = readCalls(fake.logPath).map((c) =>
        c.args[0] === '--json' ? c.args[1] : c.args[0],
      );
      expect(commands[0]).toBe('show-authorized-user');
    });

    it('creates only the missing file', async () => {
      const cwd = createProject({
        clasp: { scriptId: '', rootDir: 'src' },
        manifest: null,
      });
      const before = readFileSync(join(cwd, '.clasp.example.json'), 'utf8');
      await run(cwd, [true, 'keep', 'Etc/UTC', '', true], {
        FAKE_CLASP_USER: 'dev@example.com',
        FAKE_CLASP_DEPLOYMENTS: DEPLOYMENTS,
        FAKE_CLASP_SCRIPT_ID: 'script-9',
      });
      expect(readFileSync(join(cwd, 'appsscript.example.json'), 'utf8')).toBe(
        `${JSON.stringify(
          {
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: [],
          },
          null,
          2,
        )}\n`,
      );
      expect(readFileSync(join(cwd, '.clasp.example.json'), 'utf8')).toBe(
        before,
      );
    });

    it('fails naming the files when declined', async () => {
      const cwd = createProject({ clasp: null, manifest: null });
      const error = await run(cwd, [false]).catch((e) => e);
      expect(error).toBeInstanceOf(DeployError);
      expect(error.message).toContain('.clasp.example.json');
      expect(error.message).toContain('appsscript.example.json');
      expect(error.message).toContain('README');
      expect(existsSync(join(cwd, '.clasp.example.json'))).toBe(false);
      expect(existsSync(join(cwd, 'appsscript.example.json'))).toBe(false);
    });

    it('uses singular wording when one file is missing and declined', async () => {
      const cwd = createProject({
        clasp: { scriptId: '', rootDir: 'src' },
        manifest: null,
      });
      const error = await run(cwd, [false]).catch((e) => e);
      expect(error).toBeInstanceOf(DeployError);
      expect(error.message).toContain('create it or rerun');
    });

    it('rejects with CancelledError when the prompt is cancelled', async () => {
      const cwd = createProject({ clasp: null, manifest: null });
      const error = await run(cwd, [null]).catch((e) => e);
      expect(error).toBeInstanceOf(CancelledError);
    });

    it('writes nothing without a package.json', async () => {
      const cwd = createProject({ clasp: null, manifest: null });
      rmSync(join(cwd, 'package.json'));
      const error = await run(cwd, []).catch((e) => e);
      expect(error).toBeInstanceOf(DeployError);
      expect(error.message).toBe('package.json not found.');
      expect(existsSync(join(cwd, '.clasp.example.json'))).toBe(false);
      expect(existsSync(join(cwd, 'appsscript.example.json'))).toBe(false);
    });
  });
});
