// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import {
  cleanup,
  createLibrary,
  createProject,
  createSandbox,
  git,
  runBundle,
} from './helpers/fixtures.js';

afterEach(cleanup);

describe('gasdev bundle CLI', () => {
  it.each(['--help', '-h'])('%s prints usage and exits 0', (flag) => {
    const result = runBundle(process.cwd(), [flag]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: gasdev bundle');
    expect(result.stdout).toContain('gasdev.bundle');
  });

  it('--version prints the package version', () => {
    const result = runBundle(process.cwd(), ['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it.each([
    [['--bogus'], /Unknown option '--bogus'/],
    [['extra'], /Unexpected argument 'extra'/],
    [['--version=1'], /does not take an argument/],
  ])('exits 2 with a hint on invalid usage %j', (args, message) => {
    const result = runBundle(process.cwd(), args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^gasdev: /);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain('Run gasdev bundle --help for usage.');
  });

  it('exits 1 with a prefixed message on a known failure', () => {
    const result = runBundle(createProject(createSandbox(), { libraries: {} }));
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'gasdev: gasdev.bundle.libraries must be a non-empty object.\n',
    );
  });

  it('bundles end to end, writes both files and prints a summary', () => {
    const sandbox = createSandbox();
    const lock = createLibrary(sandbox, 'gas-lock', [
      { version: '1.1.0' },
      {
        version: '1.2.0',
        files: {
          'gas-lock.js': 'var lock = 1;\n',
          'gas-lock.d.ts': 'declare const lock: 1;\n',
        },
        loadOrder: ['gas-lock.js'],
      },
    ]);
    const db = createLibrary(sandbox, 'gas-sheetdb', [
      { version: '2.1.0', peers: { 'gas-lock': '^1.1.0' } },
    ]);
    const root = createProject(sandbox, {
      libraries: {
        'gas-sheetdb': { version: '^2.1.0', repository: db },
        'gas-lock': { version: '^1.1.0', repository: lock },
      },
      outFile: 'src/lib/gas-libraries.js',
      typesFile: 'types/gas-libraries.d.ts',
    });
    const result = runBundle(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const sha = (/** @type {string} */ repo) =>
      git(repo, 'rev-parse', 'HEAD').slice(0, 7);
    expect(result.stdout.split('\n').slice(0, 4)).toEqual([
      `gas-lock 1.2.0 (${sha(lock)}) ${lock}`,
      `gas-sheetdb 2.1.0 (${sha(db)}) ${db}`,
      'Wrote src/lib/gas-libraries.js',
      'Wrote types/gas-libraries.d.ts',
    ]);
    expect(result.stdout).toContain(
      'src/lib/gas-libraries.js must load before project code',
    );
    const code = readFileSync(join(root, 'src/lib/gas-libraries.js'), 'utf8');
    expect(code).toContain('// ---- gas-lock/gas-lock.js ----\nvar lock = 1;');
    expect(code).toContain('// ---- gas-sheetdb/gas-sheetdb.js ----');
    expect(
      readFileSync(join(root, 'types/gas-libraries.d.ts'), 'utf8'),
    ).toContain('declare const lock: 1;');
  });

  it('writes nothing when the bundle has a syntax error', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [
      { version: '1.0.0', files: { 'gas-a.js': 'const = ;\n' } },
    ]);
    const root = createProject(sandbox, {
      libraries: { 'gas-a': { version: '*', repository: repo } },
      typesFile: 'types/x.d.ts',
    });
    const result = runBundle(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^gasdev: .*syntax error/);
    expect(existsSync(join(root, 'src/gas-libraries.js'))).toBe(false);
    expect(existsSync(join(root, 'types'))).toBe(false);
  });
});
