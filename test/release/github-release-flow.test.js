// @ts-check
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  createProject,
  fakeGh,
  git,
  runRelease,
  useGitHubRemote,
} from './helpers/project.js';

afterEach(cleanup);

const CHANGELOG = [
  '# Changelog',
  '',
  '## [1.0.0] - 2026-11-03',
  '',
  '- First release.',
  '',
  '---',
  '',
  '## [0.9.0]',
  '',
  '- Older.',
  '',
].join('\n');
const NOTES = '\n- First release.';

/**
 * @param {Record<string, unknown>} [config]
 */
function setup(config = { githubRelease: true }) {
  const project = createProject({
    config,
    files: { 'CHANGELOG.md': CHANGELOG },
  });
  useGitHubRemote(project.root, project.origin);
  return project;
}

/**
 * @param {string} origin
 * @returns {string}
 */
function branches(origin) {
  return git(origin, 'branch', '--list');
}

describe('githubRelease', () => {
  it('does not call gh when the option is off', () => {
    const { root } = setup({});
    const gh = fakeGh();

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(0);
    expect(gh.calls()).toEqual([]);
  });

  it('reports what a dry run would do without creating', () => {
    const { root, origin } = setup();
    const gh = fakeGh({ view: 'absent' });

    const result = runRelease(root, ['--dry-run'], gh.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'GitHub Release v1.0.0: would be created on acme/gas-lib',
    );
    expect(result.stdout).toContain(
      'Dry run — nothing was committed, tagged, pushed or published.',
    );
    expect(
      gh
        .calls()
        .filter(({ args }) => args[0] === 'release')
        .map(({ args }) => args.slice(0, 2)),
    ).toEqual([['release', 'view']]);
    expect(branches(origin)).not.toContain('dist');
  });

  it.each([
    ['published', 'already exists — skipped'],
    ['draft', 'a draft exists — skipped (publish or delete it)'],
  ])('skips an existing %s release', (view, notice) => {
    const { root, origin } = setup();
    const gh = fakeGh({ view: /** @type {'published' | 'draft'} */ (view) });

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`GitHub Release v1.0.0: ${notice}`);
    expect(gh.calls().some(({ args }) => args[1] === 'create')).toBe(false);
    expect(branches(origin)).toContain('dist');
  });

  it('creates the release with the changelog section as notes', () => {
    const { root } = setup();
    const gh = fakeGh();

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(0);
    const create = gh.calls().find(({ args }) => args[1] === 'create');
    expect(create?.args).toEqual([
      'release',
      'create',
      'v1.0.0',
      '-R',
      'acme/gas-lib',
      '--verify-tag',
      '--title',
      'v1.0.0',
      '--notes-file',
      '-',
    ]);
    expect(create?.stdin.trim()).toBe(NOTES.trim());
  });

  it('exits 3 after the push when creation fails, keeping the push', () => {
    const { root, origin } = setup();
    const gh = fakeGh({ create: 'fail' });

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('Push to origin succeeded');
    expect(result.stderr).toContain(
      'gh release create v1.0.0 -R acme/gas-lib --verify-tag --title v1.0.0 --notes-file .worktrees/github-release-v1.0.0.md',
    );
    const notesFile = join(root, '.worktrees/github-release-v1.0.0.md');
    expect(existsSync(notesFile)).toBe(true);
    expect(readFileSync(notesFile, 'utf8').trim()).toBe(NOTES.trim());
    expect(branches(origin)).toContain('dist');
    expect(git(origin, 'tag', '--list')).toContain('dist/v1.0.0');
  });

  it('fails in preflight when gh cannot look up the release', () => {
    const { root, origin } = setup();
    const gh = fakeGh({ view: 'error' });

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HTTP 401');
    expect(gh.calls().some(({ args }) => args[1] === 'create')).toBe(false);
    expect(branches(origin)).not.toContain('dist');
  });

  describe('rulesets', () => {
    const UNPROTECTED = { branches: { dist: ['deletion'] } };

    it('refuses an unprotected target branch before pushing', () => {
      const { root, origin } = setup();
      const gh = fakeGh({ rules: UNPROTECTED });

      const result = runRelease(root, [], gh.env);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('dist: missing non_fast_forward');
      expect(result.stderr).toContain('gasdev github --fix');
      expect(branches(origin)).not.toContain('dist');
      expect(git(origin, 'tag', '--list')).not.toContain('dist/v1.0.0');
      expect(gh.calls().some(({ args }) => args[0] === 'release')).toBe(false);
    });

    it('refuses when no tag ruleset is active', () => {
      const { root, origin } = setup();
      const gh = fakeGh({
        rules: {
          branches: { dist: ['deletion', 'non_fast_forward'] },
          rulesets: [],
        },
      });

      const result = runRelease(root, [], gh.env);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('tags: no active tag ruleset');
      expect(branches(origin)).not.toContain('dist');
      expect(gh.calls().some(({ args }) => args[0] === 'release')).toBe(false);
    });

    it('refuses an unprotected branch in a dry run', () => {
      const { root } = setup();
      const gh = fakeGh({ rules: UNPROTECTED });

      const result = runRelease(root, ['--dry-run'], gh.env);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('dist: missing non_fast_forward');
      expect(result.stderr).toContain('gasdev github --fix');
      expect(gh.calls().some(({ args }) => args[0] === 'release')).toBe(false);
    });

    it('fails when gh cannot read the rulesets', () => {
      const { root, origin } = setup();
      const gh = fakeGh({ rules: 'error' });

      const result = runRelease(root, [], gh.env);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('HTTP 401');
      expect(branches(origin)).not.toContain('dist');
    });
  });

  it('requires the version tag on the remote', () => {
    const { root, origin } = setup();
    git(origin, 'tag', '-d', 'v1.0.0');
    const gh = fakeGh();

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('git push origin v1.0.0');
    expect(branches(origin)).not.toContain('dist');
  });

  it('still reports the retry command when the notes file cannot be saved', () => {
    const { root, origin } = setup();
    mkdirSync(join(root, '.worktrees/github-release-v1.0.0.md'), {
      recursive: true,
    });
    const gh = fakeGh({ create: 'fail' });

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('Push to origin succeeded');
    expect(result.stderr).toContain('could not be saved');
    expect(result.stderr).toContain('First release.');
    expect(result.stderr).toContain('gh release create v1.0.0');
    expect(branches(origin)).toContain('dist');
  });

  it('requires the remote version tag to match the local one', () => {
    const { root, origin } = setup();
    const tree = git(origin, 'rev-parse', 'v1.0.0^{tree}');
    const other = git(origin, 'commit-tree', tree, '-m', 'other');
    git(origin, 'tag', '-f', 'v1.0.0', other);
    const gh = fakeGh();

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('git push origin v1.0.0');
    expect(branches(origin)).not.toContain('dist');
  });

  it('fails when gh is not installed', () => {
    const { root, origin } = setup();
    const bin = mkdtempSync(join(tmpdir(), 'gasdev-release-nogh-'));
    try {
      const gitPath = execFileSync('which', ['git'], {
        encoding: 'utf8',
      }).trim();
      symlinkSync(gitPath, join(bin, 'git'));
      const path = [dirname(process.execPath), bin];
      expect(path.some((dir) => existsSync(join(dir, 'gh')))).toBe(false);

      const result = runRelease(root, [], { PATH: path.join(':') });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('gh is not installed');
      expect(branches(origin)).not.toContain('dist');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('refuses a non-GitHub remote', () => {
    const { root, origin } = createProject({
      config: { githubRelease: true },
    });
    const gh = fakeGh();

    const result = runRelease(root, [], gh.env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not a GitHub repository');
    expect(branches(origin)).not.toContain('dist');
  });
});
