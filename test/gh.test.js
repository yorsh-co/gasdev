// @ts-check
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GhError, gh, ghApi, listRulesets, readRuleset } from '../src/gh.js';
import { cleanup, fakeGh } from './release/helpers/project.js';

const KEYS = ['PATH', 'FAKE_GH_LOG', 'FAKE_GH_RULES'];

/** @type {Record<string, string | undefined>} */
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  delete process.env.FAKE_GH_RULES;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  cleanup();
});

/**
 * @param {Parameters<typeof fakeGh>[0]} [behavior]
 * @returns {ReturnType<typeof fakeGh>}
 */
function setup(behavior) {
  const fake = fakeGh(behavior);
  Object.assign(process.env, fake.env);
  return fake;
}

/**
 * @param {() => unknown} run
 * @returns {GhError}
 */
function failure(run) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GhError);
    return /** @type {GhError} */ (error);
  }
  throw new Error('expected a GhError');
}

describe('gh', () => {
  it('flags a missing gh', () => {
    process.env.PATH = '';
    const error = failure(() => gh(['--version']));
    expect(error.missing).toBe(true);
    expect(error.message).toMatch(/^cannot run gh: /);
  });

  it('returns the result of a non-zero exit without throwing', () => {
    setup();
    expect(gh(['bogus']).status).toBe(1);
  });
});

describe('ghApi', () => {
  it('flags a missing gh', () => {
    process.env.PATH = '';
    expect(failure(() => ghApi('repos/a/b/rulesets')).missing).toBe(true);
  });

  it('parses the JSON response', () => {
    setup();
    expect(ghApi('repos/a/b/rulesets/1')).toMatchObject({ name: 'tags' });
  });

  it('reports a non-zero exit with the output', () => {
    setup({ rules: 'error' });
    const error = failure(() => ghApi('repos/a/b/rulesets'));
    expect(error.missing).toBe(false);
    expect(error.message).toBe(
      'gh api repos/a/b/rulesets failed (exit 1):\nHTTP 401: Bad credentials',
    );
  });

  it('reports output that is not JSON', () => {
    setup({ rules: 'garbage' });
    expect(failure(() => ghApi('repos/a/b/rulesets')).message).toBe(
      'gh api repos/a/b/rulesets returned unexpected output: not json',
    );
  });
});

describe('listRulesets', () => {
  /** @param {ReturnType<typeof fakeGh>} fake */
  const paths = (fake) => fake.calls().map((call) => call.args[1]);

  it('includes organization rulesets by default', () => {
    const fake = setup();
    expect(listRulesets('a/b')).toHaveLength(1);
    expect(paths(fake)).toEqual(['repos/a/b/rulesets?per_page=100']);
  });

  it('returns an empty list when the response is not an array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh-object-'));
    const bin = join(dir, 'gh');
    writeFileSync(bin, '#!/bin/sh\necho \'{"message":"nope"}\'\n', {
      mode: 0o755,
    });
    process.env.PATH = `${dir}:${process.env.PATH}`;
    try {
      expect(listRulesets('a/b')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can leave organization rulesets out', () => {
    const fake = setup();
    listRulesets('a/b', { includeParents: false });
    expect(paths(fake)).toEqual([
      'repos/a/b/rulesets?per_page=100&includes_parents=false',
    ]);
  });
});

describe('readRuleset', () => {
  it('reads a ruleset by id', () => {
    const fake = setup();
    expect(readRuleset('a/b', 1)).toMatchObject({ name: 'tags' });
    expect(fake.calls().map((call) => call.args[1])).toEqual([
      'repos/a/b/rulesets/1',
    ]);
  });
});
