import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** @type {{ base: string, text: string }[]} */
let captured = [];
/** @type {any} */
let options;

vi.mock('../src/bundle/index.js', () => ({
  BundleError: class BundleError extends Error {},
  bundle: vi.fn((/** @type {any} */ opts) => {
    options = opts;
    captured = opts.extraFiles.map((/** @type {string} */ f) => ({
      base: basename(f),
      text: readFileSync(f, 'utf8'),
    }));
    return { code: '// bundled\n', types: '', resolved: [] };
  }),
}));

const { buildGasTest, GasTestError } = await import('../bin/gas-test.js');

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} A project with two library files and two tests. */
function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-build-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'gas-test'));
  writeFileSync(join(dir, 'src', 'b.ts'), 'const B: number = A + 1;\n');
  writeFileSync(join(dir, 'src', 'a.ts'), 'const A: number = 1;\n');
  writeFileSync(join(dir, 'gas-test', 'z.ts'), "test('z', () => {});\n");
  writeFileSync(join(dir, 'gas-test', 'a.ts'), "test('a', () => {});\n");
  writeFileSync(
    join(dir, 'gas-test', 'types.d.ts'),
    'declare const X: number;\n',
  );
  return dir;
}

describe('buildGasTest', () => {
  it('bundles peers, then library in load order, runtime and sorted tests', () => {
    const dir = createProject();
    const peers = { 'gas-lock': '^1.0.0' };
    const code = buildGasTest(dir, {
      preset: 'gas',
      loadOrder: ['a.ts', 'b.ts'],
      peers,
      gasTest: undefined,
    });
    expect(options.libraries).toEqual(peers);
    expect(options.cwd).toBe(dir);
    expect(captured.map((f) => f.base)).toEqual([
      'a.js',
      'b.js',
      'runtime.js',
      'a.js',
      'z.js',
    ]);
    expect(captured[0]?.text).toBe('const A = 1;\n');
    expect(captured[3]?.text).toContain("test('a'");
    expect(code).toMatch(
      /^\/\/ gasdev gas-test build \d{4}-\d\d-\d\dT[\d:.]+Z [0-9a-f]{16}\n\/\/ bundled\n$/,
    );
  });

  it('downlevels the ES2021 syntax Apps Script rejects', () => {
    const dir = createProject();
    writeFileSync(join(dir, 'src', 'a.ts'), 'let A = 0;\nA ||= 1_000;\n');
    buildGasTest(dir, {
      preset: 'gas',
      loadOrder: ['a.ts'],
      peers: undefined,
      gasTest: undefined,
    });
    expect(captured[0]?.text).not.toMatch(/\|\|=|1_000/);
  });

  it('uses no libraries without peers and a unique first line per build', () => {
    const dir = createProject();
    const config = {
      preset: 'gas',
      loadOrder: ['a.ts'],
      peers: undefined,
      gasTest: undefined,
    };
    const first = buildGasTest(dir, config);
    expect(options.libraries).toEqual({});
    expect(buildGasTest(dir, config).split('\n')[0]).not.toBe(
      first.split('\n')[0],
    );
  });

  it('fails without a loadOrder or without tests', () => {
    const dir = createProject();
    expect(() =>
      buildGasTest(dir, {
        preset: 'gas',
        loadOrder: undefined,
        peers: undefined,
        gasTest: undefined,
      }),
    ).toThrow(GasTestError);
    rmSync(join(dir, 'gas-test'), { recursive: true });
    expect(() =>
      buildGasTest(dir, {
        preset: 'gas',
        loadOrder: ['a.ts'],
        peers: undefined,
        gasTest: undefined,
      }),
    ).toThrow('no tests found: gas-test/*.ts');
  });
});
