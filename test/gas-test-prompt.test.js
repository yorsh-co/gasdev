import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GasTestError, runRun } from '../bin/gas-test.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Fake clasp: logs argv and the cloned script ID, then succeeds. */
const FAKE_CLASP = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'clone') {
  fs.writeFileSync('.clasp.json', JSON.stringify({ scriptId: args[1] }));
}
fs.appendFileSync(process.env.FAKE_CLASP_LOG, JSON.stringify({ args }) + '\\n');
if (args[0] === 'run') {
  const payload = Buffer.from(JSON.stringify({ results: [], elapsedMs: 0 }));
  process.stdout.write('@@GAS_TEST@@' + payload.toString('base64') + '@@END@@');
}
`;

/** @type {string[]} */
const dirs = [];
let log = '';

beforeEach(() => {
  vi.stubEnv('GAS_TEST_SCRIPT_ID', undefined);
  vi.stubEnv('GAS_TEST_SPREADSHEET_ID', undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-prompt-'));
  dirs.push(dir);
  log = join(dir, 'clasp.log');
  writeFileSync(log, '');
  vi.stubEnv('FAKE_CLASP_LOG', log);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {string | undefined} scriptId Configured `gasTest.scriptId`.
 * @returns {string} A project with a library file, a test and a fake clasp.
 */
function createProject(scriptId) {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-prompt-proj-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'gas-test'));
  writeFileSync(join(dir, 'src', 'lib.ts'), 'const LIB: number = 1;\n');
  writeFileSync(
    join(dir, 'gas-test', 'lib.test.ts'),
    "test('lib', () => assert(LIB === 1));\n",
  );
  const clasp = join(dir, 'node_modules', '@google', 'clasp');
  mkdirSync(clasp, { recursive: true });
  writeFileSync(
    join(clasp, 'package.json'),
    JSON.stringify({
      name: '@google/clasp',
      version: '0.0.0',
      main: 'index.js',
      bin: { clasp: 'index.js' },
    }),
  );
  writeFileSync(join(clasp, 'index.js'), FAKE_CLASP);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'consumer',
      gasdev: {
        loadOrder: ['lib.ts'],
        gasTest: { scopes: SCOPES, ...(scriptId ? { scriptId } : {}) },
      },
    }),
  );
  return dir;
}

/** @returns {{ args: string[] }[]} */
function entries() {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * @param {Record<string, unknown>[]} answers One answer per prompt call.
 * @returns {{ prompt: (question: import('prompts').PromptObject) => Promise<Record<string, any>> } & { calls: object[] }}
 */
function fakePrompt(answers) {
  /** @type {object[]} */
  const calls = [];
  const queue = [...answers];
  return {
    calls,
    prompt: async (question) => {
      calls.push(question);
      return queue.shift() ?? {};
    },
  };
}

describe('gas-test run prompts', () => {
  it('passes the prompted script ID to clasp', async () => {
    const { prompt } = fakePrompt([
      { scriptId: 'prompted-id' },
      { spreadsheetId: '' },
    ]);
    const status = await runRun(createProject(undefined), { prompt });
    expect(status).toBe(0);
    const clone = entries().find((e) => e.args[0] === 'clone');
    expect(clone?.args[1]).toBe('prompted-id');
  });

  it('passes the prompted spreadsheet ID to --params', async () => {
    const { prompt } = fakePrompt([{ spreadsheetId: 'sheet-1' }]);
    await runRun(createProject('config-script'), { prompt });
    const run = entries().find((e) => e.args[0] === 'run');
    expect(run?.args).toEqual([
      'run',
      'runGasTests',
      '--params',
      '["sheet-1"]',
    ]);
  });

  it('omits --params for an empty spreadsheet answer', async () => {
    const { prompt } = fakePrompt([{ spreadsheetId: '' }]);
    await runRun(createProject('config-script'), { prompt });
    const run = entries().find((e) => e.args[0] === 'run');
    expect(run?.args).toEqual(['run', 'runGasTests']);
  });

  it('does not prompt for variables that are set', async () => {
    vi.stubEnv('GAS_TEST_SCRIPT_ID', 'env-script');
    vi.stubEnv('GAS_TEST_SPREADSHEET_ID', '');
    const { prompt, calls } = fakePrompt([]);
    await runRun(createProject(undefined), { prompt });
    expect(calls).toEqual([]);
  });

  it('throws on a cancelled script ID without invoking clasp', async () => {
    const { prompt } = fakePrompt([{}]);
    await expect(
      runRun(createProject(undefined), { prompt }),
    ).rejects.toBeInstanceOf(GasTestError);
    expect(entries()).toEqual([]);
  });

  it('throws on a cancelled spreadsheet ID without invoking clasp', async () => {
    const { prompt } = fakePrompt([{}]);
    await expect(
      runRun(createProject('config-script'), { prompt }),
    ).rejects.toThrow('cancelled');
    expect(entries()).toEqual([]);
  });

  it('keeps the existing error without a prompt', async () => {
    await expect(runRun(createProject(undefined), {})).rejects.toThrow(
      'no script ID: set GAS_TEST_SCRIPT_ID or "gasdev.gasTest.scriptId"',
    );
  });

  it('does not prompt on GitHub Actions and keeps the no-script-ID error', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    const { prompt, calls } = fakePrompt([{ scriptId: 'prompted-id' }]);
    await expect(runRun(createProject(undefined), { prompt })).rejects.toThrow(
      'no script ID: set GAS_TEST_SCRIPT_ID or "gasdev.gasTest.scriptId"',
    );
    expect(calls).toEqual([]);
    expect(entries()).toEqual([]);
  });

  it('validates the spreadsheet ID answer', async () => {
    const { prompt, calls } = fakePrompt([{ spreadsheetId: '' }]);
    await runRun(createProject('config-script'), { prompt });
    const { validate } = /** @type {{ validate: (v: string) => unknown }} */ (
      calls[0]
    );
    expect(validate('bad id!')).toBe(
      'Enter a valid spreadsheet ID or leave empty',
    );
    expect(validate('')).toBe(true);
    expect(validate('1aB-_c')).toBe(true);
  });
});
