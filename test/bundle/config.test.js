// @ts-check
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { docsUrl, loadConfig } from '../../src/bundle/config.js';
import { BundleError } from '../../src/bundle/errors.js';
import { cleanup, createProject, createSandbox } from './helpers/fixtures.js';

afterEach(cleanup);

/**
 * @param {unknown} bundleConfig
 */
const load = (bundleConfig) =>
  loadConfig(createProject(createSandbox(), bundleConfig));

describe('loadConfig', () => {
  it('rejects a legacy gasDevBundle key', () => {
    const root = createProject(createSandbox());
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'app', gasDevBundle: {} }),
    );
    expect(() => loadConfig(root)).toThrow(BundleError);
    expect(() => loadConfig(root)).toThrow(
      /"gasDevBundle".*"gasdev\.bundle".*Migrating to 3\.0/,
    );
  });

  it('normalizes libraries and applies defaults', () => {
    expect(
      load({
        libraries: {
          'gas-sheetdb': '^2.1.0',
          'gas-lock': { version: '^1.2.0', repository: 'file:///x/gas-lock' },
        },
      }),
    ).toEqual({
      libraries: {
        'gas-sheetdb': {
          version: '^2.1.0',
          repository: 'https://github.com/yorsh-co/gas-sheetdb.git',
        },
        'gas-lock': { version: '^1.2.0', repository: 'file:///x/gas-lock' },
      },
      outFile: 'src/gas-libraries.js',
    });
  });

  it('keeps outFile and typesFile', () => {
    const config = load({
      libraries: { 'gas-a': '*' },
      outFile: 'src/lib/all.js',
      typesFile: 'types/all.d.ts',
    });
    expect(config.outFile).toBe('src/lib/all.js');
    expect(config.typesFile).toBe('types/all.d.ts');
  });

  it.each([
    [undefined, /no "gasdev.bundle" object/],
    [{}, /gasdev\.bundle\.libraries must be a non-empty object/],
    [{ libraries: {} }, /gasdev\.bundle\.libraries must be a non-empty object/],
    [{ libraries: ['gas-a'] }, /must be a non-empty object/],
    [
      { libraries: { 'gas-a': '*' }, outfile: 'x.js' },
      /gasdev\.bundle\.outfile is not a known option/,
    ],
    [
      { libraries: { 'gas-a': { version: '1', repositry: 'x' } } },
      /gasdev\.bundle\.libraries\.gas-a\.repositry is not a known option/,
    ],
    [{ libraries: { 'Gas-A': '1' } }, /"Gas-A" is not a valid library name/],
    [{ libraries: { '-a': '1' } }, /"-a" is not a valid library name/],
    [
      { libraries: { 'gas-a': 'nope' } },
      /gasdev\.bundle\.libraries\.gas-a must be a valid semver range/,
    ],
    [
      { libraries: { 'gas-a': { version: 3 } } },
      /gasdev\.bundle\.libraries\.gas-a\.version must be a valid semver range/,
    ],
    [
      { libraries: { 'gas-a': { version: '1', repository: '' } } },
      /gas-a\.repository must be a non-empty string/,
    ],
    [
      { libraries: { 'gas-a': '1' }, outFile: '/abs/x.js' },
      /gasdev\.bundle\.outFile must be a relative path/,
    ],
    [
      { libraries: { 'gas-a': '1' }, outFile: '../x.js' },
      /outFile must be a relative path without "\.\."/,
    ],
    [
      { libraries: { 'gas-a': '1' }, outFile: 'src/x.ts' },
      /outFile must end with \.js/,
    ],
    [
      { libraries: { 'gas-a': '1' }, typesFile: 'types/x.ts' },
      /typesFile must end with \.d\.ts/,
    ],
    [
      { libraries: { 'gas-a': '1' }, typesFile: 'a/../../x.d.ts' },
      /typesFile must be a relative path without "\.\."/,
    ],
  ])('rejects %j', (config, message) => {
    expect(() => load(config)).toThrow(BundleError);
    expect(() => load(config)).toThrow(message);
  });

  it('reports a missing package.json', () => {
    expect(() => loadConfig(createSandbox())).toThrow(
      /Cannot read package\.json/,
    );
  });
});

describe('docsUrl', () => {
  const url = 'https://github.com/yorsh-co/gas-lock/tree/dist/v1.2.0';

  it.each([
    'https://github.com/yorsh-co/gas-lock.git',
    'https://github.com/yorsh-co/gas-lock',
    'https://github.com/yorsh-co/gas-lock/',
    'git+https://github.com/yorsh-co/gas-lock.git',
    'git@github.com:yorsh-co/gas-lock.git',
    'ssh://git@github.com/yorsh-co/gas-lock.git',
    'github:yorsh-co/gas-lock',
  ])('maps %s to the dist tag', (repository) => {
    expect(docsUrl(repository, '1.2.0')).toBe(url);
  });

  it('keeps dots inside the repository name', () => {
    expect(docsUrl('https://github.com/o/gas.x.git', '1.0.0')).toBe(
      'https://github.com/o/gas.x/tree/dist/v1.0.0',
    );
  });

  it.each([
    'https://gitlab.com/o/r.git',
    'https://github.com/o/r/extra',
    '/abs/path/to/repo',
    'https://github.com.evil/o/r',
    'http://github.com/o/r',
  ])('returns %s unchanged', (repository) => {
    expect(docsUrl(repository, '1.0.0')).toBe(repository);
  });

  it.each([
    ['https://user:token@gitlab.com/o/r.git', 'https://gitlab.com/o/r.git'],
    ['https://user@github.com/o/r', 'https://github.com/o/r'],
  ])('strips credentials from %s', (repository, expected) => {
    expect(docsUrl(repository, '1.0.0')).toBe(expected);
  });
});
