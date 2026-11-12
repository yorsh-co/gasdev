// @ts-check
import { describe, expect, it } from 'vitest';
import { DeployError } from '../../src/ci/errors.js';
import { readInputs } from '../../src/ci/inputs.js';

const SECRET = 'super-secret-refresh-token';
const base = {
  CLASPRC_JSON: JSON.stringify({ token: { refresh_token: SECRET } }),
  GAS_SCRIPT_ID: 'script-1',
};

/** @param {NodeJS.ProcessEnv} env */
function messageOf(env) {
  try {
    readInputs(env);
  } catch (error) {
    expect(error).toBeInstanceOf(DeployError);
    return /** @type {Error} */ (error).message;
  }
  throw new Error('expected readInputs to throw');
}

describe('readInputs', () => {
  it('reads all inputs', () => {
    expect(
      readInputs({
        ...base,
        GAS_DEPLOYMENT_ID: 'dep-1',
        GITHUB_SHA: 'abc',
        GITHUB_ACTIONS: 'true',
        GITHUB_OUTPUT: '/o',
        GITHUB_STEP_SUMMARY: '/s',
      }),
    ).toEqual({
      clasprc: { token: { refresh_token: SECRET } },
      scriptId: 'script-1',
      deploymentId: 'dep-1',
      sha: 'abc',
      githubActions: true,
      outputPath: '/o',
      summaryPath: '/s',
    });
  });

  it('treats an empty GAS_DEPLOYMENT_ID as unset', () => {
    const inputs = readInputs({ ...base, GAS_DEPLOYMENT_ID: '' });
    expect(inputs.deploymentId).toBeUndefined();
    expect(inputs.githubActions).toBe(false);
  });

  it('treats empty GITHUB_SHA and GITHUB_OUTPUT as unset', () => {
    const inputs = readInputs({ ...base, GITHUB_SHA: '', GITHUB_OUTPUT: '' });
    expect(inputs.sha).toBeUndefined();
    expect(inputs.outputPath).toBeUndefined();
  });

  it('reads RUNNER_TEMP and treats an empty value as unset', () => {
    expect(readInputs({ ...base, RUNNER_TEMP: '/r' }).runnerTemp).toBe('/r');
    expect(readInputs({ ...base, RUNNER_TEMP: '' }).runnerTemp).toBeUndefined();
  });

  it.each(['GAS_SCRIPT_ID', 'GAS_DEPLOYMENT_ID'])(
    'rejects a %s with invalid characters without echoing it',
    (name) => {
      const message = messageOf({ ...base, [name]: 'abc\nurl=evil' });
      expect(message).toContain(name);
      expect(message).not.toContain('evil');
    },
  );

  it.each([
    ['missing CLASPRC_JSON', { GAS_SCRIPT_ID: 'x' }, 'CLASPRC_JSON'],
    [
      'invalid JSON',
      { CLASPRC_JSON: `{"a":"${SECRET}`, GAS_SCRIPT_ID: 'x' },
      'valid JSON',
    ],
    [
      'non-object',
      { CLASPRC_JSON: `["${SECRET}"]`, GAS_SCRIPT_ID: 'x' },
      'JSON object',
    ],
    [
      'empty CLASPRC_JSON',
      { CLASPRC_JSON: '', GAS_SCRIPT_ID: 'x' },
      'CLASPRC_JSON',
    ],
    ['JSON null', { CLASPRC_JSON: 'null', GAS_SCRIPT_ID: 'x' }, 'JSON object'],
    [
      'JSON string primitive',
      { CLASPRC_JSON: `"${SECRET}"`, GAS_SCRIPT_ID: 'x' },
      'JSON object',
    ],
    [
      'empty GAS_SCRIPT_ID',
      { CLASPRC_JSON: base.CLASPRC_JSON, GAS_SCRIPT_ID: '' },
      'GAS_SCRIPT_ID',
    ],
    [
      'missing GAS_SCRIPT_ID',
      { CLASPRC_JSON: base.CLASPRC_JSON },
      'GAS_SCRIPT_ID',
    ],
  ])('rejects %s without leaking values', (_name, env, expected) => {
    const message = messageOf(env);
    expect(message).toContain(expected);
    expect(message).not.toContain(SECRET);
  });
});
