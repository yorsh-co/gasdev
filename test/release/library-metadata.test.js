// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  createProject,
  git,
  runRelease,
  writeFiles,
} from './helpers/project.js';

afterEach(cleanup);

const LOAD_ORDER = ['lib.types.ts', 'internal/x.ts', 'lib.ts'];

/** @param {string} root */
const build = (root) =>
  writeFiles(root, {
    'dist/lib.js': '// lib\n',
    'dist/lib.types.js': "'use strict';\n",
    'dist/internal/x.js': '// x\n',
    'dist/web/w.js': '// w\n',
  });

/**
 * @param {string} origin
 * @returns {Record<string, any>}
 */
const releasedPackageJson = (origin) =>
  JSON.parse(git(origin, 'show', 'dist:package.json'));

describe('gasLibrary', () => {
  it('writes mapped paths in order, dropping hidden entries, with peers', () => {
    const { root, origin } = createProject({
      build,
      pkg: {
        gasdev: {
          loadOrder: LOAD_ORDER,
          peers: { 'gas-lock': '^1.1.0' },
        },
      },
    });

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    const pkg = releasedPackageJson(origin);
    expect(Object.keys(pkg).at(-1)).toBe('gasLibrary');
    expect(pkg.gasLibrary).toEqual({
      loadOrder: ['internal/x.js', 'lib.js'],
      peers: { 'gas-lock': '^1.1.0' },
    });
  });

  it('drops an entry below an excluded directory and omits unset peers', () => {
    const { root, origin } = createProject({
      build,
      config: { targets: [{ branch: 'dist', exclude: ['web/'] }] },
      pkg: { gasdev: { loadOrder: ['web/w.ts', 'lib.ts'] } },
    });

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(releasedPackageJson(origin).gasLibrary).toEqual({
      loadOrder: ['lib.js'],
    });
  });

  it('leaves the package.json untouched without loadOrder, even with peers', () => {
    const plain = createProject({ build });
    const withPeers = createProject({
      build,
      pkg: { gasdev: { peers: { 'gas-lock': '^1.1.0' } } },
    });

    expect(runRelease(plain.root).status).toBe(0);
    expect(runRelease(withPeers.root).status).toBe(0);

    expect(releasedPackageJson(withPeers.origin)).not.toHaveProperty(
      'gasLibrary',
    );
    expect(git(withPeers.origin, 'show', 'dist:package.json')).toBe(
      git(plain.origin, 'show', 'dist:package.json'),
    );
  });

  it('is not written for a target with packageJson false', () => {
    const { root, origin } = createProject({
      build,
      config: {
        targets: [{ branch: 'dist' }, { branch: 'bare', packageJson: false }],
      },
      pkg: { gasdev: { loadOrder: ['lib.ts'] } },
    });

    const result = runRelease(root);

    expect(result.status, result.stderr).toBe(0);
    expect(releasedPackageJson(origin).gasLibrary.loadOrder).toEqual([
      'lib.js',
    ]);
    expect(git(origin, 'ls-tree', '--name-only', 'bare')).not.toContain(
      'package.json',
    );
  });

  it('refuses a missing built file in preflight, before touching the remote', () => {
    const { root, origin } = createProject({
      build,
      pkg: { gasdev: { loadOrder: ['lib.ts', 'gone.ts'] } },
    });

    const result = runRelease(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'gasdev: [dist] gasdev.loadOrder: dist/gone.js is missing — run the build first.\n',
    );
    expect(git(origin, 'branch', '--list')).not.toContain('dist');
  });

  it('refuses when every entry is hidden or excluded', () => {
    const { root } = createProject({
      build,
      pkg: { gasdev: { loadOrder: ['lib.types.ts'] } },
    });

    const result = runRelease(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '[dist] gasdev.loadOrder: no entry is shipped',
    );
  });

  it('logs the shipped load order in a dry run', () => {
    const { root } = createProject({
      build,
      pkg: { gasdev: { loadOrder: LOAD_ORDER } },
    });

    const result = runRelease(root, ['--dry-run']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      '[dist] gasLibrary.loadOrder: 2 file(s)\n  internal/x.js\n  lib.js\n',
    );
  });
});

describe('gasdev validation', () => {
  it.each([
    [
      { loadOrder: [] },
      'gasdev.loadOrder must be a non-empty array of .ts paths.',
    ],
    [
      { loadOrder: 'lib.ts' },
      'gasdev.loadOrder must be a non-empty array of .ts paths.',
    ],
    [
      { loadOrder: ['lib.js'] },
      'gasdev.loadOrder must be a non-empty array of .ts paths.',
    ],
    [
      { loadOrder: ['lib.ts', 1] },
      'gasdev.loadOrder must be a non-empty array of .ts paths.',
    ],
    [
      { peers: ['gas-lock'] },
      'gasdev.peers must be an object of version ranges.',
    ],
    [
      { peers: { 'gas-lock': 1 } },
      'gasdev.peers must be an object of version ranges.',
    ],
  ])('rejects %j', (gasdev, message) => {
    const { root } = createProject({ build, pkg: { gasdev } });

    const result = runRelease(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`gasdev: ${message}\n`);
  });
});
