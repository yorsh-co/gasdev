import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gasEslint } from '../eslint/index.js';
import { REPO_ROOT, createProject } from './support.js';

vi.setConfig({ testTimeout: 30_000 });

const ESLINT = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');

/**
 * Runs the suite with the process cwd inside the project: configs are loaded
 * lazily and the factory detects `tsconfig.test.json` against `process.cwd()`.
 *
 * @param {() => string} getDir Project directory, known once `beforeAll` ran.
 */
function useCwd(getDir) {
  const previous = process.cwd();
  beforeAll(() => process.chdir(getDir()));
  afterAll(() => process.chdir(previous));
}

/**
 * Resolved config of a file, reduced to what the factory is responsible for.
 *
 * @param {ESLint} linter
 * @param {string} dir
 * @param {string} file Path relative to `dir`.
 */
async function resolved(linter, dir, file) {
  const config = await linter.calculateConfigForFile(join(dir, file));
  return {
    rules: config?.rules,
    sourceType: config?.languageOptions?.sourceType,
    project: config?.languageOptions?.parserOptions?.['project'],
  };
}

/**
 * Runs the ESLint CLI with the project as cwd, as a consumer would; type-aware
 * parsing resolves `project` against the process cwd, so it cannot be driven
 * in-process for several projects at once. The CLI runs without vitest's
 * subprocess coverage, because it executes no measured code and the dumps made
 * type-aware runs exceed the timeout under `--coverage`.
 *
 * @param {string} dir Project directory.
 * @param {string[]} targets Files or directories to lint, relative to `dir`.
 * @returns {Record<string, string[]>} Reported rule ids by project-relative file.
 */
function lint(dir, ...targets) {
  const { stdout, stderr } = spawnSync(
    ESLINT,
    ['--format', 'json', ...targets],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_V8_COVERAGE: undefined,
        NODE_DISABLE_COMPILE_CACHE: undefined,
      },
    },
  );
  if (!stdout) throw new Error(stderr);
  /** @type {{ filePath: string, messages: { ruleId: string | null, message: string }[] }[]} */
  const results = JSON.parse(stdout);
  return Object.fromEntries(
    results.map((r) => [
      r.filePath.slice(dir.length + 1),
      r.messages.map((m) => m.ruleId ?? m.message),
    ]),
  );
}

/**
 * @param {import('eslint').Linter.Config[]} configs
 * @returns {boolean}
 */
function hasTestBlock(configs) {
  return configs.some((c) => c.files?.toString() === 'test/**/*.ts');
}

describe('gasEslint() default preset', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;
  /** @type {ESLint} */
  let linter;

  beforeAll(() => {
    project = createProject('eslint/gas');
    linter = new ESLint({ cwd: project.dir });
  });

  afterAll(() => project.cleanup());
  useCwd(() => project.dir);

  it('lints src as a GAS script and tests/scripts as Node ESM', async () => {
    const src = await resolved(linter, project.dir, 'src/lib.ts');
    expect(src.sourceType).toBe('script');
    expect(src.project).toBe('./tsconfig.json');
    expect(src.rules?.['no-unused-vars']?.[0]).toBe(0);

    const test = await resolved(linter, project.dir, 'test/lib.ts');
    expect(test.sourceType).toBe('module');
    expect(test.project).toBe('./tsconfig.test.json');

    const script = await resolved(linter, project.dir, 'scripts/x.js');
    expect(script.sourceType).toBe('module');
  });

  it('lints gas-test as a GAS script with the runtime globals, not as a Node test', async () => {
    const config = await linter.calculateConfigForFile(
      join(project.dir, 'gas-test/lib.ts'),
    );
    expect(config?.languageOptions?.sourceType).toBe('script');
    expect(config?.languageOptions?.parserOptions?.['project']).toBe(
      './gas-test/tsconfig.json',
    );
    expect(config?.languageOptions?.globals).toMatchObject({
      test: 'readonly',
      info: 'readonly',
      assert: 'readonly',
      runGasTests: 'readonly',
    });
    expect(config?.languageOptions?.globals).not.toHaveProperty('process');
    expect(config?.rules?.['@typescript-eslint/no-unused-vars']?.[0]).toBe(0);
  });

  it('exposes Node globals to tests and not to src', async () => {
    const test = await linter.calculateConfigForFile(
      join(project.dir, 'test/lib.ts'),
    );
    const src = await linter.calculateConfigForFile(
      join(project.dir, 'src/lib.ts'),
    );
    expect(test?.languageOptions?.globals).toHaveProperty('process');
    expect(src?.languageOptions?.globals ?? {}).not.toHaveProperty('process');
  });

  it('ignores peer/ and dist/', async () => {
    expect(await linter.isPathIgnored(join(project.dir, 'peer/x.d.ts'))).toBe(
      true,
    );
    expect(await linter.isPathIgnored(join(project.dir, 'dist/x.js'))).toBe(
      true,
    );
    expect(await linter.isPathIgnored(join(project.dir, 'src/lib.ts'))).toBe(
      false,
    );
  });

  it('ignores .claude/worktrees/', async () => {
    expect(
      await linter.isPathIgnored(
        join(project.dir, '.claude/worktrees/x/src/lib.ts'),
      ),
    ).toBe(true);
  });

  it('reports no errors on the clean fixture', async () => {
    const results = lint(project.dir, 'src', 'test', 'gas-test', 'scripts');
    expect(Object.values(results).flat()).toEqual([]);
    expect(Object.keys(results).sort()).toEqual([
      'gas-test/lib.ts',
      'scripts/x.js',
      'src/lib.ts',
      'test/lib.ts',
    ]);
  });

  it('reports seeded violations', async () => {
    writeFileSync(join(project.dir, 'src/bad.ts'), 'debugger;\n');
    writeFileSync(join(project.dir, 'test/bad.ts'), 'debugger;\n');
    writeFileSync(join(project.dir, 'gas-test/bad.ts'), 'debugger;\n');
    writeFileSync(join(project.dir, 'scripts/bad.js'), 'debugger;\n');
    const files = [
      'src/bad.ts',
      'test/bad.ts',
      'gas-test/bad.ts',
      'scripts/bad.js',
    ];
    const results = lint(project.dir, ...files);
    for (const file of files) {
      expect(results[file]).toEqual(['no-debugger']);
    }
  });

  it.each([
    ['async function declaration', 'async function f() {}\n'],
    ['async function expression', 'const f = async function () {};\n'],
    ['async arrow function', 'const f = async () => 1;\n'],
    ['async class method', 'class A {\n  async m() {}\n}\n'],
    ['async object method', 'const o = {\n  async m() {},\n};\n'],
    ['await', 'async function f() {\n  await 1;\n}\n', 2],
    [
      'for await',
      'async function f(xs: AsyncIterable<number>) {\n  for await (const x of xs) console.log(x);\n}\n',
      2,
    ],
  ])('forbids %s in src and gas-test', (_name, code, count = 1) => {
    const files = ['src/async.ts', 'gas-test/async.ts'];
    for (const file of files) writeFileSync(join(project.dir, file), code);
    const results = lint(project.dir, ...files);
    for (const file of files) {
      expect(results[file]).toEqual(Array(count).fill('no-restricted-syntax'));
    }
  });

  it('names the cause in the async/await message', () => {
    const configs = gasEslint({ cwd: project.dir });
    const block = configs.find((c) => c.files?.toString() === 'src/**/*.ts');
    expect(JSON.stringify(block?.rules?.['no-restricted-syntax'])).toContain(
      'Apps Script rejects async/await on push',
    );
  });

  it('allows async in test and scripts', () => {
    writeFileSync(
      join(project.dir, 'test/async.ts'),
      'export async function f() {\n  await 1;\n}\n',
    );
    writeFileSync(
      join(project.dir, 'scripts/async.js'),
      'export async function f() {\n  await 1;\n}\n',
    );
    const files = ['test/async.ts', 'scripts/async.js'];
    const results = lint(project.dir, ...files);
    for (const file of files) expect(results[file]).toEqual([]);
  });

  it('includes the test block only when tsconfig.test.json exists', () => {
    expect(hasTestBlock(gasEslint({ cwd: project.dir }))).toBe(true);
    rmSync(join(project.dir, 'tsconfig.test.json'));
    expect(hasTestBlock(gasEslint({ cwd: project.dir }))).toBe(false);
  });

  it('includes the gas-test block only when gas-test/tsconfig.json exists', () => {
    const hasBlock = (/** @type {string} */ cwd) =>
      gasEslint({ cwd }).some(
        (c) => c.files?.toString() === 'gas-test/**/*.ts',
      );
    expect(hasBlock(project.dir)).toBe(true);
    const bare = createProject('eslint/gas');
    try {
      rmSync(join(bare.dir, 'gas-test/tsconfig.json'));
      expect(hasBlock(bare.dir)).toBe(false);
    } finally {
      bare.cleanup();
    }
  });

  it('appends extra configs before Prettier and honors ignores', () => {
    const configs = gasEslint(
      { ignores: ['generated/**'], cwd: project.dir },
      { rules: { 'no-console': 'error' } },
    );
    expect(configs[0]?.ignores).toContain('generated/**');
    const extra = configs.findIndex((c) => c.rules?.['no-console']);
    expect(extra).toBeGreaterThan(-1);
    expect(extra).toBeLessThan(configs.length - 1);
  });
});

describe('gasEslint() equivalence with gas-error', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;

  beforeAll(() => {
    project = createProject('eslint/gas');
    // The legacy config imports its plugins directly, as gas-error does.
    for (const pkg of [
      '@eslint',
      'eslint',
      'eslint-config-prettier',
      'globals',
      'typescript-eslint',
    ]) {
      symlinkSync(
        join(REPO_ROOT, 'node_modules', pkg),
        join(project.dir, 'node_modules', pkg),
        'dir',
      );
    }
  });

  afterAll(() => project.cleanup());
  useCwd(() => project.dir);

  it('resolves the same config as the gas-error eslint.config.js', async () => {
    const factory = new ESLint({ cwd: project.dir });
    const legacy = new ESLint({
      cwd: project.dir,
      overrideConfigFile: join(project.dir, 'legacy.config.js'),
    });
    for (const file of ['src/lib.ts', 'test/lib.ts', 'scripts/x.js']) {
      const actual = await resolved(factory, project.dir, file);
      // The async/await restriction is the only deliberate divergence.
      if (file === 'src/lib.ts') delete actual.rules?.['no-restricted-syntax'];
      expect(actual).toEqual(await resolved(legacy, project.dir, file));
    }
    for (const file of ['peer/x.d.ts', 'dist/x.js']) {
      expect(await factory.isPathIgnored(join(project.dir, file))).toBe(
        await legacy.isPathIgnored(join(project.dir, file)),
      );
    }
  });
});

describe('gasEslint({ web })', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;
  /** @type {ESLint} */
  let linter;

  beforeAll(() => {
    project = createProject('eslint/web');
    linter = new ESLint({ cwd: project.dir });
  });

  afterAll(() => project.cleanup());
  useCwd(() => project.dir);

  it('lints web files with browser globals and their own tsconfig', async () => {
    const config = await linter.calculateConfigForFile(
      join(project.dir, 'src/web/client.ts'),
    );
    expect(config?.languageOptions?.sourceType).toBe('script');
    expect(config?.languageOptions?.globals).toHaveProperty('document');
    expect(config?.languageOptions?.parserOptions?.['project']).toBe(
      './tsconfig.frontend.json',
    );
    expect(config?.rules?.['@typescript-eslint/no-unused-vars']?.[0]).toBe(0);
  });

  it('keeps web files out of the GAS block', async () => {
    const gas = await linter.calculateConfigForFile(
      join(project.dir, 'src/lib.ts'),
    );
    expect(gas?.languageOptions?.parserOptions?.['project']).toBe(
      './tsconfig.json',
    );
    expect(gas?.languageOptions?.globals ?? {}).not.toHaveProperty('document');
  });

  it('allows async in web files but forbids it in GAS files', () => {
    const code = 'async function f() {\n  await 1;\n}\n';
    writeFileSync(join(project.dir, 'src/web/async.ts'), code);
    writeFileSync(join(project.dir, 'src/async.ts'), code);
    const results = lint(project.dir, 'src/web/async.ts', 'src/async.ts');
    rmSync(join(project.dir, 'src/web/async.ts'));
    rmSync(join(project.dir, 'src/async.ts'));
    expect(results['src/web/async.ts']).toEqual([]);
    expect(results['src/async.ts']).toEqual([
      'no-restricted-syntax',
      'no-restricted-syntax',
    ]);
  });

  it('reports no errors on the clean fixture and flags seeded violations', async () => {
    const results = lint(project.dir, 'src', 'scripts');
    expect(Object.values(results).flat()).toEqual([]);
    writeFileSync(join(project.dir, 'src/web/bad.ts'), 'debugger;\n');
    expect(lint(project.dir, 'src/web/bad.ts')['src/web/bad.ts']).toEqual([
      'no-debugger',
    ]);
  });
});

describe("gasEslint({ preset: 'node' })", () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;
  /** @type {ESLint} */
  let linter;

  beforeAll(() => {
    project = createProject('eslint/node');
    linter = new ESLint({ cwd: project.dir });
  });

  afterAll(() => project.cleanup());
  useCwd(() => project.dir);

  it('lints JavaScript as Node ESM without TypeScript parsing', async () => {
    const config = await linter.calculateConfigForFile(
      join(project.dir, 'index.js'),
    );
    expect(config?.languageOptions?.sourceType).toBe('module');
    expect(config?.languageOptions?.globals).toHaveProperty('process');
    expect(config?.plugins).not.toHaveProperty('@typescript-eslint');
  });

  it('ignores node_modules and custom ignores', async () => {
    expect(
      await linter.isPathIgnored(join(project.dir, 'node_modules/x/y.js')),
    ).toBe(true);
    expect(await linter.isPathIgnored(join(project.dir, 'skipped/x.js'))).toBe(
      true,
    );
  });

  it('ignores .claude/worktrees/', async () => {
    expect(
      await linter.isPathIgnored(
        join(project.dir, '.claude/worktrees/x/index.js'),
      ),
    ).toBe(true);
  });

  it('reports no errors on the clean fixture and flags seeded violations', async () => {
    const results = lint(project.dir, 'index.js');
    expect(Object.values(results).flat()).toEqual([]);
    writeFileSync(join(project.dir, 'bad.js'), 'debugger;\n');
    expect(lint(project.dir, 'bad.js')['bad.js']).toEqual(['no-debugger']);
  });
});

describe('gasEslint() option validation', () => {
  it.each([
    [{ nope: 1 }, /unknown option "nope"/],
    [{ preset: 'deno' }, /"preset"/],
    [{ ignores: 'dist' }, /"ignores"/],
    [{ ignores: [1] }, /"ignores"/],
    [{ cwd: 1 }, /"cwd"/],
    [{ web: 'src' }, /"web"/],
    [{ web: { files: [], tsconfig: 'a.json' } }, /"web\.files"/],
    [{ web: { files: ['a'], tsconfig: 1 } }, /"web\.tsconfig"/],
    [{ web: { files: ['a'], tsconfig: 'a.json', x: 1 } }, /"web\.x"/],
    [
      { preset: 'node', web: { files: ['a'], tsconfig: 'a.json' } },
      /"web".*"node"/,
    ],
    [null, /options must be an object/],
  ])('rejects %j', (options, message) => {
    // @ts-expect-error deliberately invalid options
    expect(() => gasEslint(options)).toThrow(TypeError);
    // @ts-expect-error deliberately invalid options
    expect(() => gasEslint(options)).toThrow(message);
  });
});
