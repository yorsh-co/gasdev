// @ts-check
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSteps, runSteps } from '../../../src/ci/setup/custom-steps.js';
import { createClasp } from '../../../src/ci/clasp.js';
import { setup as runSetup } from '../../../src/ci/setup/setup.js';
import { CancelledError, DeployError } from '../../../src/ci/errors.js';
import { createIo } from '../../../src/ci/setup/io.js';
import { fakeClaspBin, readCalls } from '../helpers/fake-clasp.js';
import { cleanup, createFakeLog, createProject } from './helpers/project.js';

const fixture = (/** @type {string} */ name) =>
  fileURLToPath(new URL(`./fixtures/steps/${name}`, import.meta.url));
const DEPLOYMENTS = JSON.stringify([
  { deploymentId: 'AKfy-2', versionNumber: 2, description: 'two' },
]);

/** @type {{ logPath: string, cleanup: () => void }} */
let fake;

beforeEach(() => {
  fake = createFakeLog();
});

afterEach(() => {
  /** @type {any} */ (prompts)._injected = [];
  fake.cleanup();
  cleanup();
});

const sink = () => /** @type {any} */ (new PassThrough());

describe('loadSteps', () => {
  it('loads a valid module', async () => {
    const steps = await loadSteps(fixture('ok.js'));
    expect(steps.map((s) => s.title)).toEqual(['Record deployment']);
  });

  it('rejects a step without run, naming the index and field', async () => {
    await expect(loadSteps(fixture('malformed.js'))).rejects.toThrow(
      'Step 0: run must be a function.',
    );
  });

  it.each([
    ['missing-title.js', 'Step 0: title must be a non-empty string.'],
    ['blank-title.js', 'Step 0: title must be a non-empty string.'],
    ['null-entry.js', 'Step 0 must be an object.'],
  ])('rejects invalid entry %s', async (file, message) => {
    await expect(loadSteps(fixture(file))).rejects.toThrow(message);
  });

  it('rejects a default export that is not an array', async () => {
    await expect(loadSteps(fixture('not-array.js'))).rejects.toThrow(
      'default-export an array',
    );
  });

  it('wraps a module load failure', async () => {
    await expect(loadSteps(fixture('missing.js'))).rejects.toThrow(DeployError);
  });
});

describe('runSteps', () => {
  const ctx = /** @type {any} */ ({
    log: { section() {} },
  });

  it('wraps a generic error with the step title and cause', async () => {
    const steps = await loadSteps(fixture('throws.js'));
    const error = await runSteps(steps, ctx).catch((e) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect(error.message).toBe('Step "Boom" failed: kaput');
    expect(error.cause.message).toBe('kaput');
  });

  it('passes a DeployError through unchanged', async () => {
    const steps = await loadSteps(fixture('deploy-error.js'));
    const error = await runSteps(steps, ctx).catch((e) => e);
    expect(error.message).toBe('token rejected');
    expect(error.cause).toBeUndefined();
    const [original] = steps;
    const thrown = new DeployError('same');
    const rethrown = await runSteps(
      [{ title: 'T', run: () => Promise.reject(thrown) }],
      ctx,
    ).catch((e) => e);
    expect(rethrown).toBe(thrown);
    expect(original?.title).toBe('Clean failure');
  });

  it('passes through a DeployError from another install unwrapped', async () => {
    const steps = await loadSteps(fixture('foreign-error.js'));
    const error = await runSteps(steps, ctx).catch((e) => e);
    expect(error).not.toBeInstanceOf(DeployError);
    expect(error.message).toBe('from another install');
    expect(error.cause).toBeUndefined();
  });

  it('passes through a cancelled prompt', async () => {
    const steps = await loadSteps(fixture('prompts-cancel.js'));
    prompts.inject([new Error('cancel')]);
    const error = await runSteps(steps, {
      ...ctx,
      prompt: createIo({ stdout: sink(), stderr: sink() }).prompt,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(CancelledError);
  });
});

describe('setup with steps', () => {
  /** @param {string} stepsFile */
  function project(stepsFile) {
    const cwd = createProject({
      git: true,
      gitignore: '.env\n.clasp.json\nappsscript.json\nstep-ran.json\n',
      pkg: { gasdev: { ci: { steps: 'steps.js' } } },
    });
    if (stepsFile === 'syntax-error.js') {
      writeFileSync(join(cwd, 'steps.js'), 'export default [ {\n');
    } else {
      copyFileSync(fixture(stepsFile), join(cwd, 'steps.js'));
    }
    return cwd;
  }

  /** @param {string} cwd */
  async function run(cwd) {
    const out = sink();
    /** @type {Buffer[]} */
    const chunks = [];
    out.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
    prompts.inject(['keep', 'Etc/UTC', '', true]);
    await runSetup(cwd, createIo({ stdout: out, stderr: sink() }), {
      createClasp: (options) =>
        createClasp({
          ...options,
          bin: fakeClaspBin,
          env: {
            ...options.env,
            FAKE_CLASP_LOG: fake.logPath,
            FAKE_CLASP_USER: 'dev@example.com',
            FAKE_CLASP_DEPLOYMENTS: DEPLOYMENTS,
            FAKE_CLASP_SCRIPT_ID: 'script-9',
          },
        }),
    });
    return Buffer.concat(chunks).toString('utf8');
  }

  it('runs steps after the deployment with the deployment in ctx and persists env', async () => {
    const cwd = project('ok.js');
    const stdout = await run(cwd);
    const at = (/** @type {string} */ text) => stdout.indexOf(text);
    expect(at('(version 2)')).toBeGreaterThan(-1);
    expect(at('Record deployment')).toBeGreaterThan(at('(version 2)'));
    expect(at('Record deployment')).toBeLessThan(at('Summary'));
    const seen = JSON.parse(readFileSync(join(cwd, 'step-ran.json'), 'utf8'));
    expect(seen.deployment).toEqual({
      scriptId: 'script-9',
      webappUrl: 'https://script.google.com/macros/s/AKfy-2/exec',
      deploymentId: 'AKfy-2',
      version: '2',
    });
    expect(seen.env.GAS_DEPLOYMENT_ID).toBe('AKfy-2');
    const env = readFileSync(join(cwd, '.env'), 'utf8');
    expect(env).toContain('GAS_DEPLOYMENT_ID=AKfy-2\n');
    expect(env).toContain("CUSTOM_TOKEN='abc 123'\n");
  });

  it('aborts before any clasp call when the module fails to load', async () => {
    const cwd = project('syntax-error.js');
    await expect(run(cwd)).rejects.toThrow('Cannot load steps module');
    expect(readCalls(fake.logPath)).toEqual([]);
  });
});
