// @ts-check
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bumpVersion,
  cleanup,
  createProject,
  git,
  runRelease,
  writeBuild,
  writeFiles,
  writeWebappBuild,
} from './helpers/project.js';

afterEach(cleanup);

const WEBAPP_CONFIG = {
  targets: [
    {
      branch: 'dist',
      hide: ['**/types/*.js', 'shared/*.js'],
      exclude: ['web/'],
    },
    {
      branch: 'dist-web',
      from: 'dist/web',
      hide: ['**/types/*.js'],
      include: [{ from: 'dist/shared', to: 'shared', hide: ['*.js'] }],
      files: ['src/web/README.md:README.md', 'LICENSE.md', 'CHANGELOG.md'],
      packageJson: false,
    },
  ],
};

const webappProject = () =>
  createProject({
    config: WEBAPP_CONFIG,
    files: { 'src/web/README.md': '# web\n' },
    build: (root) => writeWebappBuild(root, 'one'),
  });

/**
 * @param {string} repo
 * @returns {string}
 */
const refs = (repo) => git(repo, 'for-each-ref');

describe('--target', () => {
  it('releases only the named target', () => {
    const { root, origin } = webappProject();

    const result = runRelease(root, ['--target', 'dist-web']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'branch', '--list', 'dist', 'dist-web')).toBe(
      'dist-web',
    );
    expect(git(origin, 'tag', '--list')).toBe('dist-web/v1.0.0\nv1.0.0');
    expect(readdirSync(join(root, '.worktrees'))).toEqual(['dist-web']);
  });

  it('accepts the option more than once', () => {
    const { root, origin } = webappProject();

    const result = runRelease(root, ['--target', 'dist', '--target=dist-web']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'tag', '--list', 'dist*/*')).toBe(
      'dist-web/v1.0.0\ndist/v1.0.0',
    );
  });

  it('refuses an unknown target and lists the configured branches', () => {
    const { root, origin } = webappProject();
    const before = refs(origin);

    const result = runRelease(root, ['--target', 'nope']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'gasdev: Unknown target "nope" — configured branches: dist, dist-web.',
    );
    expect(refs(origin)).toBe(before);
  });

  it('checks the preflight of the selected targets only', () => {
    const { root } = webappProject();
    git(root, 'tag', 'dist/v1.0.0');

    const result = runRelease(root, ['--target', 'dist-web']);

    expect(result.status, result.stderr).toBe(0);
  });
});

describe('--dry-run', () => {
  it('on a first release reports the staged files and leaves no trace', () => {
    const { root, origin } = createProject();
    const originBefore = git(root, 'ls-remote', origin);
    const refsBefore = refs(root);

    const result = runRelease(root, ['--dry-run']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('[dist] Staged changes:');
    expect(result.stdout).toContain('lib.js');
    expect(result.stdout).toContain('package.json');
    expect(result.stdout).not.toContain('lib.types.js');
    expect(result.stdout).toContain('Dry run — nothing was committed');
    expect(git(root, 'ls-remote', origin)).toBe(originBefore);
    expect(refs(root)).toBe(refsBefore);
    expect(git(root, 'branch', '--list', 'dist')).toBe('');
    expect(git(root, 'worktree', 'list')).not.toContain('.worktrees');
    expect(git(root, 'status', '--porcelain')).toBe('');

    const real = runRelease(root);
    expect(real.status, real.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist/v1.0.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });

  it('on a later release restores the worktree and a real release follows', () => {
    const { root, origin } = createProject();
    expect(runRelease(root).status).toBe(0);
    writeBuild(root, 'two');
    writeFiles(root, { 'dist/extra.js': 'x\n' });
    bumpVersion(root, '1.1.0');
    const originBefore = git(root, 'ls-remote', origin);
    const refsBefore = refs(root);
    const worktree = join(root, '.worktrees/dist');
    const head = git(worktree, 'rev-parse', 'HEAD');

    const result = runRelease(root, ['--dry-run']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('extra.js');
    expect(git(root, 'ls-remote', origin)).toBe(originBefore);
    expect(refs(root)).toBe(refsBefore);
    expect(git(root, 'tag', '--list', 'dist/*')).toBe('dist/v1.0.0');
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(worktree, 'status', '--porcelain', '--ignored')).toBe('');
    expect(git(worktree, 'diff', '--cached', '--name-only')).toBe('');

    const real = runRelease(root);
    expect(real.status, real.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
    expect(git(origin, 'show', 'dist:lib.js')).toBe('// two');
  });

  it('reports skipped targets and combines with --target', () => {
    const { root, origin } = webappProject();
    expect(runRelease(root).status).toBe(0);
    writeWebappBuild(root, 'two');
    bumpVersion(root, '1.1.0');
    const originBefore = git(root, 'ls-remote', origin);

    const all = runRelease(root, ['--dry-run']);
    expect(all.status, all.stderr).toBe(0);
    expect(all.stdout).toContain('[dist-web] No changes — skipped');
    expect(all.stdout).toContain('[dist] Staged changes:');

    const subset = runRelease(root, ['--dry-run', '--target', 'dist']);
    expect(subset.status, subset.stderr).toBe(0);
    expect(subset.stdout).not.toContain('dist-web');
    expect(git(root, 'ls-remote', origin)).toBe(originBefore);
  });

  it('exits 1 like a real run when there is nothing to release', () => {
    const { root, origin } = createProject();
    expect(runRelease(root).status).toBe(0);
    git(root, 'tag', '-d', 'dist/v1.0.0');
    git(root, 'push', 'origin', ':refs/tags/dist/v1.0.0');
    const worktree = join(root, '.worktrees/dist');
    const originBefore = git(root, 'ls-remote', origin);

    const result = runRelease(root, ['--dry-run']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Nothing to release');
    expect(git(root, 'ls-remote', origin)).toBe(originBefore);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
  });

  it('refuses where a real run would', () => {
    const { root } = createProject();
    git(root, 'tag', 'dist/v1.0.0');

    const result = runRelease(root, ['--dry-run']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/v1.0.0 already exists locally');
  });
});
