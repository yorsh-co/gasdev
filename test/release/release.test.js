// @ts-check
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bumpVersion,
  cleanup,
  cloneProject,
  createProject,
  git,
  runRelease,
  writeBuild,
  writeFiles,
} from './helpers/project.js';

afterEach(cleanup);

const EXPECTED_TREE = [
  'CHANGELOG.md',
  'LICENSE.md',
  'README.md',
  'lib.d.ts',
  'lib.js',
  'lib.types.d.ts',
  'package.json',
];

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

describe('release', () => {
  it('creates an orphan dist branch with the release tree and tag on origin', () => {
    const { root, origin } = createProject();

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(tree(origin, 'dist')).toEqual(EXPECTED_TREE);
    expect(git(origin, 'show', 'dist:package.json')).toBe(
      JSON.stringify(
        {
          name: 'gas-lib',
          version: '1.0.0',
          description: 'A library',
          license: 'MIT',
          author: 'Someone',
          repository: { type: 'git', url: 'https://example.com/gas-lib.git' },
        },
        null,
        2,
      ),
    );
    expect(git(origin, 'log', '--format=%s', 'dist')).toBe('merge: v1.0.0');
    expect(
      git(origin, 'rev-list', '--parents', '-n1', 'dist').split(' '),
    ).toHaveLength(1);
    expect(git(origin, 'rev-parse', 'dist/v1.0.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });

  it('releases when the peer declarations @version matches package.json', () => {
    const { root, origin } = createProject({
      files: {
        'peer/gas-lib.peer.types.d.ts':
          '/**\n * @version 1.0.0\n */\nexport {};\n',
      },
    });

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist/v1.0.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });

  it('fast-forwards and removes files that left the build or are hidden', () => {
    const { root, origin } = createProject();
    writeBuild(root, 'one');
    writeFiles(root, { 'dist/old.js': 'old\n' });
    expect(runRelease(root).status).toBe(0);
    expect(tree(origin, 'dist')).toContain('old.js');

    const worktree = join(root, '.worktrees/dist');
    writeFiles(worktree, { 'lib.types.js': "'use strict';\n" });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-m', 'fix: ship hidden file');
    git(worktree, 'push', 'origin', 'dist');

    rmSync(join(root, 'dist/old.js'));
    writeBuild(root, 'two');
    bumpVersion(root, '1.1.0');
    const first = git(origin, 'rev-parse', 'dist');

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(tree(origin, 'dist')).toEqual(EXPECTED_TREE);
    expect(git(origin, 'show', 'dist:lib.js')).toBe('// two');
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
    expect(git(origin, 'merge-base', '--is-ancestor', first, 'dist')).toBe('');
  });

  it('tracks origin when the local dist branch is missing', () => {
    const project = createProject();
    expect(runRelease(project.root).status).toBe(0);
    const previous = git(project.origin, 'rev-parse', 'dist');

    const clone = cloneProject(project);
    writeBuild(clone, 'two');
    bumpVersion(clone, '1.1.0');

    const result = runRelease(clone);

    expect(result.status, result.stderr).toBe(0);
    expect(git(project.origin, 'rev-parse', 'dist^')).toBe(previous);
    expect(git(project.origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(project.origin, 'rev-parse', 'dist'),
    );
  });

  it('prunes a stale worktree registration of the dist branch', () => {
    const { root, origin, sandbox } = createProject();
    expect(runRelease(root).status).toBe(0);
    const previous = git(origin, 'rev-parse', 'dist');
    const elsewhere = join(sandbox, 'elsewhere');
    git(root, 'worktree', 'move', join(root, '.worktrees/dist'), elsewhere);
    rmSync(elsewhere, { recursive: true });
    expect(git(root, 'worktree', 'list', '--porcelain')).toContain('prunable');
    writeBuild(root, 'two');
    bumpVersion(root, '1.1.0');

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist^')).toBe(previous);
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });

  it('repairs the worktree links after the project directory moves', () => {
    const { root, origin, sandbox } = createProject();
    expect(runRelease(root).status).toBe(0);
    const previous = git(origin, 'rev-parse', 'dist');
    const moved = join(sandbox, 'moved');
    renameSync(root, moved);
    writeBuild(moved, 'two');
    bumpVersion(moved, '1.1.0');

    const result = runRelease(moved);

    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, 'rev-parse', 'dist^')).toBe(previous);
    expect(git(origin, 'rev-parse', 'dist/v1.1.0')).toBe(
      git(origin, 'rev-parse', 'dist'),
    );
  });
});

describe('release refusals', () => {
  it('dirty working tree', () => {
    const { root } = createProject();
    writeFileSync(join(root, 'README.md'), 'changed\n');
    expectRefusal(runRelease(root), /not clean/);
  });

  it('missing version tag', () => {
    const { root } = createProject();
    git(root, 'tag', '-d', 'v1.0.0');
    expectRefusal(runRelease(root), /v1\.0\.0 does not exist/);
  });

  it('version tag not at HEAD', () => {
    const { root } = createProject();
    writeFiles(root, { 'extra.txt': 'x\n' });
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'feat: more');
    expectRefusal(runRelease(root), /v1\.0\.0 does not point at HEAD/);
  });

  it('refuses when the peer declarations @version is stale, pushing nothing', () => {
    const { root, origin } = createProject({
      files: {
        'peer/gas-lib.peer.types.d.ts':
          '/**\n * @version 0.9.0\n */\nexport {};\n',
      },
    });
    expectRefusal(
      runRelease(root),
      /peer\/gas-lib\.peer\.types\.d\.ts.*0\.9\.0.*1\.0\.0/s,
    );
    expect(git(origin, 'branch', '--list', 'dist')).toBe('');
    expect(git(origin, 'tag', '--list', 'dist/*')).toBe('');
  });

  it('missing build directory', () => {
    const { root } = createProject();
    rmSync(join(root, 'dist'), { recursive: true });
    expectRefusal(runRelease(root), /dist\/ is missing or has no \.js/);
  });

  it('build directory without .js files', () => {
    const { root } = createProject();
    rmSync(join(root, 'dist'), { recursive: true });
    writeFiles(root, { 'dist/lib.d.ts': '\n' });
    expectRefusal(runRelease(root), /dist\/ is missing or has no \.js/);
  });

  it('release tag exists locally', () => {
    const { root, origin } = createProject();
    git(root, 'tag', 'dist/v1.0.0');
    expectRefusal(runRelease(root), /dist\/v1\.0\.0 already exists locally/);
    expect(git(origin, 'branch', '--list', 'dist')).toBe('');
  });

  it('release tag exists on origin only', () => {
    const { root } = createProject();
    git(root, 'push', 'origin', 'v1.0.0:refs/tags/dist/v1.0.0');
    expectRefusal(runRelease(root), /dist\/v1\.0\.0 already exists on origin/);
  });

  it('local dist is ahead of origin', () => {
    const { root, origin } = createProject();
    expect(runRelease(root).status).toBe(0);
    const worktree = join(root, '.worktrees/dist');
    writeFiles(worktree, { 'local.js': 'x\n' });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-m', 'fix: local only');
    bumpVersion(root, '1.1.0');
    const before = git(origin, 'rev-parse', 'dist');

    expectRefusal(runRelease(root), /not on origin\/dist/);
    expect(git(origin, 'rev-parse', 'dist')).toBe(before);
  });

  it('nothing to release', () => {
    const { root } = createProject();
    expect(runRelease(root).status).toBe(0);
    git(root, 'tag', '-d', 'dist/v1.0.0');
    git(root, 'push', 'origin', ':refs/tags/dist/v1.0.0');

    expectRefusal(
      runRelease(root),
      /Nothing to release — dist already matches/,
    );
  });

  it('dist is checked out in a live worktree elsewhere', () => {
    const { root, origin, sandbox } = createProject();
    expect(runRelease(root).status).toBe(0);
    const elsewhere = join(sandbox, 'elsewhere');
    git(root, 'worktree', 'move', join(root, '.worktrees/dist'), elsewhere);
    bumpVersion(root, '1.1.0');
    const before = git(origin, 'rev-parse', 'dist');

    expectRefusal(runRelease(root), /dist.*elsewhere/s);
    expect(git(origin, 'rev-parse', 'dist')).toBe(before);
    expect(git(root, 'tag', '--list', 'dist/v1.1.0')).toBe('');
  });

  it('dist directory is an orphan of a deleted repository', () => {
    const { root, origin, sandbox } = createProject();
    expect(runRelease(root).status).toBe(0);
    const worktree = join(root, '.worktrees/dist');
    writeFileSync(join(worktree, '.git'), `gitdir: ${sandbox}/gone/.git\n`);
    rmSync(join(root, '.git/worktrees/dist'), { recursive: true });
    bumpVersion(root, '1.1.0');
    const before = git(origin, 'rev-parse', 'dist');

    const result = runRelease(root);

    expectRefusal(
      result,
      /\.worktrees\/dist exists but is not a worktree of this repository on dist — remove it \(rm -rf \.worktrees\/dist\)/,
    );
    expect(result.stderr).not.toContain('not on origin/dist');
    expect(git(origin, 'rev-parse', 'dist')).toBe(before);
  });

  it('dist directory has another branch checked out', () => {
    const { root, origin } = createProject();
    expect(runRelease(root).status).toBe(0);
    git(join(root, '.worktrees/dist'), 'switch', '-c', 'other');
    bumpVersion(root, '1.1.0');
    const before = git(origin, 'rev-parse', 'dist');

    expectRefusal(
      runRelease(root),
      /\.worktrees\/dist exists but is not a worktree of this repository on dist/,
    );
    expect(git(origin, 'rev-parse', 'dist')).toBe(before);
  });
});
