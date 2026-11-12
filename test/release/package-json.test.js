// @ts-check
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReleaseError } from '../../src/release/errors.js';
import {
  releasePackageJson,
  shippedLoadOrder,
} from '../../src/release/package-json.js';
import { writeFiles } from './helpers/project.js';

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

/**
 * Creates a project root whose `dist/` holds the given files.
 *
 * @param {string[]} files Paths relative to `dist/`.
 * @returns {string}
 */
function buildDir(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'gasdev-release-unit-'));
  dirs.push(cwd);
  writeFiles(
    cwd,
    Object.fromEntries(files.map((file) => [`dist/${file}`, '// x\n'])),
  );
  return cwd;
}

/**
 * @param {Partial<import('../../src/release/config.js').Target>} [overrides]
 * @returns {import('../../src/release/config.js').Target}
 */
const target = (overrides = {}) => ({
  branch: 'dist',
  from: 'dist',
  hide: ['*.types.js'],
  exclude: [],
  include: [],
  files: [],
  packageJson: true,
  ...overrides,
});

describe('releasePackageJson', () => {
  const pkg = { name: 'gas-lib', version: '1.0.0', scripts: { build: 'tsc' } };

  it('keeps the output unchanged without library metadata', () => {
    expect(releasePackageJson(pkg)).toBe(
      '{\n  "name": "gas-lib",\n  "version": "1.0.0"\n}\n',
    );
  });

  it('appends gasLibrary after the kept fields', () => {
    const json = releasePackageJson(pkg, {
      loadOrder: ['a.js'],
      peers: { 'gas-lock': '^1.1.0' },
    });

    expect(Object.keys(JSON.parse(json))).toEqual([
      'name',
      'version',
      'gasLibrary',
    ]);
    expect(JSON.parse(json).gasLibrary).toEqual({
      loadOrder: ['a.js'],
      peers: { 'gas-lock': '^1.1.0' },
    });
  });

  it('omits peers when not given', () => {
    const json = releasePackageJson(pkg, { loadOrder: ['a.js'] });

    expect(JSON.parse(json).gasLibrary).toEqual({ loadOrder: ['a.js'] });
  });
});

describe('shippedLoadOrder', () => {
  it('maps .ts entries to .js in order', () => {
    const cwd = buildDir(['b.js', 'a.js', 'internal/x.js']);

    expect(
      shippedLoadOrder(target(), ['b.ts', 'internal/x.ts', 'a.ts'], cwd),
    ).toEqual(['b.js', 'internal/x.js', 'a.js']);
  });

  it('resolves entries against the target build directory', () => {
    const cwd = buildDir([]);
    writeFiles(cwd, { 'out/a.js': '// a\n' });

    expect(shippedLoadOrder(target({ from: 'out' }), ['a.ts'], cwd)).toEqual([
      'a.js',
    ]);
  });

  it('drops hidden entries', () => {
    const cwd = buildDir(['a.types.js', 'a.js']);

    expect(shippedLoadOrder(target(), ['a.types.ts', 'a.ts'], cwd)).toEqual([
      'a.js',
    ]);
  });

  it('drops entries below an excluded directory', () => {
    const cwd = buildDir(['a.js', 'web/deep/b.js', 'web/c.js']);
    const options = target({ exclude: ['web/'] });

    expect(
      shippedLoadOrder(options, ['web/deep/b.ts', 'a.ts', 'web/c.ts'], cwd),
    ).toEqual(['a.js']);
  });

  it('drops entries matched by an exclude file glob', () => {
    const cwd = buildDir(['a.js', 'b.js']);

    expect(
      shippedLoadOrder(target({ exclude: ['b.js'] }), ['a.ts', 'b.ts'], cwd),
    ).toEqual(['a.js']);
  });

  it('refuses a missing built file, naming branch and file', () => {
    const cwd = buildDir(['a.js']);

    expect(() => shippedLoadOrder(target(), ['a.ts', 'x.ts'], cwd)).toThrow(
      new ReleaseError(
        '[dist] gasdev.loadOrder: dist/x.js is missing — run the build first.',
      ),
    );
  });

  it('refuses when every entry is dropped', () => {
    const cwd = buildDir(['a.types.js']);

    expect(() => shippedLoadOrder(target(), ['a.types.ts'], cwd)).toThrow(
      /\[dist\] gasdev\.loadOrder: no entry is shipped/,
    );
  });
});
