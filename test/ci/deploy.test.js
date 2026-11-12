// @ts-check
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/ci/cli.js';
import { createClasp } from '../../src/ci/clasp.js';
import { DeployError } from '../../src/ci/errors.js';
import { deploy } from '../../src/ci/deploy.js';
import { fakeClaspBin, readCalls } from './helpers/fake-clasp.js';

const REFRESH = 'refresh-token-SECRET-1234';
const ACCESS = 'access-token-SECRET-5678';
const CLASPRC = JSON.stringify({
  tokens: { default: { refresh_token: REFRESH, access_token: ACCESS } },
});
const DEPLOYMENT = 'AKfycbxDEPLOYMENT';

/** @type {string} */
let root;
/** @type {string} */
let cwd;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gasdev-deploy-'));
  cwd = join(root, 'project');
  mkdirSync(cwd);
  writeFileSync(join(cwd, '.clasp.example.json'), '{"rootDir":"dist"}');
  mkdirSync(join(cwd, 'dist'));
  writeFileSync(
    join(cwd, 'dist', 'appsscript.json'),
    JSON.stringify({ oauthScopes: ['a', 'b'] }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * @param {{
 *   deployments?: any[],
 *   deployedScopes?: string[],
 * }} [options]
 */
function fakeClasp(options = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {Record<string, unknown[]>} */
  const args = {};
  const deployments = options.deployments ?? [
    { deploymentId: DEPLOYMENT, versionNumber: 3 },
  ];
  /**
   * @param {string} name
   * @param {unknown[]} [params]
   */
  const step = (name, params = []) => {
    calls.push(name);
    args[name] = params;
  };
  const clasp = {
    bin: '/fake/clasp.js',
    push: () => step('push'),
    listDeployments: () => {
      step('list');
      return deployments;
    },
    createVersion: (/** @type {string} */ sha) => {
      step('version', [sha]);
      return 4;
    },
    updateDeployment: (
      /** @type {string} */ id,
      /** @type {number} */ version,
      /** @type {string} */ sha,
    ) => step('deploy', [id, version, sha]),
    readVersionManifest: (
      /** @type {string} */ scriptId,
      /** @type {number} */ version,
    ) => {
      step('pull', [scriptId, version]);
      return { oauthScopes: options.deployedScopes ?? ['b', 'a'] };
    },
  };
  /** @type {{ auth?: string | undefined, content?: string }} */
  const used = {};
  return {
    calls,
    args,
    used,
    createClasp: (/** @type {{ auth?: string | undefined }} */ options) => {
      used.auth = options.auth;
      if (options.auth) used.content = readFileSync(options.auth, 'utf8');
      return clasp;
    },
  };
}

/**
 * @param {Record<string, string>} [extra]
 * @param {Parameters<typeof fakeClasp>[0]} [options]
 */
function setup(extra = {}, options) {
  const out = join(root, 'output');
  const summary = join(root, 'summary');
  const stdout = {
    text: '',
    write: (/** @type {string} */ t) => (stdout.text += t),
  };
  const fake = fakeClasp(options);
  const context = {
    env: {
      CLASPRC_JSON: CLASPRC,
      GAS_SCRIPT_ID: 'script-id-1',
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
      ...extra,
    },
    cwd,
    stdout,
    createClasp: fake.createClasp,
  };
  const read = (/** @type {string} */ path) =>
    existsSync(path) ? readFileSync(path, 'utf8') : '';
  return {
    context,
    stdout,
    calls: fake.calls,
    args: fake.args,
    used: fake.used,
    output: () => read(out),
    summary: () => read(summary),
  };
}

describe('deploy', () => {
  it('passes clasp a private credentials file and removes it afterwards', async () => {
    const { context, used } = setup();
    await deploy(context);
    expect(used.auth).toMatch(/gasdev-auth-[^/]+\/\.clasprc\.json$/);
    expect(JSON.parse(used.content ?? '')).toEqual(JSON.parse(CLASPRC));
    expect(existsSync(/** @type {string} */ (used.auth))).toBe(false);
    expect(existsSync(dirname(/** @type {string} */ (used.auth)))).toBe(false);
  });

  it('removes the credentials file when a step fails', async () => {
    const { context, used } = setup({
      GAS_DEPLOYMENT_ID: DEPLOYMENT,
      GITHUB_SHA: 'abc123',
    });
    context.createClasp = (/** @type {any} */ options) => {
      used.auth = options.auth;
      return {
        ...fakeClasp().createClasp(options),
        push: () => {
          throw new DeployError('push failed');
        },
        listDeployments: () => [{ deploymentId: DEPLOYMENT, versionNumber: 3 }],
        readVersionManifest: () => ({ oauthScopes: ['a', 'b'] }),
      };
    };
    await expect(deploy(context)).rejects.toThrow('push failed');
    expect(existsSync(/** @type {string} */ (used.auth))).toBe(false);
    expect(existsSync(dirname(/** @type {string} */ (used.auth)))).toBe(false);
  });

  it('removes the credentials directory when failing before clasp is created', async () => {
    const tmp = join(root, 'tmp');
    mkdirSync(tmp);
    vi.stubEnv('TMPDIR', tmp);
    try {
      expect(tmpdir()).toBe(tmp);
      rmSync(join(cwd, 'dist', 'appsscript.json'));
      const { context } = setup();
      const error = await deploy(context).catch((e) => e);
      expect(error).toBeInstanceOf(DeployError);
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('creates the credentials directory in RUNNER_TEMP when set', async () => {
    const runnerTemp = join(root, 'runner-temp');
    mkdirSync(runnerTemp);
    const { context, used } = setup({ RUNNER_TEMP: runnerTemp });
    await deploy(context);
    const authDir = dirname(/** @type {string} */ (used.auth));
    expect(dirname(authDir)).toBe(runnerTemp);
    expect(basename(authDir)).toMatch(/^gasdev-auth-/);
    expect(readdirSync(runnerTemp)).toEqual([]);
  });

  it('leaves RUNNER_TEMP empty when a step fails', async () => {
    const runnerTemp = join(root, 'runner-temp');
    mkdirSync(runnerTemp);
    const { context } = setup({
      RUNNER_TEMP: runnerTemp,
      GAS_DEPLOYMENT_ID: DEPLOYMENT,
      GITHUB_SHA: 'abc123',
    });
    context.createClasp = (/** @type {any} */ options) => ({
      ...fakeClasp().createClasp(options),
      push: () => {
        throw new DeployError('push failed');
      },
      listDeployments: () => [{ deploymentId: DEPLOYMENT, versionNumber: 3 }],
      readVersionManifest: () => ({ oauthScopes: ['a', 'b'] }),
    });
    await expect(deploy(context)).rejects.toThrow('push failed');
    expect(readdirSync(runnerTemp)).toEqual([]);
  });

  it('fails with a DeployError when RUNNER_TEMP does not exist', async () => {
    const { context } = setup({ RUNNER_TEMP: join(root, 'missing') });
    const error = await deploy(context).catch((e) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect(error.message).toMatch(/cannot create credentials dir in/);
  });

  it('leaves an existing ~/.clasprc.json untouched', async () => {
    const home = join(root, 'home');
    mkdirSync(home);
    const existing = join(home, '.clasprc.json');
    writeFileSync(existing, 'mine');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    try {
      const { context } = setup({ FAKE_CLASP_LOG: join(root, 'clasp.log') });
      await deploy({
        ...context,
        createClasp: (/** @type {any} */ options) =>
          createClasp({ ...options, bin: fakeClaspBin }),
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(readFileSync(existing, 'utf8')).toBe('mine');
    expect(readdirSync(home)).toEqual(['.clasprc.json']);
  });

  it('hands the real clasp only the temporary file, without CLASPRC_JSON', async () => {
    const log = join(root, 'clasp.log');
    const { context, stdout } = setup({ FAKE_CLASP_LOG: log });
    await deploy({
      ...context,
      createClasp: (/** @type {any} */ options) =>
        createClasp({ ...options, bin: fakeClaspBin }),
    });
    expect(stdout.text).toContain(`Using clasp: ${fakeClaspBin}\n`);
    const calls = readCalls(log);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.args.slice(0, 2)).toEqual(['-A', call.authFile]);
      expect(existsSync(/** @type {string} */ (call.authFile))).toBe(false);
      expect(call.envKeys).not.toContain('CLASPRC_JSON');
    }
  });

  it('renders .clasp.json', async () => {
    const { context } = setup();
    await deploy(context);
    expect(JSON.parse(readFileSync(join(cwd, '.clasp.json'), 'utf8'))).toEqual({
      rootDir: 'dist',
      scriptId: 'script-id-1',
    });
  });

  it('only pushes without a deployment ID', async () => {
    const { context, calls, stdout, output, summary } = setup();
    await deploy(context);
    expect(calls).toEqual(['push']);
    expect(stdout.text).toBe(
      'Using clasp: /fake/clasp.js\nPushed (push only).\n',
    );
    expect(output()).toBe('url=\n');
    expect(summary()).toContain('push only');
  });

  it('treats an empty deployment ID as push only', async () => {
    const { context, calls } = setup({ GAS_DEPLOYMENT_ID: '' });
    await deploy(context);
    expect(calls).toEqual(['push']);
  });

  it('pushes and redeploys in order', async () => {
    const { context, calls, args, stdout, output, summary } = setup({
      GAS_DEPLOYMENT_ID: DEPLOYMENT,
      GITHUB_SHA: 'abc123',
    });
    await deploy(context);
    expect(args.pull).toEqual(['script-id-1', 3]);
    expect(args.version).toEqual(['abc123']);
    expect(args.deploy).toEqual([DEPLOYMENT, 4, 'abc123']);
    const url = `https://script.google.com/macros/s/${DEPLOYMENT}/exec`;
    expect(calls).toEqual(['list', 'pull', 'push', 'version', 'deploy']);
    expect(stdout.text).toBe(
      `Using clasp: /fake/clasp.js\nDeployed version 4: ${url}\n`,
    );
    expect(output()).toBe(`url=${url}\n`);
    expect(summary()).toContain(url);
    expect(summary()).toContain('4');
  });

  it('fails before pushing when the scopes change', async () => {
    const { context, calls } = setup(
      { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
      { deployedScopes: ['a', 'old'] },
    );
    const error = await deploy(context).catch((e) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect(error.message).toContain('Added:\n  b');
    expect(error.message).toContain('Removed:\n  old');
    expect(error.message).toContain('#scope-changes');
    expect(calls).toEqual(['list', 'pull']);
  });

  it('exits 1 through the CLI on a scope change', async () => {
    const { context, calls } = setup(
      { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
      { deployedScopes: [] },
    );
    const err = {
      text: '',
      write: (/** @type {string} */ t) => (err.text += t),
    };
    expect(
      await main(['deploy'], /** @type {any} */ ({ ...context, stderr: err })),
    ).toBe(1);
    expect(err.text).toContain('Added');
    expect(calls).not.toContain('push');
  });

  it('fails when the deployment is missing', async () => {
    const { context, calls } = setup(
      { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
      { deployments: [{ deploymentId: 'other', versionNumber: 1 }] },
    );
    await expect(deploy(context)).rejects.toThrow(/does not match/);
    expect(calls).toEqual(['list']);
  });

  it('fails when the deployment is HEAD', async () => {
    const { context, calls } = setup(
      { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
      { deployments: [{ deploymentId: DEPLOYMENT }] },
    );
    await expect(deploy(context)).rejects.toThrow(/HEAD/);
    expect(calls).toEqual(['list']);
  });

  it('skips non-object items when looking for the deployment', async () => {
    const { context, calls } = setup(
      { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
      {
        deployments: [
          null,
          'x',
          { deploymentId: DEPLOYMENT, versionNumber: 3 },
        ],
      },
    );
    await deploy(context);
    expect(calls).toEqual(['list', 'pull', 'push', 'version', 'deploy']);
  });

  it.each([null, 0, -1, 1.5, '3'])(
    'treats versionNumber %j as a HEAD deployment',
    async (versionNumber) => {
      const { context, calls } = setup(
        { GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' },
        { deployments: [{ deploymentId: DEPLOYMENT, versionNumber }] },
      );
      await expect(deploy(context)).rejects.toThrow(/HEAD/);
      expect(calls).toEqual(['list']);
    },
  );

  it('requires GITHUB_SHA when redeploying', async () => {
    const { context, calls } = setup({ GAS_DEPLOYMENT_ID: DEPLOYMENT });
    await expect(deploy(context)).rejects.toThrow(/GITHUB_SHA/);
    expect(calls).toEqual([]);
  });

  it('fails when the built manifest is missing', async () => {
    rmSync(join(cwd, 'dist', 'appsscript.json'));
    const { context, calls } = setup();
    await expect(deploy(context)).rejects.toThrow(
      'dist/appsscript.json not found; run the build first.',
    );
    expect(calls).toEqual([]);
  });

  it('fails when the built manifest is not valid JSON', async () => {
    writeFileSync(join(cwd, 'dist', 'appsscript.json'), '{');
    const { context } = setup();
    await expect(deploy(context)).rejects.toThrow(/not valid JSON/);
  });
});

describe('secret leakage', () => {
  const secrets = [REFRESH, ACCESS];

  /** @param {string} text */
  const leaks = (text) => secrets.some((secret) => text.includes(secret));

  it('prints no secret outside Actions', async () => {
    const s = setup({ GAS_DEPLOYMENT_ID: DEPLOYMENT, GITHUB_SHA: 'abc123' });
    await deploy(s.context);
    expect(leaks(s.stdout.text + s.output() + s.summary())).toBe(false);
  });

  it('redacts a secret echoed by a failing clasp', async () => {
    const s = setup({
      FAKE_CLASP_LOG: join(root, 'clasp.log'),
      FAKE_CLASP_FAIL: 'push',
      FAKE_CLASP_ECHO: REFRESH,
    });
    const context = {
      ...s.context,
      createClasp: (/** @type {any} */ options) =>
        createClasp({ ...options, bin: fakeClaspBin }),
    };
    const err = {
      text: '',
      write: (/** @type {string} */ t) => (err.text += t),
    };
    const code = await main(
      ['deploy'],
      /** @type {any} */ ({ ...context, stderr: err }),
    );
    expect(code).toBe(1);
    expect(err.text).toContain('***');
    expect(leaks(s.stdout.text + s.output() + s.summary() + err.text)).toBe(
      false,
    );
  });

  it('leaks nothing when the redeploy fails in Actions', async () => {
    const s = setup({
      GITHUB_ACTIONS: 'true',
      GAS_DEPLOYMENT_ID: DEPLOYMENT,
      GITHUB_SHA: 'abc123',
      FAKE_CLASP_LOG: join(root, 'clasp.log'),
      FAKE_CLASP_DEPLOYMENTS: JSON.stringify([
        { deploymentId: DEPLOYMENT, versionNumber: 3 },
      ]),
      FAKE_CLASP_MANIFEST: JSON.stringify({ oauthScopes: ['a', 'b'] }),
      FAKE_CLASP_FAIL: 'create-deployment',
      FAKE_CLASP_ECHO: `${REFRESH} ${ACCESS}`,
    });
    const context = {
      ...s.context,
      createClasp: (/** @type {any} */ options) =>
        createClasp({ ...options, bin: fakeClaspBin }),
    };
    const err = {
      text: '',
      write: (/** @type {string} */ t) => (err.text += t),
    };
    expect(
      await main(['deploy'], /** @type {any} */ ({ ...context, stderr: err })),
    ).toBe(1);
    expect(err.text).toContain('exploded');
    expect(leaks(err.text + s.output() + s.summary())).toBe(false);
    const unmasked = s.stdout.text
      .split('\n')
      .filter((line) => !line.startsWith('::add-mask::'))
      .join('\n');
    expect(leaks(unmasked)).toBe(false);
    expect(s.output()).not.toContain('url=');
  });

  it('prints secrets only on mask lines in Actions', async () => {
    const s = setup({
      GITHUB_ACTIONS: 'true',
      GAS_DEPLOYMENT_ID: DEPLOYMENT,
      GITHUB_SHA: 'abc123',
    });
    await deploy(s.context);
    const lines = s.stdout.text.split('\n').filter(Boolean);
    expect(lines.slice(0, 2).sort()).toEqual(
      secrets.map((secret) => `::add-mask::${secret}`).sort(),
    );
    expect(lines[2]).toBe('Using clasp: /fake/clasp.js');
    const rest = lines.slice(2).join('\n');
    expect(leaks(rest + s.output() + s.summary())).toBe(false);
  });
});
