import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, createProject } from './support.js';

const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

/**
 * Effective compilerOptions of gas-error 1.1.0's tsconfig.json
 * (`tsc --showConfig`), without the path-relative `rootDir`/`outDir`, and
 * with `target` lowered to ES2020 for Apps Script's parser.
 */
const GAS_ERROR_OPTIONS = {
  target: 'es2020',
  types: ['google-apps-script'],
  lib: ['es2021'],
  declaration: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  strict: true,
  noEmitOnError: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  noUncheckedSideEffectImports: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  module: 'es6',
  moduleResolution: 'classic',
  preserveConstEnums: true,
  noImplicitAny: true,
  noImplicitThis: true,
  strictNullChecks: true,
  strictFunctionTypes: true,
  strictBindCallApply: true,
  strictPropertyInitialization: true,
  strictBuiltinIteratorReturn: true,
  alwaysStrict: true,
  useUnknownInCatchVariables: true,
};

/**
 * Runs `tsc -p` on a project that extends a shared config and includes one file.
 *
 * @param {string} dir Project directory.
 * @param {string} config Shared config name, e.g. `gas`.
 * @param {string} file File to compile, relative to the project.
 * @returns {{ status: number | null, output: string }}
 */
function compile(dir, config, file) {
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: `gasdev/tsconfig/${config}.json`,
      compilerOptions: { noEmit: true },
      include: [file],
    }),
  );
  const result = spawnSync(TSC, ['-p', dir], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe.each([
  { config: 'gas', ok: 'ok.ts', bad: 'bad.ts', error: /'document'/ },
  { config: 'web', ok: 'ok.ts', bad: 'bad.ts', error: /'SpreadsheetApp'/ },
  { config: 'test', ok: 'ok.ts', bad: 'bad.ts', error: /not assignable/ },
  { config: 'node', ok: 'ok.js', bad: 'bad.js', error: /not assignable/ },
])('tsconfig/$config.json', ({ config, ok, bad, error }) => {
  /** @type {ReturnType<typeof createProject>} */
  let project;

  beforeAll(() => {
    project = createProject(`tsconfig/${config}`);
  });

  afterAll(() => project.cleanup());

  it('is resolvable through the package exports map and compiles valid code', () => {
    const { status, output } = compile(project.dir, config, ok);
    expect(output).toBe('');
    expect(status).toBe(0);
  });

  it('rejects invalid code', () => {
    const { status, output } = compile(project.dir, config, bad);
    expect(status).not.toBe(0);
    expect(output).toMatch(error);
  });
});

describe('tsconfig/gas.json', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;

  beforeAll(() => {
    project = createProject('tsconfig/gas');
  });

  afterAll(() => project.cleanup());

  it('has the effective compilerOptions of the gas-error tsconfig, targeting ES2020', () => {
    writeFileSync(
      join(project.dir, 'tsconfig.json'),
      JSON.stringify({
        extends: 'gasdev/tsconfig/gas.json',
        include: ['ok.ts'],
      }),
    );
    const { compilerOptions } = JSON.parse(
      execFileSync(TSC, ['--showConfig', '-p', project.dir], {
        encoding: 'utf8',
      }),
    );
    expect(compilerOptions).toEqual(GAS_ERROR_OPTIONS);
  });

  it('downlevels the ES2021 syntax Apps Script rejects', () => {
    writeFileSync(
      join(project.dir, 'es2021.ts'),
      'let a = 0;\na ||= 1;\nlet b: number | null = null;\nb ??= 1_000;\n',
    );
    writeFileSync(
      join(project.dir, 'tsconfig.json'),
      JSON.stringify({
        extends: 'gasdev/tsconfig/gas.json',
        compilerOptions: { outDir: 'out', declaration: false },
        include: ['es2021.ts'],
      }),
    );
    execFileSync(TSC, ['-p', project.dir], { encoding: 'utf8' });
    const output = readFileSync(join(project.dir, 'out', 'es2021.js'), 'utf8');
    expect(output).not.toMatch(/\|\|=|\?\?=|1_000/);
  });
});

describe('tsconfig/gas-test.json', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;

  beforeAll(() => {
    project = createProject('tsconfig/gas-test');
  });

  afterAll(() => project.cleanup());

  /**
   * @param {string} config tsconfig file name inside the fixture's gas-test directory.
   * @returns {{ status: number | null, output: string }}
   */
  function tsc(config) {
    const result = spawnSync(
      TSC,
      ['-p', join(project.dir, 'gas-test', config)],
      { encoding: 'utf8' },
    );
    return { status: result.status, output: result.stdout + result.stderr };
  }

  it('type-checks tests against src and the runtime types', () => {
    expect(tsc('tsconfig.json')).toEqual({ status: 0, output: '' });
  });

  it('rejects a test that misuses the runtime types', () => {
    const { status, output } = tsc('tsconfig.bad.json');
    expect(status).not.toBe(0);
    expect(output).toMatch(/not assignable/);
  });
});

describe('package exports', () => {
  it('ships every config referenced by the exports map', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    expect(pkg.exports).toMatchObject({
      './prettier': './prettier.json',
      './tsconfig/*': './tsconfig/*',
    });
    expect(pkg.files).toEqual(
      expect.arrayContaining(['prettier.json', 'tsconfig', 'gas-test']),
    );
    expect(pkg.exports['./gas-test/runtime.js']).toBe('./gas-test/runtime.js');
  });
});
