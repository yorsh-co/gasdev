// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/github-release.js';
import { cleanup, createProject, fakeGh } from '../release/helpers/project.js';

const KEYS = ['PATH', 'FAKE_GH_LOG', 'FAKE_GH_VIEW', 'FAKE_GH_CREATE'];
const CHANGELOG =
  '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- first\n\n---\n';

/** @type {Record<string, string | undefined>} */
let saved;
/** @type {ReturnType<typeof vi.spyOn>} */
let out;
/** @type {ReturnType<typeof vi.spyOn>} */
let err;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  out = vi.spyOn(console, 'log').mockImplementation(() => {});
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
  cleanup();
});

/**
 * Runs the script for a tag in a fresh project with a fake gh.
 *
 * @param {string} tag
 * @param {object} [options]
 * @param {Parameters<typeof fakeGh>[0]} [options.gh]
 * @param {Record<string, string>} [options.files]
 * @param {Record<string, string | undefined>} [options.env]
 */
function run(
  tag,
  { gh = {}, files = { 'CHANGELOG.md': CHANGELOG }, env } = {},
) {
  const fake = fakeGh(gh);
  Object.assign(process.env, fake.env);
  const { root } = createProject({ files });
  const code = main([tag], {
    cwd: root,
    env: { GITHUB_REPOSITORY: 'owner/repo', ...env },
  });
  return { code, calls: fake.calls() };
}

describe('github-release script', () => {
  it('creates the Release with the CHANGELOG section as notes', () => {
    const { code, calls } = run('v1.0.0');
    expect(code).toBe(0);
    const create = calls.find((call) => call.args[1] === 'create');
    expect(create?.args.join(' ')).toContain(
      'release create v1.0.0 -R owner/repo --verify-tag',
    );
    expect(create?.stdin).toBe('### Added\n\n- first');
    expect(out).toHaveBeenCalledWith('✓ Created GitHub Release v1.0.0');
  });

  it('is a no-op when the Release is already published', () => {
    const { code, calls } = run('v1.0.0', { gh: { view: 'published' } });
    expect(code).toBe(0);
    expect(calls.some((call) => call.args[1] === 'create')).toBe(false);
  });

  it('fails without touching an existing draft', () => {
    const { code, calls } = run('v1.0.0', { gh: { view: 'draft' } });
    expect(code).toBe(1);
    expect(calls.some((call) => call.args[1] === 'create')).toBe(false);
    expect(err).toHaveBeenCalledWith(
      '✗ A draft GitHub Release for v1.0.0 exists; publish or delete it by hand',
    );
  });

  it('rejects a prerelease tag without calling gh', () => {
    const { code, calls } = run('v1.0.0-beta.1');
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith(
      '✗ v1.0.0-beta.1 is not a stable vX.Y.Z tag',
    );
  });

  it('rejects a tag that differs from package.json version', () => {
    const { code, calls } = run('v1.0.1');
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith(
      '✗ v1.0.1 does not match package.json version 1.0.0',
    );
  });

  it('fails when CHANGELOG has no section for the version', () => {
    const { code, calls } = run('v1.0.0', {
      files: { 'CHANGELOG.md': '# Changelog\n' },
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith('✗ CHANGELOG.md has no section for 1.0.0');
  });

  it('fails when GITHUB_REPOSITORY is not set', () => {
    const { code, calls } = run('v1.0.0', {
      env: { GITHUB_REPOSITORY: undefined },
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith('✗ GITHUB_REPOSITORY is not set');
  });

  it('prints usage when no tag is given', () => {
    const { code, calls } = run('');
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toHaveBeenCalledWith(
      '✗ Usage: node scripts/github-release.js <tag>',
    );
  });

  it("fails with gh's stderr when create fails", () => {
    const { code } = run('v1.0.0', { gh: { create: 'fail' } });
    expect(code).toBe(1);
    expect(err).toHaveBeenCalledWith('✗ HTTP 422: Validation Failed');
  });
});
