// @ts-check
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeployError as PublicDeployError } from 'gasdev/ci';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { createClasp } from '../../src/ci/clasp.js';
import { CancelledError, DeployError } from '../../src/ci/errors.js';
import { fakeClaspBin, readCalls } from './helpers/fake-clasp.js';
import { createFakeLog } from './setup/helpers/project.js';

vi.mock('../../src/ci/deploy.js', () => ({ deploy: vi.fn() }));
vi.mock('../../src/ci/setup/setup.js', async (importOriginal) => {
  const actual = /** @type {typeof import('../../src/ci/setup/setup.js')} */ (
    await importOriginal()
  );
  return { setup: vi.fn(actual.setup) };
});

const { main } = await import('../../src/ci/cli.js');
const { deploy } = await import('../../src/ci/deploy.js');
const { setup: runSetup } = await import('../../src/ci/setup/setup.js');

/** @type {string[]} */
const sandboxes = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true });
});

function setup() {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const context = {
    stdout: { write: (/** @type {string} */ text) => out.push(text) },
    stderr: { write: (/** @type {string} */ text) => err.push(text) },
    env: {},
    cwd: '/tmp/project',
  };
  return { context, out, err };
}

describe('main', () => {
  it.each(['--help', '-h'])('prints usage for %s', async (flag) => {
    const { context, out } = setup();
    expect(await main([flag], context)).toBe(0);
    expect(out.join('')).toContain('Usage: gasdev');
  });

  it.each([
    ['deploy', '--help'],
    ['deploy', '-h'],
    ['setup', '--help'],
    ['setup', '-h'],
  ])('prints usage for %s %s', async (...argv) => {
    const { context, out } = setup();
    expect(await main(argv, context)).toBe(0);
    expect(out.join('')).toContain('Usage: gasdev setup | deploy');
  });

  it('prints the version', async () => {
    const { context, out } = setup();
    expect(await main(['--version'], context)).toBe(0);
    expect(out.join('')).toBe(`${pkg.version}\n`);
  });

  it.each([[[]], [['bogus']], [['deploy', 'extra']], [['setup', 'extra']]])(
    'returns 2 for invalid usage %j',
    async (argv) => {
      const { context, err } = setup();
      expect(await main(argv, context)).toBe(2);
      expect(err.join('')).toContain('Usage: gasdev');
    },
  );

  it('returns 0 when deploy succeeds', async () => {
    const { context } = setup();
    vi.mocked(deploy).mockResolvedValueOnce();
    expect(await main(['deploy'], context)).toBe(0);
    expect(deploy).toHaveBeenCalledWith(context);
  });

  it('returns 1 and prints the prefixed message for a DeployError', async () => {
    const { context, err } = setup();
    vi.mocked(deploy).mockRejectedValueOnce(new DeployError('boom'));
    expect(await main(['deploy'], context)).toBe(1);
    expect(err.join('')).toBe('gasdev: boom\n');
  });

  it('lists both commands in --help', async () => {
    const { context, out } = setup();
    await main(['--help'], context);
    expect(out.join('')).toMatch(/^ {2}setup {7}Guided first-time setup/m);
    expect(out.join('')).toMatch(/^ {2}deploy {6}Push the project/m);
  });

  it('exports DeployError from the package entry point', () => {
    expect(PublicDeployError).toBe(DeployError);
  });
});

describe('main setup', () => {
  it('routes to the wizard in the project directory', async () => {
    const { context } = setup();
    vi.mocked(runSetup).mockResolvedValueOnce();
    expect(await main(['setup'], context)).toBe(0);
    expect(runSetup).toHaveBeenLastCalledWith(
      '/tmp/project',
      expect.objectContaining({ prompt: expect.any(Function) }),
      undefined,
    );
    expect(deploy).not.toHaveBeenCalled();
  });

  it('returns 130 and prints Cancelled. when a prompt is cancelled', async () => {
    const { context, err } = setup();
    vi.mocked(runSetup).mockRejectedValueOnce(new CancelledError());
    expect(await main(['setup'], context)).toBe(130);
    expect(err.join('')).toBe('Cancelled.\n');
  });

  it('returns 1 and prints the prefixed message for a DeployError', async () => {
    const { context, err } = setup();
    vi.mocked(runSetup).mockRejectedValueOnce(new DeployError('boom'));
    expect(await main(['setup'], context)).toBe(1);
    expect(err.join('')).toBe('gasdev: boom\n');
  });

  it('returns 1 without running clasp when .env is not git-ignored', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gasdev-cli-'));
    sandboxes.push(cwd);
    execFileSync('git', ['init', '-q'], { cwd });
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'app', gasdev: { ci: { title: 'App' } } }),
    );
    writeFileSync(join(cwd, '.clasp.example.json'), '{"scriptId":""}');
    writeFileSync(join(cwd, 'appsscript.example.json'), '{}');
    const fake = createFakeLog();
    try {
      const { context, err } = setup();
      const code = await main(['setup'], {
        ...context,
        cwd,
        createClasp: (options) =>
          createClasp({
            ...options,
            bin: fakeClaspBin,
            env: { ...options.env, FAKE_CLASP_LOG: fake.logPath },
          }),
      });
      expect(code).toBe(1);
      expect(err.join('')).toMatch(/^gasdev: \.env is not ignored/);
      expect(readCalls(fake.logPath)).toEqual([]);
    } finally {
      fake.cleanup();
    }
  });

  it('returns 1 instead of throwing when stdout and stderr are plain writers', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gasdev-cli-'));
    sandboxes.push(cwd);
    execFileSync('git', ['init', '-q'], { cwd });
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n.env\n');
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'app', gasdev: { ci: { title: 'App' } } }),
    );
    writeFileSync(join(cwd, '.clasp.example.json'), '{"scriptId":""}');
    writeFileSync(join(cwd, 'appsscript.example.json'), '{}');
    const fake = createFakeLog();
    try {
      const { context, err } = setup();
      const code = await main(['setup'], {
        ...context,
        cwd,
        createClasp: (options) =>
          createClasp({
            ...options,
            bin: fakeClaspBin,
            env: { ...options.env, FAKE_CLASP_LOG: fake.logPath },
          }),
      });
      expect(code).toBe(1);
      expect(err.join('')).toMatch(/^gasdev: /);
    } finally {
      fake.cleanup();
    }
  });
});
