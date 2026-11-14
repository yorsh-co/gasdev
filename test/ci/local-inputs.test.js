// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CancelledError, DeployError } from '../../src/ci/errors.js';
import { completeLocalEnv } from '../../src/ci/local-inputs.js';

const CREDENTIALS = '{"token":{"refresh_token":"x"}}';

/** @type {string} */
let home;
/** @type {string} */
let cwd;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'gasdev-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'gasdev-cwd-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

/**
 * Builds a fake prompt that records questions and answers in order.
 *
 * @param {unknown[]} answers `undefined` simulates a cancel.
 */
function fakePrompt(answers) {
  /** @type {Record<string, any>[]} */
  const questions = [];
  const queue = [...answers];
  const prompt = async (/** @type {Record<string, any>} */ question) => {
    questions.push(question);
    return { value: queue.shift() };
  };
  return { prompt, questions };
}

describe('completeLocalEnv', () => {
  it('reads credentials from home when unset', async () => {
    writeFileSync(join(home, '.clasprc.json'), CREDENTIALS);
    const { prompt } = fakePrompt(['script-1', '']);
    const env = await completeLocalEnv({}, { prompt, home, cwd });
    expect(env.CLASPRC_JSON).toBe(CREDENTIALS);
  });

  it('keeps an existing CLASPRC_JSON without reading the file', async () => {
    mkdirSync(join(home, '.clasprc.json'));
    const { prompt } = fakePrompt([]);
    const env = await completeLocalEnv(
      {
        CLASPRC_JSON: 'preset',
        GAS_SCRIPT_ID: 's',
        GAS_DEPLOYMENT_ID: '',
      },
      { prompt, home, cwd },
    );
    expect(env.CLASPRC_JSON).toBe('preset');
  });

  it('leaves CLASPRC_JSON unset without a file', async () => {
    const { prompt } = fakePrompt(['script-1', '']);
    const env = await completeLocalEnv({}, { prompt, home, cwd });
    expect(env.CLASPRC_JSON).toBeUndefined();
  });

  it('prompts only for missing variables', async () => {
    const none = fakePrompt([]);
    await completeLocalEnv(
      { GAS_SCRIPT_ID: 's', GAS_DEPLOYMENT_ID: 'd', GITHUB_SHA: 'sha' },
      { prompt: none.prompt, home, cwd },
    );
    expect(none.questions).toHaveLength(0);

    const some = fakePrompt(['d-1']);
    const env = await completeLocalEnv(
      { GAS_SCRIPT_ID: 's', GITHUB_SHA: 'sha' },
      { prompt: some.prompt, home, cwd },
    );
    expect(some.questions).toHaveLength(1);
    expect(env.GAS_DEPLOYMENT_ID).toBe('d-1');
  });

  it('uses .env values as initial', async () => {
    writeFileSync(
      join(cwd, '.env'),
      'GAS_SCRIPT_ID=env-script\nGAS_DEPLOYMENT_ID=env-dep\n',
    );
    const { prompt, questions } = fakePrompt(['env-script', '']);
    await completeLocalEnv({}, { prompt, home, cwd });
    expect(questions[0]?.initial).toBe('env-script');
    expect(questions[1]?.initial).toBe('env-dep');
  });

  it('leaves deployment and sha unset on an empty deployment answer', async () => {
    const { prompt, questions } = fakePrompt(['script-1', '']);
    const env = await completeLocalEnv({}, { prompt, home, cwd });
    expect(questions).toHaveLength(2);
    expect(env.GAS_DEPLOYMENT_ID).toBeUndefined();
    expect(env.GITHUB_SHA).toBeUndefined();
  });

  it('prompts the version description with HEAD as initial', async () => {
    const { prompt, questions } = fakePrompt(['script-1', 'dep-1', 'abc123']);
    const env = await completeLocalEnv(
      {},
      { prompt, home, cwd, readHead: () => 'abc123' },
    );
    expect(questions[2]?.initial).toBe('abc123');
    expect(env.GITHUB_SHA).toBe('abc123');
    expect(env.GAS_DEPLOYMENT_ID).toBe('dep-1');
  });

  it('prompts the version description when GITHUB_SHA is empty', async () => {
    const { prompt, questions } = fakePrompt(['abc123']);
    const env = await completeLocalEnv(
      { GAS_SCRIPT_ID: 's', GAS_DEPLOYMENT_ID: 'd', GITHUB_SHA: '' },
      { prompt, home, cwd, readHead: () => 'head' },
    );
    expect(questions).toHaveLength(1);
    expect(env.GITHUB_SHA).toBe('abc123');
  });

  it('uses an empty initial version description without HEAD', async () => {
    const { prompt, questions } = fakePrompt(['script-1', 'dep-1', 'desc']);
    await completeLocalEnv(
      {},
      { prompt, home, cwd, readHead: () => undefined },
    );
    expect(questions[2]?.initial).toBe('');
  });

  it('resolves with the default readHead outside a git repository', async () => {
    const { prompt } = fakePrompt(['script-1', 'dep-1', 'desc']);
    const env = await completeLocalEnv({}, { prompt, home, cwd });
    expect(env.GITHUB_SHA).toBe('desc');
  });

  it('throws CancelledError on cancel of the deployment prompt', async () => {
    const { prompt } = fakePrompt(['s', undefined]);
    await expect(
      completeLocalEnv({}, { prompt, home, cwd }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('throws CancelledError on cancel of the version prompt', async () => {
    const { prompt } = fakePrompt(['s', 'd', undefined]);
    await expect(
      completeLocalEnv({}, { prompt, home, cwd, readHead: () => 'h' }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('validates IDs', async () => {
    const { prompt, questions } = fakePrompt(['script-1', '']);
    await completeLocalEnv({}, { prompt, home, cwd });
    expect(questions[0]?.validate?.('bad id')).not.toBe(true);
    expect(questions[0]?.validate?.('')).not.toBe(true);
    expect(questions[0]?.validate?.('ok_id-1')).toBe(true);
    expect(questions[1]?.validate?.('')).toBe(true);
    expect(questions[1]?.validate?.('bad id')).not.toBe(true);
  });

  it('validates IDs with surrounding whitespace', async () => {
    const { prompt, questions } = fakePrompt(['script-1', '']);
    await completeLocalEnv({}, { prompt, home, cwd });
    expect(questions[0]?.validate?.('ok_id-1 ')).toBe(true);
    expect(questions[1]?.validate?.(' ok_id-1\n')).toBe(true);
  });

  it('wraps a .env read failure in DeployError', async () => {
    mkdirSync(join(cwd, '.env'));
    const { prompt } = fakePrompt(['script-1', '']);
    await expect(
      completeLocalEnv({}, { prompt, home, cwd }),
    ).rejects.toBeInstanceOf(DeployError);
  });

  it('does not read .env when nothing needs a prompt', async () => {
    mkdirSync(join(cwd, '.env'));
    const { prompt } = fakePrompt([]);
    await expect(
      completeLocalEnv(
        { GAS_SCRIPT_ID: 's', GAS_DEPLOYMENT_ID: '' },
        { prompt, home, cwd },
      ),
    ).resolves.toBeDefined();
  });

  it('throws CancelledError on cancel', async () => {
    const { prompt } = fakePrompt([undefined]);
    await expect(
      completeLocalEnv({}, { prompt, home, cwd }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('does not mutate the input env', async () => {
    writeFileSync(join(home, '.clasprc.json'), CREDENTIALS);
    /** @type {NodeJS.ProcessEnv} */
    const input = {};
    const { prompt } = fakePrompt(['script-1', '']);
    const env = await completeLocalEnv(input, { prompt, home, cwd });
    expect(env).not.toBe(input);
    expect(input).toEqual({});
  });
});
