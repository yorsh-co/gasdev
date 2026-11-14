// @ts-check
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClasp } from '../../src/ci/clasp.js';
import { main } from '../../src/ci/cli.js';
import { fakeClaspBin, readCalls } from './helpers/fake-clasp.js';
import { createFakeLog } from './setup/helpers/project.js';

/** @type {string[]} */
const sandboxes = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true });
});

/** Builds a temp home and a built project, with a fake clasp wired in. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'gasdev-local-deploy-'));
  sandboxes.push(root);
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(home);
  mkdirSync(join(cwd, 'dist'), { recursive: true });
  writeFileSync(join(cwd, '.clasp.example.json'), '{"rootDir":"dist"}');
  writeFileSync(join(cwd, 'dist', 'appsscript.json'), '{"oauthScopes":[]}');
  const fake = createFakeLog();
  sandboxes.push(fake.logPath.replace(/\/calls\.jsonl$/, ''));
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const context = {
    stdout: { write: (/** @type {string} */ text) => out.push(text) },
    stderr: { write: (/** @type {string} */ text) => err.push(text) },
    env: /** @type {NodeJS.ProcessEnv} */ ({}),
    cwd,
    home,
    readHead: () => undefined,
    createClasp: /** @type {typeof createClasp} */ (
      (options) =>
        createClasp({
          ...options,
          bin: fakeClaspBin,
          env: {
            ...options.env,
            FAKE_CLASP_LOG: fake.logPath,
            FAKE_CLASP_DEPLOYMENTS: JSON.stringify([
              { deploymentId: 'dep-1', versionNumber: 1 },
            ]),
            FAKE_CLASP_MANIFEST: JSON.stringify({ oauthScopes: [] }),
          },
        })
    ),
  };
  return { context, home, cwd, out, err, logPath: fake.logPath };
}

describe('main deploy without the mocked deploy', () => {
  it('keeps the CLASPRC_JSON error unchanged without a prompt', async () => {
    const { context, err, logPath } = sandbox();
    expect(await main(['deploy'], context)).toBe(1);
    expect(err.join('')).toBe(
      'gasdev: CLASPRC_JSON is not set. Add it as a secret of the deployment environment.\n',
    );
    expect(readCalls(logPath)).toEqual([]);
  });

  it('fails with a clasp login hint before prompting without credentials', async () => {
    const { context, home, err, logPath } = sandbox();
    const prompt = vi.fn(async () => ({ value: 'x' }));
    expect(await main(['deploy'], { ...context, prompt })).toBe(1);
    expect(err.join('')).toBe(
      `gasdev: CLASPRC_JSON is not set and ${join(home, '.clasprc.json')} was not found. Run \`clasp login\`, then retry.\n`,
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(readCalls(logPath)).toEqual([]);
  });

  it('pushes with the prompted script ID and the stored credentials', async () => {
    const { context, home, cwd, err, logPath } = sandbox();
    writeFileSync(
      join(home, '.clasprc.json'),
      JSON.stringify({ tokens: { default: { refresh_token: 'r' } } }),
    );
    const queue = ['script-1', ''];
    const prompt = vi.fn(async () => ({ value: queue.shift() }));
    const code = await main(['deploy'], { ...context, prompt });
    expect(err.join('')).toBe('');
    expect([code, err.join('')]).toEqual([0, '']);
    const calls = readCalls(logPath).map((call) => call.args.slice(-2));
    expect(calls).toEqual([['push', '--force']]);
    expect(
      JSON.parse(readFileSync(join(cwd, '.clasp.json'), 'utf8')).scriptId,
    ).toBe('script-1');
  });

  it('deploys with the prompted deployment and keeps the token out of the output', async () => {
    const { context, home, out, err, logPath } = sandbox();
    writeFileSync(
      join(home, '.clasprc.json'),
      JSON.stringify({
        tokens: { default: { refresh_token: 'secret-token' } },
      }),
    );
    const queue = ['script-1', 'dep-1', 'v1'];
    const prompt = vi.fn(async () => ({ value: queue.shift() }));
    const code = await main(['deploy'], { ...context, prompt });
    expect([code, err.join('')]).toEqual([0, '']);
    const calls = readCalls(logPath).map((call) => call.args);
    const deploy = calls.find((args) => args.includes('create-deployment'));
    expect(deploy).toBeDefined();
    expect(deploy).toContain('dep-1');
    expect(calls.flat()).toContain('v1');
    expect(out.join('')).not.toContain('secret-token');
    expect(err.join('')).not.toContain('secret-token');
  });
});
