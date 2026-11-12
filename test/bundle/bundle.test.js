// @ts-check
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { bundle } from '../../src/bundle/index.js';
import {
  cleanup,
  createLibrary,
  createSandbox,
  git,
  writeFiles,
} from './helpers/fixtures.js';

afterEach(cleanup);

/**
 * @param {Parameters<typeof bundle>[0]} options
 * @returns {{ result: ReturnType<typeof bundle>, warnings: string[] }}
 */
function run(options) {
  /** @type {string[]} */
  const warnings = [];
  const result = bundle({ ...options, warn: (m) => warnings.push(m) });
  return { result, warnings };
}

/**
 * @param {string} sandbox
 * @returns {{ cwd: string, cacheDir: string }}
 */
function project(sandbox) {
  const cwd = join(sandbox, 'project');
  mkdirSync(cwd, { recursive: true });
  return {
    cwd,
    cacheDir: join(cwd, 'node_modules/.cache/gasdev/bundle'),
  };
}

describe('version resolution', () => {
  it('picks the highest matching dist tag and ignores unparseable ones', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [
      { version: '1.0.0' },
      { version: '1.4.2' },
      { version: '2.0.0' },
      { version: '1.10.0' },
    ]);
    git(repo, 'tag', 'dist/vnext');
    git(repo, 'tag', 'v9.9.9');
    const { result } = run({
      libraries: { 'gas-a': { version: '^1.0.0', repository: repo } },
      ...project(sandbox),
    });
    expect(result.resolved[0]).toMatchObject({
      name: 'gas-a',
      version: '1.10.0',
      repository: repo,
    });
    expect(result.resolved[0]?.sha).toBe(
      git(repo, 'rev-parse', 'dist/v1.10.0'),
    );
    expect(result.code).toContain("'1.10.0'");
  });

  it('accepts a file:// URL as repository', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    const { result } = run({
      libraries: { 'gas-a': { version: '*', repository: `file://${repo}` } },
      ...project(sandbox),
    });
    expect(result.resolved[0]?.version).toBe('1.0.0');
  });

  it('lists the available versions when nothing matches', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [
      { version: '1.0.0' },
      { version: '1.2.0' },
    ]);
    expect(() =>
      run({
        libraries: { 'gas-a': { version: '^2.0.0', repository: repo } },
        ...project(sandbox),
      }),
    ).toThrow(
      /gas-a: no dist tag satisfies "\^2\.0\.0".*available versions: 1\.0\.0, 1\.2\.0/,
    );
  });

  it("includes git's stderr when git fails", () => {
    const sandbox = createSandbox();
    expect(() =>
      run({
        libraries: {
          'gas-a': { version: '*', repository: join(sandbox, 'missing') },
        },
        ...project(sandbox),
      }),
    ).toThrow(/git ls-remote failed: .*missing/s);
  });
});

describe('ordering', () => {
  /**
   * @param {string} sandbox
   * @param {Record<string, Record<string, string>>} peers Peers by library.
   * @param {string[]} configOrder
   */
  function libraries(sandbox, peers, configOrder) {
    return Object.fromEntries(
      configOrder.map((name) => [
        name,
        {
          version: '*',
          repository: createLibrary(sandbox, name, [
            { version: '1.0.0', peers: peers[name] ?? {} },
          ]),
        },
      ]),
    );
  }

  it('loads a peer before the library using it and keeps config order for ties', () => {
    const sandbox = createSandbox();
    const { result } = run({
      libraries: libraries(
        sandbox,
        { 'gas-a': { 'gas-c': '*' }, 'gas-b': { 'gas-missing': '*' } },
        ['gas-a', 'gas-b', 'gas-c', 'gas-d'],
      ),
      ...project(sandbox),
    });
    expect(result.resolved.map((r) => r.name)).toEqual([
      'gas-b',
      'gas-c',
      'gas-a',
      'gas-d',
    ]);
  });

  it('names the libraries of a peer cycle', () => {
    const sandbox = createSandbox();
    expect(() =>
      run({
        libraries: libraries(
          sandbox,
          { 'gas-a': { 'gas-b': '*' }, 'gas-b': { 'gas-a': '*' } },
          ['gas-a', 'gas-b', 'gas-c'],
        ),
        ...project(sandbox),
      }),
    ).toThrow(/cycle between gas-a, gas-b\./);
  });

  it('warns when a configured peer does not satisfy the range', () => {
    const sandbox = createSandbox();
    const { result, warnings } = run({
      libraries: libraries(sandbox, { 'gas-a': { 'gas-b': '^2.0.0' } }, [
        'gas-a',
        'gas-b',
      ]),
      ...project(sandbox),
    });
    expect(result.resolved).toHaveLength(2);
    expect(warnings).toEqual([
      'gasdev: warning: gas-a 1.0.0 expects gas-b ^2.0.0, but gas-b 1.0.0 is bundled.',
    ]);
  });

  it('does not warn when peers are satisfied or not configured', () => {
    const sandbox = createSandbox();
    const { warnings } = run({
      libraries: libraries(
        sandbox,
        { 'gas-a': { 'gas-b': '^1.0.0', 'gas-x': '^9.0.0' } },
        ['gas-a', 'gas-b'],
      ),
      ...project(sandbox),
    });
    expect(warnings).toEqual([]);
  });
});

describe('generated code', () => {
  it('writes a deterministic header, one directive and markers', () => {
    const sandbox = createSandbox();
    const a = createLibrary(sandbox, 'gas-a', [
      {
        version: '1.0.0',
        files: {
          'gas-a.constants.js': '"use strict";\nconst A = 1;\n',
          'sub/x.js': '\'use strict\';\nconst X = 2; // "use strict";\n',
        },
        loadOrder: ['gas-a.constants.js', 'sub/x.js'],
      },
    ]);
    const b = createLibrary(sandbox, 'gas-b', [
      { version: '2.0.0', peers: { 'gas-a': '^1.0.0' } },
    ]);
    const options = {
      libraries: {
        'gas-b': { version: '*', repository: b },
        'gas-a': { version: '*', repository: a },
      },
      ...project(sandbox),
    };
    const { result } = run(options);
    const [shaA, shaB] = [a, b].map((r) => git(r, 'rev-parse', 'HEAD'));
    expect(result.code).toBe(
      [
        '// Generated by gasdev bundle — do not edit. Run `npx gasdev bundle` to update.',
        `// gas-a 1.0.0 (${shaA})`,
        `//   ${a}`,
        `// gas-b 2.0.0 (${shaB})`,
        `//   ${b}`,
        '',
        "'use strict';",
        '',
        '// ---- gas-a/gas-a.constants.js ----',
        'const A = 1;',
        '',
        '// ---- gas-a/sub/x.js ----',
        'const X = 2; // "use strict";',
        '',
        '// ---- gas-b/gas-b.js ----',
        "var gas_b = '2.0.0';",
        '',
      ].join('\n'),
    );
    expect(run(options).result.code).toBe(result.code);
  });

  it('rejects a syntax error', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [
      { version: '1.0.0', files: { 'gas-a.js': 'const = ;\n' } },
    ]);
    expect(() =>
      run({
        libraries: { 'gas-a': { version: '*', repository: repo } },
        ...project(sandbox),
      }),
    ).toThrow(/syntax error/);
  });

  it('appends extraFiles after the libraries with markers', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    writeFiles(sandbox, {
      'extra/lib.js': '"use strict";\nvar own = 1;\n',
      'extra/lib.test.js': 'var test = 2;',
    });
    const { result } = run({
      libraries: { 'gas-a': { version: '*', repository: repo } },
      extraFiles: [
        join(sandbox, 'extra/lib.js'),
        join(sandbox, 'extra/lib.test.js'),
      ],
      ...project(sandbox),
    });
    expect(result.code).toMatch(
      /\/\/ ---- gas-a\/gas-a\.js ----\n.*\n\n\/\/ ---- lib\.js ----\nvar own = 1;\n\n\/\/ ---- lib\.test\.js ----\nvar test = 2;\n$/s,
    );
  });

  it('rejects relative extraFiles', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    expect(() =>
      run({
        libraries: { 'gas-a': { version: '*', repository: repo } },
        extraFiles: ['lib.js'],
        ...project(sandbox),
      }),
    ).toThrow(/must be absolute/);
  });

  it('concatenates declarations sorted by path in bundle order', () => {
    const sandbox = createSandbox();
    const a = createLibrary(sandbox, 'gas-a', [
      {
        version: '1.0.0',
        files: {
          'gas-a.js': 'var a = 1;\n',
          'z.d.ts': 'declare const z: 1;\n',
          'sub/b.d.ts': 'declare const b: 1;\n',
          'gas-a.d.ts': 'declare const a: 1;\n',
        },
        loadOrder: ['gas-a.js'],
      },
    ]);
    const b = createLibrary(sandbox, 'gas-b', [
      { version: '1.0.0', peers: { 'gas-a': '*' } },
    ]);
    const { result } = run({
      libraries: {
        'gas-b': { version: '*', repository: b },
        'gas-a': { version: '*', repository: a },
      },
      ...project(sandbox),
    });
    const markers = result.types.match(/^\/\/ ---- .* ----$/gm);
    expect(markers).toEqual([
      '// ---- gas-a/gas-a.d.ts ----',
      '// ---- gas-a/sub/b.d.ts ----',
      '// ---- gas-a/z.d.ts ----',
    ]);
    expect(result.types).toContain('declare const z: 1;');
    expect(result.types.startsWith('// Generated by gasdev bundle')).toBe(true);
  });
});

describe('library metadata', () => {
  /**
   * @param {import('./helpers/fixtures.js').LibraryVersion} version
   */
  function bundleOne(version) {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [version]);
    return () =>
      run({
        libraries: { 'gas-a': { version: '*', repository: repo } },
        ...project(sandbox),
      });
  }

  it('requires gasLibrary and points at gasdev release', () => {
    expect(bundleOne({ version: '1.0.0', gasLibrary: null })).toThrow(
      /gas-a: package\.json has no gasLibrary\.loadOrder; gas-a needs a release made with gasdev release \(or gas-dev-release >= 1\.1\.0\) and gasdev\.loadOrder/,
    );
  });

  it('rejects an empty loadOrder', () => {
    expect(
      bundleOne({ version: '1.0.0', gasLibrary: { loadOrder: [] } }),
    ).toThrow(/gasdev release/);
  });

  it('rejects a name mismatch', () => {
    expect(bundleOne({ version: '1.0.0', packageName: 'gas-other' })).toThrow(
      /named "gas-other", expected "gas-a"/,
    );
  });

  it.each([
    [['../x.js'], /must be a relative \.js path/],
    [['a.ts'], /must be a relative \.js path/],
    [['/abs.js'], /must be a relative \.js path/],
    [['missing.js'], /lists missing\.js, which is missing/],
  ])('rejects loadOrder %j', (loadOrder, message) => {
    expect(bundleOne({ version: '1.0.0', gasLibrary: { loadOrder } })).toThrow(
      message,
    );
  });

  it('rejects an invalid peer range', () => {
    expect(
      bundleOne({
        version: '1.0.0',
        gasLibrary: { loadOrder: ['gas-a.js'], peers: { 'gas-b': 'nope' } },
      }),
    ).toThrow(/gasLibrary\.peers\.gas-b must be a valid semver range/);
  });
});

describe.skipIf(process.platform === 'win32')('symbolic links', () => {
  /**
   * Bundles gas-a from a dist tag built by `version`, which receives a directory outside the
   * project holding `secret.js` and `secret.d.ts`.
   *
   * @param {(outside: string) => import('./helpers/fixtures.js').LibraryVersion} version
   */
  function bundleLinked(version) {
    const sandbox = createSandbox();
    const outside = join(sandbox, 'outside');
    writeFiles(outside, {
      'secret.js': "'local secret';\n",
      'secret.d.ts': 'declare const secret: string;\n',
    });
    const repo = createLibrary(sandbox, 'gas-a', [version(outside)]);
    return () =>
      run({
        libraries: { 'gas-a': { version: '*', repository: repo } },
        ...project(sandbox),
      });
  }

  it.each([
    [
      'a file outside the clone',
      (/** @type {string} */ outside) => join(outside, 'secret.js'),
    ],
    ['the cache metadata', () => '.gasdev-bundle.json'],
    ['a committed file', () => 'prefix.js'],
  ])('rejects a loadOrder entry linking to %s', (_, target) => {
    expect(
      bundleLinked((outside) => ({
        version: '1.0.0',
        files: { 'prefix.js': 'var leaked =\n' },
        symlinks: { 'linked.js': target(outside) },
        loadOrder: ['prefix.js', 'linked.js'],
      })),
    ).toThrow(
      /gas-a: gasLibrary\.loadOrder lists linked\.js, which resolves through a symbolic link in the dist tag/,
    );
  });

  it('rejects a loadOrder entry inside a linked directory', () => {
    expect(
      bundleLinked((outside) => ({
        version: '1.0.0',
        files: { 'gas-a.js': 'var a = 1;\n' },
        symlinks: { lib: outside },
        loadOrder: ['gas-a.js', 'lib/secret.js'],
      })),
    ).toThrow(/lists lib\/secret\.js, which resolves through a symbolic link/);
  });

  it.each([
    ['meta.d.ts', () => ({ 'meta.d.ts': '.gasdev-bundle.json' })],
    [
      'types/secret.d.ts',
      (/** @type {string} */ outside) => ({ types: outside }),
    ],
  ])('rejects the linked declaration %s', (path, symlinks) => {
    expect(
      bundleLinked((outside) => ({
        version: '1.0.0',
        files: { 'gas-a.js': 'var a = 1;\n' },
        symlinks: symlinks(outside),
      })),
    ).toThrow(
      `gas-a: ${path} resolves through a symbolic link in the dist tag.`,
    );
  });

  it('replaces a linked cache metadata file without writing through it', () => {
    const sandbox = createSandbox();
    const target = join(sandbox, 'outside', 'target.json');
    writeFiles(join(sandbox, 'outside'), { 'target.json': 'untouched\n' });
    const repo = createLibrary(sandbox, 'gas-a', [
      {
        version: '1.0.0',
        files: { 'gas-a.js': 'var a = 1;\n' },
        symlinks: { '.gasdev-bundle.json': target },
      },
    ]);
    const options = project(sandbox);
    const { result } = run({
      libraries: { 'gas-a': { version: '*', repository: repo } },
      ...options,
    });
    expect(result.code).toContain('var a = 1;');
    expect(readFileSync(target, 'utf8')).toBe('untouched\n');
    const metadata = join(options.cacheDir, 'gas-a@1.0.0/.gasdev-bundle.json');
    expect(lstatSync(metadata).isFile()).toBe(true);
    expect(JSON.parse(readFileSync(metadata, 'utf8'))).toMatchObject({
      name: 'gas-a',
      version: '1.0.0',
      repository: repo,
    });
  });

  it('ignores links to files the bundle does not read', () => {
    const { result } = bundleLinked((outside) => ({
      version: '1.0.0',
      files: { 'gas-a.js': 'var a = 1;\n' },
      symlinks: { 'README.md': join(outside, 'secret.js') },
    }))();
    expect(result.code).toContain('var a = 1;');
    expect(result.code).not.toContain('local secret');
  });
});

describe('without libraries', () => {
  it('bundles only the extra files', () => {
    const sandbox = createSandbox();
    const extra = join(sandbox, 'extra.js');
    writeFileSync(extra, '"use strict";\nvar onlyExtra = 1;\n');
    const { result } = run({
      libraries: {},
      extraFiles: [extra],
      ...project(sandbox),
    });
    expect(result.resolved).toEqual([]);
    expect(result.code).toContain(
      '// ---- extra.js ----\nvar onlyExtra = 1;\n',
    );
    expect(result.code).not.toContain('"use strict";');
  });

  it('runs every file in strict mode', () => {
    const sandbox = createSandbox();
    const extra = join(sandbox, 'sloppy.js');
    writeFileSync(extra, 'undeclared = 1;\n');
    const { result } = run({
      libraries: {},
      extraFiles: [extra],
      ...project(sandbox),
    });
    expect(() => runInNewContext(result.code)).toThrow(
      /undeclared is not defined/,
    );
  });
});

describe('cache', () => {
  it('reuses a complete entry without cloning again', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    const options = {
      libraries: { 'gas-a': { version: '*', repository: repo } },
      ...project(sandbox),
    };
    const entry = join(options.cacheDir, 'gas-a@1.0.0');
    const first = run(options).result;
    expect(existsSync(join(entry, '.git'))).toBe(false);
    expect(existsSync(join(entry, 'package.json'))).toBe(true);

    // A fresh clone would replace the entry and drop this file.
    writeFiles(entry, { 'kept.txt': 'x' });
    const second = run(options).result;
    expect(existsSync(join(entry, 'kept.txt'))).toBe(true);
    expect(second.code).toBe(first.code);
    expect(second.resolved[0]?.sha).toBe(first.resolved[0]?.sha);
  });

  it('refetches an entry cached from a different repository', () => {
    const sandbox = createSandbox();
    const original = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    const fork = createLibrary(createSandbox(), 'gas-a', [
      { version: '1.0.0' },
    ]);
    const options = {
      libraries: { 'gas-a': { version: '*', repository: original } },
      ...project(sandbox),
    };
    run(options);
    const { result } = run({
      ...options,
      libraries: { 'gas-a': { version: '*', repository: fork } },
    });
    expect(result.resolved[0]?.repository).toBe(fork);
    expect(result.resolved[0]?.sha).toBe(git(fork, 'rev-parse', 'HEAD'));
  });

  it('does not treat an entry without metadata or a leftover staging dir as cached', () => {
    const sandbox = createSandbox();
    const repo = createLibrary(sandbox, 'gas-a', [{ version: '1.0.0' }]);
    const options = {
      libraries: { 'gas-a': { version: '*', repository: repo } },
      ...project(sandbox),
    };
    writeFiles(options.cacheDir, {
      'gas-a@1.0.0/package.json': '{"name":"gas-a"}',
      '.gas-a@1.0.0-leftover/clone/partial.js': 'x',
    });
    const { result } = run(options);
    expect(result.code).toContain("var gas_a = '1.0.0'");
    expect(result.resolved[0]?.sha).toBe(git(repo, 'rev-parse', 'HEAD'));
  });
});
