// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReleaseError } from '../../src/release/errors.js';
import { assertProtected } from '../../src/release/rulesets.js';
import { cleanup, fakeGh } from './helpers/project.js';

const KEYS = [
  'PATH',
  'FAKE_GH_LOG',
  'FAKE_GH_RULES',
  'FAKE_GH_VIEW',
  'FAKE_GH_CREATE',
];
const REPO = 'acme/gas-lib';
const BRANCH_OK = ['deletion', 'non_fast_forward'];
const TAG_RULES = ['deletion', 'non_fast_forward', 'update'];

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
 * @param {Parameters<typeof fakeGh>[0]} behavior
 * @returns {ReturnType<typeof fakeGh>}
 */
function setup(behavior) {
  const gh = fakeGh(behavior);
  Object.assign(process.env, gh.env);
  return gh;
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {object}
 */
function tagRuleset(overrides = {}) {
  return {
    id: 7,
    name: 'tags',
    target: 'tag',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: TAG_RULES.map((type) => ({ type })),
    ...overrides,
  };
}

/** @param {...string} names */
const targets = (...names) =>
  /** @type {import('../../src/release/config.js').Target[]} */ (
    /** @type {unknown} */ (names.map((branch) => ({ branch })))
  );

/**
 * @param {import('../../src/release/config.js').Target[]} t
 * @returns {string}
 */
function failure(t) {
  try {
    assertProtected(REPO, t, process.cwd());
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseError);
    return /** @type {Error} */ (error).message;
  }
  throw new Error('expected assertProtected to throw');
}

describe('assertProtected', () => {
  it('passes when branches and tags are protected', () => {
    setup({});
    expect(() =>
      assertProtected(REPO, targets('dist'), process.cwd()),
    ).not.toThrow();
  });

  it('names the branch and the missing rule', () => {
    setup({
      rules: { branches: { dist: ['deletion'] }, rulesets: [tagRuleset()] },
    });
    expect(failure(targets('dist'))).toContain(
      'dist: missing non_fast_forward',
    );
  });

  it('reports a branch without rules', () => {
    setup({ rules: { branches: {}, rulesets: [tagRuleset()] } });
    expect(failure(targets('dist'))).toContain(
      'dist: missing deletion, non_fast_forward',
    );
  });

  it('reports a missing tag ruleset', () => {
    setup({ rules: { branches: { dist: BRANCH_OK }, rulesets: [] } });
    expect(failure(targets('dist'))).toContain('tags: no active tag ruleset');
  });

  it('reports a missing tag ruleset when only a branch ruleset is active', () => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK },
        rulesets: [tagRuleset({ target: 'branch' })],
      },
    });
    expect(failure(targets('dist'))).toContain('tags: no active tag ruleset');
  });

  it('passes when a later active tag ruleset covers all tags', () => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK },
        rulesets: [tagRuleset({ id: 1, rules: [] }), tagRuleset({ id: 2 })],
      },
    });
    expect(() =>
      assertProtected(REPO, targets('dist'), process.cwd()),
    ).not.toThrow();
  });

  it('fails when a listed ruleset has no detail', () => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK },
        rulesets: [tagRuleset({ listOnly: true })],
      },
    });
    expect(failure(targets('dist'))).toContain('HTTP 404');
  });

  it.each(['disabled', 'evaluate'])('ignores a %s tag ruleset', (mode) => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK },
        rulesets: [tagRuleset({ enforcement: mode })],
      },
    });
    expect(failure(targets('dist'))).toContain('tags: no active tag ruleset');
  });

  it.each([
    [
      'a pattern other than ~ALL',
      { conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } } },
    ],
    [
      'no update rule',
      { rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }] },
    ],
    [
      'an exclude list',
      {
        conditions: {
          ref_name: { include: ['~ALL'], exclude: ['refs/tags/x'] },
        },
      },
    ],
  ])('rejects a tag ruleset with %s', (_name, overrides) => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK },
        rulesets: [tagRuleset(overrides)],
      },
    });
    expect(failure(targets('dist'))).toContain(
      'tags: no active ruleset on ~ALL with deletion, non_fast_forward and update',
    );
  });

  it('names only the unprotected target', () => {
    setup({
      rules: {
        branches: { dist: BRANCH_OK, 'dist/web': [] },
        rulesets: [tagRuleset()],
      },
    });
    const message = failure(targets('dist', 'dist/web'));
    expect(message).toContain('dist/web: missing');
    expect(message).not.toContain('dist: missing');
  });

  it('lists branch and tag gaps together with the fix hint', () => {
    setup({ rules: { branches: {}, rulesets: [] } });
    const message = failure(targets('dist'));
    expect(message).toMatch(/dist: missing .*; tags: no active tag ruleset\./);
    expect(message.endsWith('to apply the gas-* rulesets.')).toBe(true);
    expect(message).toContain('npx gasdev github --fix');
  });

  it('fails on a gh error', () => {
    setup({ rules: 'error' });
    expect(failure(targets('dist'))).toContain('HTTP 401: Bad credentials');
  });

  it('fails on non-JSON gh output', () => {
    setup({ rules: 'garbage' });
    expect(failure(targets('dist'))).toContain('returned unexpected output');
  });

  it('explains a missing gh', () => {
    process.env.PATH = '';
    expect(failure(targets('dist'))).toBe(
      'gh is not installed — install GitHub CLI or set githubRelease to false.',
    );
  });

  it('requests a slashed branch without encoding the slash', () => {
    const gh = setup({});
    assertProtected(REPO, targets('dist/web'), process.cwd());
    expect(gh.calls().map((call) => call.args[1])).toContain(
      `repos/${REPO}/rules/branches/dist/web?per_page=100`,
    );
  });
});
