// @ts-check
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClasp } from '../../../src/ci/clasp.js';
import { loadConfig } from '../../../src/ci/setup/config.js';
import { readEnv } from '../../../src/ci/setup/env.js';
import { CancelledError, DeployError } from '../../../src/ci/errors.js';
import { configure } from '../../../src/ci/setup/steps/configure.js';
import { deployment } from '../../../src/ci/setup/steps/deployment.js';
import { login } from '../../../src/ci/setup/steps/login.js';
import { project } from '../../../src/ci/setup/steps/project.js';
import { push } from '../../../src/ci/setup/steps/push.js';
import { fakeClaspBin, readCalls } from '../helpers/fake-clasp.js';
import { cleanup, createFakeLog, createProject } from './helpers/project.js';

/** @type {{ logPath: string, cleanup: () => void }} */
let fake;
/** @type {string[]} */
let lines;

/**
 * Builds a step context for a project with the fake clasp.
 *
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
function context(cwd, env = {}) {
  const clasp = createClasp({
    cwd,
    bin: fakeClaspBin,
    env: {
      ...process.env,
      FAKE_CLASP_LOG: fake.logPath,
      ...env,
    },
  });
  const push = (/** @type {string} */ m) => void lines.push(m);
  return {
    cwd,
    config: loadConfig(cwd),
    clasp,
    io: {
      log: {
        info: push,
        success: push,
        warn: push,
        error: push,
        raw: push,
        section: push,
      },
      prompt: (/** @type {any} */ q) => prompts(q),
    },
    /** @type {any} */ state: {},
  };
}

const calls = () => readCalls(fake.logPath).map((c) => c.args.join(' '));

beforeEach(() => {
  fake = createFakeLog();
  lines = [];
});

afterEach(() => {
  fake.cleanup();
  cleanup();
  vi.restoreAllMocks();
});

describe('login', () => {
  it('keeps the current account', async () => {
    prompts.inject(['keep']);
    await login(context(createProject(), { FAKE_CLASP_USER: 'a@b.co' }));
    expect(calls()).not.toContain('login');
  });

  it('logs in again when asked', async () => {
    prompts.inject(['login']);
    await login(context(createProject(), { FAKE_CLASP_USER: 'a@b.co' }));
    expect(calls()).toContain('login');
  });

  it('logs in when logged out', async () => {
    await login(context(createProject(), { FAKE_CLASP_LOGIN_USER: 'n@b.co' }));
    expect(calls()).toEqual([
      '--json show-authorized-user',
      'login',
      '--json show-authorized-user',
    ]);
    expect(lines).toContain('Logged in as n@b.co.');
  });

  it('fails when still logged out after login', async () => {
    const ctx = context(createProject());
    await expect(login(ctx)).rejects.toThrow(DeployError);
    expect(calls()).toContain('login');
  });
});

describe('project', () => {
  /** @param {string} root */
  const withClasp = (root) =>
    writeFileSync(join(root, '.clasp.json'), '{"scriptId":"old-1"}');

  it('reuses a valid project', async () => {
    const root = createProject();
    withClasp(root);
    prompts.inject(['reuse']);
    const ctx = context(root);
    await project(ctx);
    expect(ctx.state.scriptId).toBe('old-1');
    expect(calls()).toContain('--json list-deployments old-1');
  });

  it('creates a new project on request', async () => {
    const root = createProject();
    withClasp(root);
    prompts.inject(['create']);
    const ctx = context(root, { FAKE_CLASP_SCRIPT_ID: 'new-9' });
    await project(ctx);
    expect(ctx.state.scriptId).toBe('new-9');
  });

  it('creates a project without an existing one, leaving the tree clean', async () => {
    const root = createProject();
    const before = readdirSync(root).sort();
    const ctx = context(root);
    await project(ctx);
    expect(ctx.state.scriptId).toBe('script-123');
    expect(readdirSync(root).sort()).toEqual(before);
    expect(readCalls(fake.logPath)[0]?.cwd).not.toBe(root);
  });

  it('offers a new project when reuse is invalid', async () => {
    const root = createProject();
    withClasp(root);
    prompts.inject(['reuse', true]);
    const ctx = context(root, { FAKE_CLASP_FAIL: 'list-deployments' });
    await project(ctx);
    expect(ctx.state.scriptId).toBe('script-123');
    expect(lines.some((l) => l.includes('list-deployments exploded'))).toBe(
      true,
    );
  });

  it('aborts when an invalid project is not replaced', async () => {
    const root = createProject();
    withClasp(root);
    prompts.inject(['reuse', false]);
    await expect(
      project(context(root, { FAKE_CLASP_FAIL: 'list-deployments' })),
    ).rejects.toThrow(DeployError);
  });
});

describe('configure', () => {
  it('writes the clasp config, manifest and env', async () => {
    const root = createProject({
      clasp: { scriptId: '', rootDir: 'src' },
      manifest: { timeZone: 'Europe/Paris', runtimeVersion: 'V8' },
    });
    const ctx = context(root);
    ctx.state.scriptId = 's-1';
    prompts.inject(['Europe/Paris']);
    await configure(ctx);
    expect(JSON.parse(readFileSync(join(root, '.clasp.json'), 'utf8'))).toEqual(
      {
        scriptId: 's-1',
        rootDir: 'src',
      },
    );
    const manifestText = readFileSync(
      join(root, 'src/appsscript.json'),
      'utf8',
    );
    expect(manifestText.endsWith('}\n')).toBe(true);
    expect(JSON.parse(manifestText)).toEqual({
      timeZone: 'Europe/Paris',
      runtimeVersion: 'V8',
    });
    expect(readEnv(join(root, '.env'))).toEqual({ GAS_SCRIPT_ID: 's-1' });
  });

  it('does not merge an older .clasp.json', async () => {
    const root = createProject({
      files: { '.clasp.json': '{"scriptId":"old","extra":true}' },
    });
    const ctx = context(root);
    ctx.state.scriptId = 's-2';
    prompts.inject(['Etc/UTC']);
    await configure(ctx);
    expect(JSON.parse(readFileSync(join(root, '.clasp.json'), 'utf8'))).toEqual(
      {
        scriptId: 's-2',
      },
    );
  });

  it('leaves .clasp.json unchanged when the time-zone prompt is cancelled', async () => {
    const original = '{"scriptId":"old"}';
    const root = createProject({ files: { '.clasp.json': original } });
    const ctx = context(root);
    ctx.state.scriptId = 's-3';
    ctx.io.prompt = async () => {
      throw new CancelledError();
    };
    await expect(configure(ctx)).rejects.toThrow(CancelledError);
    expect(readFileSync(join(root, '.clasp.json'), 'utf8')).toBe(original);
  });

  it('defaults the time zone to the template, then the manifest, then Intl', async () => {
    /** @param {string} root */
    const initial = async (root) => {
      const ctx = context(root);
      ctx.state.scriptId = 's';
      let seen;
      ctx.io.prompt = async (/** @type {any} */ q) => {
        seen = q.initial;
        return { timeZone: q.initial };
      };
      await configure(ctx);
      return seen;
    };
    expect(
      await initial(createProject({ manifest: { timeZone: 'Asia/Tokyo' } })),
    ).toBe('Asia/Tokyo');
    expect(
      await initial(
        createProject({
          manifest: {},
          files: { 'appsscript.json': '{"timeZone":"Asia/Seoul"}' },
        }),
      ),
    ).toBe('Asia/Seoul');
    expect(await initial(createProject({ manifest: {} }))).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it.each(['{not json', '[1]', 'null'])(
    'rejects an invalid existing manifest (%s)',
    async (content) => {
      const root = createProject({
        files: { 'appsscript.json': content },
      });
      const ctx = context(root);
      ctx.state.scriptId = 's';
      await expect(configure(ctx)).rejects.toThrow(/appsscript\.json/);
    },
  );

  it('keeps existing manifest fields not in the template', async () => {
    const root = createProject({
      manifest: { runtimeVersion: 'V8' },
      files: { 'appsscript.json': '{"oauthScopes":["a"]}' },
    });
    const ctx = context(root);
    ctx.state.scriptId = 's';
    prompts.inject(['Etc/UTC']);
    await configure(ctx);
    expect(
      JSON.parse(readFileSync(join(root, 'appsscript.json'), 'utf8')),
    ).toEqual({
      oauthScopes: ['a'],
      runtimeVersion: 'V8',
      timeZone: 'Etc/UTC',
    });
  });
});

describe('push', () => {
  it('runs clasp push', async () => {
    await push(context(createProject()));
    expect(calls()).toContain('push --force');
  });
});

describe('deployment', () => {
  const DEPLOYMENTS = JSON.stringify([
    { deploymentId: 'HEAD-id', description: '@HEAD' },
    { deploymentId: 'dep-v1', versionNumber: 1 },
    { deploymentId: 'dep-v3', versionNumber: 3 },
    { deploymentId: 'dep-v2', versionNumber: 2 },
  ]);

  /** @param {string} root */
  function ready(root, env = {}) {
    const ctx = context(root, { FAKE_CLASP_DEPLOYMENTS: DEPLOYMENTS, ...env });
    ctx.state.scriptId = 's-1';
    return ctx;
  }

  it('picks the highest version and ignores HEAD', async () => {
    const root = createProject();
    const ctx = ready(root);
    prompts.inject(['', true]);
    await deployment(ctx);
    expect(ctx.state.deployment).toEqual({
      scriptId: 's-1',
      webappUrl: 'https://script.google.com/macros/s/dep-v3/exec',
      deploymentId: 'dep-v3',
      version: '3',
    });
    expect(readEnv(join(root, '.env'))).toEqual({
      GAS_WEBAPP_URL: 'https://script.google.com/macros/s/dep-v3/exec',
      GAS_DEPLOYMENT_ID: 'dep-v3',
      GAS_VERSION: '3',
    });
    expect(calls()).toContain('open-script');
  });

  it('lets the user choose another deployment when the URL is declined', async () => {
    const ctx = ready(createProject());
    prompts.inject(['', false, 'dep-v1']);
    await deployment(ctx);
    expect(ctx.state.deployment.deploymentId).toBe('dep-v1');
    expect(ctx.state.deployment.version).toBe('1');
  });

  it('aborts when the chosen deployment is not in the list', async () => {
    const ctx = ready(createProject());
    prompts.inject(['', false, 'unknown']);
    await expect(deployment(ctx)).rejects.toThrow('No deployment selected.');
  });

  it('aborts when declined with nothing else to choose', async () => {
    const ctx = ready(createProject(), {
      FAKE_CLASP_DEPLOYMENTS: '[{"deploymentId":"only","versionNumber":1}]',
    });
    prompts.inject(['', false]);
    await expect(deployment(ctx)).rejects.toThrow(DeployError);
  });

  it('retries when there are no deployments, then aborts', async () => {
    const ctx = ready(createProject(), {
      FAKE_CLASP_DEPLOYMENTS: '[{"deploymentId":"HEAD-id"}]',
    });
    prompts.inject(['', true, false]);
    await expect(deployment(ctx)).rejects.toThrow(/No web app deployment/);
    expect(
      calls().filter((c) => c === '--json list-deployments s-1'),
    ).toHaveLength(2);
  });
});
