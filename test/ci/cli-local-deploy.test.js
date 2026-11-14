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
    createClasp: /** @type {typeof createClasp} */ (
      (options) =>
        createClasp({
          ...options,
          bin: fakeClaspBin,
          env: { ...options.env, FAKE_CLASP_LOG: fake.logPath },
        })
    ),
  };
  return { context, home, cwd, err, logPath: fake.logPath };
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
    expect(code).toBe(0);
    const calls = readCalls(logPath).map((call) => call.args.slice(-2));
    expect(calls).toEqual([['push', '--force']]);
    expect(
      JSON.parse(readFileSync(join(cwd, '.clasp.json'), 'utf8')).scriptId,
    ).toBe('script-1');
  });
});
