import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const promptsMock = vi.hoisted(() => vi.fn());
vi.mock('prompts', () => ({ default: promptsMock }));

describe('gasdev gas-test run on a CI terminal', () => {
  const ttyDescriptors = {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  };
  const cwd = process.cwd();
  /** @type {string | undefined} */
  let dir;

  afterEach(() => {
    for (const [name, stream] of /** @type {const} */ ([
      ['stdin', process.stdin],
      ['stdout', process.stdout],
    ])) {
      const descriptor = ttyDescriptors[name];
      if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
      else delete (/** @type {any} */ (stream).isTTY);
    }
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('does not prompt and keeps the no-script-ID error', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gasdev-prompt-ci-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'consumer',
        gasdev: {
          loadOrder: ['lib.ts'],
          gasTest: {
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          },
        },
      }),
    );
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GAS_TEST_SCRIPT_ID', undefined);
    vi.stubEnv('GAS_TEST_SPREADSHEET_ID', undefined);
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.chdir(dir);

    const { main } = await import('../bin/gasdev.js');

    const status = await main(['gas-test', 'run']);

    expect(status).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      'gasdev: no script ID: set GAS_TEST_SCRIPT_ID or "gasdev.gasTest.scriptId"\n',
    );
    expect(promptsMock).not.toHaveBeenCalled();
  });
});
