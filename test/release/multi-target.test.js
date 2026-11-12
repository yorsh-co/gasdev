// @ts-check
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * @param {Record<string, unknown>} [config]
 * @param {Parameters<typeof createProject>[0]} [options]
 */
const webappProject = (config = WEBAPP_CONFIG, options = {}) =>
  createProject({
    config,
    files: { 'src/web/README.md': '# web\n' },
    build: (root) => writeWebappBuild(root, 'one'),
    ...options,
  });

/**
 * @param {string} repo
 * @param {string} ref
 * @returns {string[]}
 */
const tree = (repo, ref) =>
  git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n');

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @param {RegExp} message
 */
function expectRefusal(result, message) {
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^gasdev: /);
  expect(result.stderr).toMatch(message);
  expect(result.stderr).not.toContain('    at ');
}

/**
 * Installs a hook in the bare origin that rejects updates of the `dist-web` branch.
 *
 * @param {string} origin
 * @param {'update' | 'pre-receive'} name
 */
function rejectDistWeb(origin, name) {
  const script =
    name === 'update'
      ? '[ "$1" = refs/heads/dist-web ] && exit 1\nexit 0\n'
      : 'while read old new ref; do [ "$ref" = refs/heads/dist-web ] && exit 1; done\nexit 0\n';
  const path = join(origin, 'hooks', name);
  writeFileSync(path, `#!/bin/sh\n${script}`);
  chmodSync(path, 0o755);
}

describe('multi-target release', () => {
  it('publishes both gas-webapp branches and tags', () => {
    const { root, origin } = webappProject();

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(tree(origin, 'dist')).toEqual([
      'CHANGELOG.md',
      'LICENSE.md',
      'README.md',
      'main.d.ts',
      'main.js',
      'package.json',
      'shared/contract.types.d.ts',
    ]);
    expect(git(origin, 'show', 'dist:README.md')).toBe('# lib');
    expect(tree(origin, 'dist-web')).toEqual([
      'CHANGELOG.md',
      'LICENSE.md',
      'README.md',
      'client.d.ts',
      'client.js',
      'shared/contract.types.d.ts',
      'types/x.d.ts',
    ]);
    expect(git(origin, 'show', 'dist-web:README.md')).toBe('# web');
    for (const branch of ['dist', 'dist-web']) {
      expect(git(origin, 'rev-parse', `${branch}/v1.0.0`)).toBe(
        git(origin, 'rev-parse', branch),
      );
    }
  });

  it('skips targets without changes and tags only the changed ones', () => {
    const { root, origin } = webappProject();
    expect(runRelease(root).status).toBe(0);
    const web = git(origin, 'rev-parse', 'dist-web');
    writeWebappBuild(root, 'two');
    bumpVersion(root, '1.1.0');

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('[dist-web] No changes — skipped');
    expect(result.stdout).not.toContain('[dist] No changes');
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
    expect(git(origin, 'rev-parse', 'dist-web')).toBe(web);
    expect(git(origin, 'tag', '--list', 'dist-web/*')).toBe('dist-web/v1.0.0');
  });

  it('excludes directories only for patterns with a trailing slash', () => {
    const { root, origin } = createProject({
      config: { targets: [{ branch: 'dist', exclude: ['web/', 'lib.d.ts'] }] },
      build: (dir) => {
        writeBuild(dir, 'one');
        writeFiles(dir, { 'dist/web': 'file\n', 'dist/a/web/x.js': 'x\n' });
      },
    });

    expect(runRelease(root).status).toBe(0);
    expect(tree(origin, 'dist')).toEqual([
      'CHANGELOG.md',
      'LICENSE.md',
      'README.md',
      'lib.js',
      'lib.types.d.ts',
      'package.json',
      'web',
    ]);
  });

  it('rejects the whole push when the remote refuses one ref', () => {
    const { root, origin } = webappProject();
    rejectDistWeb(origin, 'update');

    const result = runRelease(root);

    expect(result.status).toBe(1);
    expect(git(origin, 'branch', '--list', 'dist', 'dist-web')).toBe('');
    expect(git(origin, 'tag', '--list')).toBe('v1.0.0');
    expect(result.stderr).toContain(
      'git push --atomic origin dist refs/tags/dist/v1.0.0 dist-web refs/tags/dist-web/v1.0.0',
    );
    expect(result.stderr).toContain('git tag -d dist/v1.0.0');
    expect(result.stderr).toContain('git tag -d dist-web/v1.0.0');
    expect(result.stderr).toContain(
      'git worktree remove --force .worktrees/dist && git branch -D dist',
    );
    expect(git(root, 'tag', '--list', 'dist*/*')).toContain('dist/v1.0.0');
  });

  it('names the reset command for branches that exist on the remote', () => {
    const { root, origin } = webappProject();
    expect(runRelease(root).status).toBe(0);
    writeWebappBuild(root, 'two');
    bumpVersion(root, '1.1.0');
    rejectDistWeb(origin, 'update');
    writeFiles(root, { 'dist/web/client.js': '// changed\n' });

    const result = runRelease(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'git -C .worktrees/dist reset --hard origin/dist',
    );
    expect(git(origin, 'tag', '--list', 'dist*/v1.1.0')).toBe('');
  });
});

describe('multi-target config and preflight', () => {
  it('rejects duplicate branches', () => {
    const { root } = createProject({
      config: { targets: [{ branch: 'dist' }, { branch: 'dist' }] },
    });
    expectRefusal(runRelease(root), /more than one target for branch "dist"/);
  });

  it.each([
    [{ targets: [] }, /targets must be a non-empty array/],
    [{ targets: [{}] }, /targets\[0\]\.branch must be a non-empty string/],
    [
      { targets: [{ branch: 'a', hide: '*.js' }] },
      /targets\[0\]\.hide must be an array of strings/,
    ],
    [
      { targets: [{ branch: 'a', packageJson: 'no' }] },
      /packageJson must be a boolean/,
    ],
    [
      { targets: [{ branch: 'a', include: [{ from: 'dist', to: '../x' }] }] },
      /to must be a path inside the branch/,
    ],
    [
      { targets: [{ branch: 'a', files: ['README.md:/etc/x'] }] },
      /must be a path inside the branch/,
    ],
  ])('rejects invalid config %j', (config, message) => {
    const { root } = createProject({ config });
    expectRefusal(runRelease(root), message);
  });

  it('fails in preflight when a files source is missing', () => {
    const { root, origin } = webappProject();
    rmSync(join(root, 'src/web/README.md'));
    git(root, 'commit', '-am', 'chore: drop');
    git(root, 'tag', '-f', 'v1.0.0');

    expectRefusal(runRelease(root), /File src\/web\/README\.md does not exist/);
    expect(git(origin, 'branch', '--list', 'dist')).toBe('');
  });

  it('fails in preflight when an include source is missing', () => {
    const { root, origin } = webappProject();
    rmSync(join(root, 'dist/shared'), { recursive: true });

    expectRefusal(runRelease(root), /Include dist\/shared\/ does not exist/);
    expect(git(origin, 'branch', '--list', 'dist')).toBe('');
  });

  it('ignores the unignored .worktrees directory in the clean-tree check', () => {
    const { root, origin } = createProject({ gitignore: 'dist/\n' });
    expect(runRelease(root).status).toBe(0);
    writeBuild(root, 'two');
    bumpVersion(root, '1.1.0');

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });

  it('still refuses other untracked files', () => {
    const { root } = createProject({ gitignore: 'dist/\n' });
    writeFiles(root, { 'stray.txt': 'x\n' });
    expectRefusal(runRelease(root), /not clean/);
  });
});
