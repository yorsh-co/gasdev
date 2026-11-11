// @ts-check
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectClaspBin as resolveBin } from '../../src/clasp-bin.js';
import { createClasp, resolveClaspBin } from '../../src/ci/clasp.js';
import { DeployError } from '../../src/ci/errors.js';
import { fakeClaspBin, readCalls } from './helpers/fake-clasp.js';

vi.mock('../../src/clasp-bin.js', async (importOriginal) => {
  const actual = /** @type {typeof import('../../src/clasp-bin.js')} */ (
    await importOriginal()
  );
  return {
    ...actual,
    resolveProjectClaspBin: vi.fn(actual.resolveProjectClaspBin),
  };
});

const SECRET = 'super-secret-token';
const STRIPPED = [
  'CLASPRC_JSON',
  'clasp_config_auth',
  'clasp_config_project',
  'clasp_config_ignore',
];
const redact = (/** @type {string} */ text) => text.replaceAll(SECRET, '***');

describe('createClasp', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let logPath;
  /** @type {Record<string, string>} */
  let extraEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clasp-test-'));
    logPath = join(dir, 'calls.log');
    extraEnv = {};
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = () =>
    createClasp({
      cwd: dir,
      env: { ...process.env, FAKE_CLASP_LOG: logPath, ...extraEnv },
      redact,
      bin: fakeClaspBin,
    });

  it("resolves the project's clasp from cwd when no bin is given", () => {
    vi.mocked(resolveBin).mockClear();
    createClasp({ cwd: '/project', env: {} });
    expect(resolveBin).toHaveBeenCalledWith('/project');
  });

  it('exposes the clasp bin in use', () => {
    expect(make().bin).toBe(fakeClaspBin);
  });

  it('pushes with --force in the working directory', () => {
    make().push();
    const [call] = readCalls(logPath);
    expect(call?.args).toEqual(['push', '--force']);
    expect(call?.cwd).toBe(dir);
  });

  it('does not pass credentials or clasp config overrides from the environment', () => {
    extraEnv.clasp_config_auth = '/elsewhere/auth';
    extraEnv.clasp_config_project = '/elsewhere/project';
    extraEnv.clasp_config_ignore = '/elsewhere/ignore';
    extraEnv.CLASPRC_JSON = '{"tokens":{"default":{}}}';
    extraEnv.GASDEV_SENTINEL = 'x';
    make().push();
    const keys = readCalls(logPath)[0]?.envKeys ?? [];
    expect(keys).toContain('GASDEV_SENTINEL');
    for (const key of STRIPPED) expect(keys).not.toContain(key);
  });

  it('strips the clasp config overrides regardless of key case', () => {
    extraEnv.CLASP_CONFIG_AUTH = '/elsewhere/auth';
    extraEnv.Clasp_Config_Project = '/elsewhere/project';
    extraEnv.CLASP_CONFIG_IGNORE = '/elsewhere/ignore';
    extraEnv.clasprc_json = '{"tokens":{"default":{}}}';
    extraEnv.GASDEV_SENTINEL = 'x';
    make().push();
    const keys = readCalls(logPath)[0]?.envKeys ?? [];
    expect(keys).toContain('GASDEV_SENTINEL');
    for (const key of [
      'CLASP_CONFIG_AUTH',
      'Clasp_Config_Project',
      'CLASP_CONFIG_IGNORE',
      'clasprc_json',
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  it('lists deployments', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = JSON.stringify([
      { deploymentId: 'd1', versionNumber: 3 },
    ]);
    expect(make().listDeployments()).toEqual([
      { deploymentId: 'd1', versionNumber: 3 },
    ]);
    expect(readCalls(logPath)[0]?.args).toEqual(['--json', 'list-deployments']);
  });

  it('rejects a deployments result that is not an array', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = '{}';
    expect(() => make().listDeployments()).toThrow(/unexpected result/);
  });

  it('rejects invalid JSON without leaking secrets', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = `not json ${SECRET}`;
    let error;
    try {
      make().listDeployments();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DeployError);
    expect(String(/** @type {Error} */ (error).message)).toMatch(
      /invalid JSON/,
    );
    expect(String(/** @type {Error} */ (error).message)).not.toContain(SECRET);
  });

  it('creates a version and returns its number', () => {
    expect(make().createVersion('abc123')).toBe(7);
    expect(readCalls(logPath)[0]?.args).toEqual([
      '--json',
      'create-version',
      'abc123',
    ]);
  });

  it.each(['{"versionNumber":0}', '{"versionNumber":"7"}', '{}'])(
    'rejects an invalid version result %s',
    (output) => {
      extraEnv.FAKE_CLASP_VERSION_OUTPUT = output;
      expect(() => make().createVersion('x')).toThrow(/valid version number/);
    },
  );

  it('updates a deployment', () => {
    make().updateDeployment('dep-1', 7, 'abc123');
    expect(readCalls(logPath)[0]?.args).toEqual([
      '--json',
      'create-deployment',
      '-i',
      'dep-1',
      '-V',
      '7',
      '-d',
      'abc123',
    ]);
  });

  it('rejects a deployment result with a different ID', () => {
    extraEnv.FAKE_CLASP_DEPLOY_OUTPUT = '{"deploymentId":"other"}';
    expect(() => make().updateDeployment('dep-1', 7, 'x')).toThrow(
      /different deployment/,
    );
  });

  it('reads a version manifest through a temp project and removes it', () => {
    extraEnv.FAKE_CLASP_MANIFEST = JSON.stringify({ oauthScopes: ['a'] });
    expect(make().readVersionManifest('script-1', 4)).toEqual({
      oauthScopes: ['a'],
    });
    const [call] = readCalls(logPath);
    expect(call?.args).toEqual([
      '-P',
      call?.projectDir,
      'pull',
      '--versionNumber',
      '4',
    ]);
    expect(JSON.parse(call?.files['.clasp.json'] ?? '')).toEqual({
      scriptId: 'script-1',
      rootDir: '.',
    });
    expect(existsSync(/** @type {string} */ (call?.projectDir))).toBe(false);
    expect(call?.projectDir).not.toBe(dir);
    expect(call?.projectDir?.startsWith(join(tmpdir(), 'gasdev-pull-'))).toBe(
      true,
    );
  });

  it('removes the temp dir when pull fails', () => {
    extraEnv.FAKE_CLASP_FAIL = 'pull';
    expect(() => make().readVersionManifest('script-1', 4)).toThrow(
      /clasp pull failed/,
    );
    const [call] = readCalls(logPath);
    expect(existsSync(/** @type {string} */ (call?.projectDir))).toBe(false);
  });

  it('includes redacted output on failure', () => {
    extraEnv.FAKE_CLASP_FAIL = 'push';
    extraEnv.FAKE_CLASP_ECHO = SECRET;
    let error;
    try {
      make().push();
    } catch (e) {
      error = e;
    }
    const message = String(/** @type {Error} */ (error).message);
    expect(message).toContain('clasp push failed (exit 1)');
    expect(message).toContain('push exploded ***');
    expect(message).not.toContain(SECRET);
  });

  it('rejects a pull that writes no manifest and removes the temp dir', () => {
    extraEnv.FAKE_CLASP_NO_MANIFEST = '1';
    expect(() => make().readVersionManifest('script-1', 4)).toThrow(
      DeployError,
    );
    expect(() => make().readVersionManifest('script-1', 4)).toThrow(
      /no readable appsscript\.json/,
    );
    const [call] = readCalls(logPath);
    expect(existsSync(/** @type {string} */ (call?.projectDir))).toBe(false);
  });

  it.each(['not json', 'null', '[]', '3'])(
    'rejects an invalid manifest %s',
    (manifest) => {
      extraEnv.FAKE_CLASP_MANIFEST = manifest;
      expect(() => make().readVersionManifest('script-1', 4)).toThrow(
        /no readable appsscript\.json/,
      );
      const [call] = readCalls(logPath);
      expect(existsSync(/** @type {string} */ (call?.projectDir))).toBe(false);
    },
  );

  it('redacts output echoed in an unexpected result', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = `"${SECRET}"`;
    let error;
    try {
      make().listDeployments();
    } catch (e) {
      error = e;
    }
    const message = String(/** @type {Error} */ (error).message);
    expect(error).toBeInstanceOf(DeployError);
    expect(message).toMatch(/unexpected result/);
    expect(message).not.toContain(SECRET);
  });

  it.each(['create-version', 'create-deployment'])(
    'redacts a failing %s',
    (command) => {
      extraEnv.FAKE_CLASP_FAIL = command;
      extraEnv.FAKE_CLASP_ECHO = SECRET;
      const clasp = make();
      let error;
      try {
        if (command === 'create-deployment')
          clasp.updateDeployment('d', 1, 'x');
        else clasp.createVersion('x');
      } catch (e) {
        error = e;
      }
      const message = String(/** @type {Error} */ (error).message);
      expect(error).toBeInstanceOf(DeployError);
      expect(message).toContain(`clasp ${command} failed (exit 1)`);
      expect(message).not.toContain(SECRET);
    },
  );

  it('passes -A and names the command, not the auth path, in errors', () => {
    extraEnv.FAKE_CLASP_FAIL = 'push';
    const clasp = createClasp({
      cwd: dir,
      env: { ...process.env, FAKE_CLASP_LOG: logPath, ...extraEnv },
      bin: fakeClaspBin,
      auth: '/secret/auth.json',
    });
    expect(() => clasp.push()).toThrow(/^clasp push failed/);
    expect(readCalls(logPath)[0]?.args).toEqual([
      '-A',
      '/secret/auth.json',
      'push',
      '--force',
    ]);
  });

  it('reports the signal when clasp is killed', () => {
    extraEnv.FAKE_CLASP_KILL = 'push';
    expect(() => make().push()).toThrow(/clasp push failed \(exit SIGTERM\)/);
  });

  it('reports a spawn failure', () => {
    const clasp = createClasp({
      cwd: join(dir, 'missing'),
      env: process.env,
      redact,
      bin: fakeClaspBin,
    });
    expect(() => clasp.push()).toThrow(/clasp push failed to start/);
  });
});

describe('createClasp setup commands', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let logPath;
  /** @type {Record<string, string>} */
  let extraEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clasp-test-'));
    logPath = join(dir, 'calls.log');
    extraEnv = {};
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = () =>
    createClasp({
      cwd: dir,
      env: { ...process.env, FAKE_CLASP_LOG: logPath, ...extraEnv },
      bin: fakeClaspBin,
    });

  it('reports the authorized user', () => {
    extraEnv.FAKE_CLASP_USER = 'me@example.com';
    expect(make().whoAmI()).toEqual({
      loggedIn: true,
      email: 'me@example.com',
    });
    expect(readCalls(logPath)[0]?.args).toEqual([
      '--json',
      'show-authorized-user',
    ]);
  });

  it('reports a logged-out user', () => {
    expect(make().whoAmI()).toEqual({ loggedIn: false, email: undefined });
  });

  it('rejects a show-authorized-user result that is not an object', () => {
    extraEnv.FAKE_CLASP_OUTPUT = '[]';
    expect(() => make().whoAmI()).toThrow(/unexpected result/);
  });

  it('logs in and then reports the new user', () => {
    extraEnv.FAKE_CLASP_LOGIN_USER = 'new@example.com';
    const clasp = make();
    clasp.login();
    expect(readCalls(logPath)[0]?.args).toEqual(['login']);
    expect(clasp.whoAmI().email).toBe('new@example.com');
  });

  it('opens the script', () => {
    make().openScript();
    expect(readCalls(logPath)[0]?.args).toEqual(['open-script']);
  });

  it('creates a script in a temp dir that is removed afterwards', () => {
    extraEnv.FAKE_CLASP_SCRIPT_ID = 'abc';
    expect(make().create('My app')).toEqual({ scriptId: 'abc' });
    const [call] = readCalls(logPath);
    const rootDir = /** @type {string} */ (call?.args[5]);
    expect(call?.args.slice(0, 5)).toEqual([
      '--json',
      'create-script',
      '--title',
      'My app',
      '--rootDir',
    ]);
    expect(call?.cwd).toContain('gasdev-create-');
    expect(rootDir).toBeTruthy();
    expect(existsSync(rootDir)).toBe(false);
  });

  it('removes the create temp dir when clasp fails', () => {
    extraEnv.FAKE_CLASP_FAIL = 'create-script';
    expect(() => make().create('x')).toThrow(DeployError);
    const [call] = readCalls(logPath);
    expect(existsSync(/** @type {string} */ (call?.args[5]))).toBe(false);
  });

  it.each(['{}', '{"scriptId":""}', '{"scriptId":3}', '[]'])(
    'rejects a create-script result %s',
    (output) => {
      extraEnv.FAKE_CLASP_OUTPUT = output;
      expect(() => make().create('x')).toThrow(DeployError);
    },
  );

  it('omits captured output from an inherited command failure', () => {
    extraEnv.FAKE_CLASP_FAIL = 'login';
    extraEnv.FAKE_CLASP_ECHO = 'leaky-detail';
    let error;
    try {
      make().login();
    } catch (e) {
      error = e;
    }
    const message = String(/** @type {Error} */ (error).message);
    expect(message).toBe('clasp login failed (exit 1):');
    expect(message).not.toContain('exploded');
    expect(message).not.toContain('leaky-detail');
  });

  it('returns no captured output from a successful inherited command', () => {
    expect(make().login()).toBeUndefined();
  });

  it('reports logged in without an email', () => {
    extraEnv.FAKE_CLASP_OUTPUT = '{"loggedIn":true}';
    expect(make().whoAmI()).toEqual({ loggedIn: true, email: undefined });
  });

  it('treats a non-boolean loggedIn as logged out', () => {
    extraEnv.FAKE_CLASP_OUTPUT = '{"loggedIn":"true"}';
    expect(make().whoAmI().loggedIn).toBe(false);
  });

  it('lists deployments without a scriptId for an empty string', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = '[]';
    make().listDeployments('');
    expect(readCalls(logPath)[0]?.args).toEqual(['--json', 'list-deployments']);
  });

  it('strips the clasp config overrides', () => {
    extraEnv.clasp_config_auth = '/elsewhere/auth';
    extraEnv.clasp_config_project = '/elsewhere/project';
    extraEnv.clasp_config_ignore = '/elsewhere/ignore';
    extraEnv.CLASPRC_JSON = '{"tokens":{"default":{}}}';
    extraEnv.GASDEV_SENTINEL = 'x';
    make().whoAmI();
    make().login();
    const calls = readCalls(logPath);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.envKeys).toContain('GASDEV_SENTINEL');
      for (const key of STRIPPED) expect(call.envKeys).not.toContain(key);
    }
  });

  it('lists deployments with and without a scriptId', () => {
    extraEnv.FAKE_CLASP_DEPLOYMENTS = JSON.stringify([{ deploymentId: 'd1' }]);
    const clasp = make();
    expect(clasp.listDeployments()).toEqual([{ deploymentId: 'd1' }]);
    expect(clasp.listDeployments('s1')).toEqual([{ deploymentId: 'd1' }]);
    expect(readCalls(logPath).map((c) => c.args)).toEqual([
      ['--json', 'list-deployments'],
      ['--json', 'list-deployments', 's1'],
    ]);
  });
});

describe('resolveClaspBin', () => {
  it('wraps a resolution failure in a DeployError', () => {
    vi.mocked(resolveBin).mockImplementationOnce(() => {
      throw new Error(
        '@google/clasp is not installed. Install it with `npm install -D @google/clasp`.',
      );
    });
    expect(() => resolveClaspBin('/project')).toThrow(DeployError);
    vi.mocked(resolveBin).mockImplementationOnce(() => {
      throw new Error(
        '@google/clasp is not installed. Install it with `npm install -D @google/clasp`.',
      );
    });
    expect(() => resolveClaspBin('/project')).toThrow(
      '@google/clasp is not installed. Install it with `npm install -D @google/clasp`.',
    );
  });

  it("resolves the project's clasp before the one next to this package", () => {
    const root = mkdtempSync(join(tmpdir(), 'gasdev-proj-'));
    try {
      const pkgDir = join(root, 'node_modules', '@google', 'clasp');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}');
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
          name: '@google/clasp',
          main: 'bin.js',
          bin: { clasp: 'bin.js' },
        }),
      );
      writeFileSync(join(pkgDir, 'bin.js'), '');
      expect(realpathSync(resolveClaspBin(root))).toBe(
        realpathSync(join(pkgDir, 'bin.js')),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
