import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { placeholderScript } from '../bin/check.js';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');
const TEMPLATES = join(REPO_ROOT, 'templates');

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Creates a project that matches a preset's templates exactly.
 *
 * @param {'gas' | 'node'} preset
 * @param {Record<string, unknown>} [pkgExtra] Extra package.json fields.
 * @returns {string} Project directory.
 */
function createCleanProject(preset, pkgExtra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-check-'));
  dirs.push(dir);
  const read = (/** @type {string} */ f) =>
    readFileSync(join(TEMPLATES, preset, f), 'utf8');
  writeFileSync(join(dir, '.gitignore'), read('gitignore'));
  writeFileSync(join(dir, '.prettierignore'), read('prettierignore'));
  mkdirSync(join(dir, '.github'));
  writeFileSync(
    join(dir, '.github', 'dependabot.yml'),
    read('.github/dependabot.yml'),
  );
  const { required, present, gasTest } = JSON.parse(read('scripts.json'));
  const configured = /** @type {any} */ (pkgExtra.gasdev)?.gasTest;
  const scripts = { ...required, ...(configured && gasTest) };
  for (const name of present) scripts[name] = 'true';
  writePackage(dir, { name: 'consumer', scripts, ...pkgExtra });
  return dir;
}

/**
 * @param {string} dir
 * @param {Record<string, unknown>} pkg
 */
function writePackage(dir, pkg) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

/**
 * @param {string} dir
 * @returns {Record<string, any>}
 */
function readPackage(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function run(cwd, args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe.each(['gas', 'node'])('check (%s preset)', (preset) => {
  const make = () =>
    createCleanProject(
      /** @type {'gas' | 'node'} */ (preset),
      preset === 'node' ? { gasdev: { preset: 'node' } } : {},
    );

  it('passes on a project matching the templates', () => {
    const result = run(make(), ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('✓ Config check passed\n');
  });

  it('allows extra ignore lines', () => {
    const dir = make();
    writeFileSync(
      join(dir, '.prettierignore'),
      `# header\n\ndist/**/*.md\n${readFileSync(join(dir, '.prettierignore'), 'utf8')}`,
    );
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('reports a missing .gitignore line', () => {
    const dir = make();
    const file = join(dir, '.gitignore');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('.worktrees/\n', ''),
    );
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.gitignore\n  missing line: .worktrees/');
    expect(result.stderr).toContain('1 issue(s) in 1 file(s)');
  });

  it.each(['.claude/worktrees/', '.claude/plans/', '.claude/handoff/', '.env'])(
    'reports a missing .gitignore line: %s',
    (entry) => {
      const dir = make();
      const file = join(dir, '.gitignore');
      writeFileSync(file, readFileSync(file, 'utf8').replace(`${entry}\n`, ''));
      const result = run(dir, ['check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`.gitignore\n  missing line: ${entry}`);
      expect(result.stderr).toContain('1 issue(s) in 1 file(s)');
    },
  );

  it.each(['.claude/worktrees', '.claude/plans', '.claude/handoff'])(
    'reports a missing .prettierignore line: %s',
    (entry) => {
      const dir = make();
      const file = join(dir, '.prettierignore');
      writeFileSync(file, readFileSync(file, 'utf8').replace(`${entry}\n`, ''));
      const result = run(dir, ['check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `.prettierignore\n  missing line: ${entry}`,
      );
      expect(result.stderr).toContain('1 issue(s) in 1 file(s)');
    },
  );

  it('reports a missing .prettierignore file', () => {
    const dir = make();
    rmSync(join(dir, '.prettierignore'));
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.prettierignore\n  file is missing');
  });

  it('reports a different dependabot.yml', () => {
    const dir = make();
    writeFileSync(join(dir, '.github', 'dependabot.yml'), 'version: 2\n');
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.github/dependabot.yml\n  differs from');
  });

  it('ignores trailing whitespace differences in dependabot.yml', () => {
    const dir = make();
    const file = join(dir, '.github', 'dependabot.yml');
    writeFileSync(file, `${readFileSync(file, 'utf8').trimEnd()}  \n\n`);
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('reports a wrong check script with expected and found values', () => {
    const dir = make();
    const pkg = readPackage(dir);
    pkg.scripts.check = 'npm run test';
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts.check differs; expected: npm run');
    expect(result.stderr).toContain('gasdev check');
    expect(result.stderr).toContain('found: "npm run test"');
  });

  it('reports a missing required script', () => {
    const dir = make();
    const pkg = readPackage(dir);
    delete pkg.scripts.lint;
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'scripts.lint is missing; expected: eslint',
    );
  });

  describe('--fix', () => {
    /**
     * @param {string} dir
     * @param {string} name
     */
    const read = (dir, name) => readFileSync(join(dir, name), 'utf8');
    /** @param {string} name */
    const template = (name) =>
      readFileSync(join(TEMPLATES, preset, name.slice(1)), 'utf8');

    it.each(['.claude/worktrees', '.claude/plans', '.claude/handoff'])(
      'appends missing lines: %s',
      (entry) => {
        const dir = make();
        writeFileSync(
          join(dir, '.gitignore'),
          read(dir, '.gitignore').replace('.worktrees/\n', ''),
        );
        writeFileSync(
          join(dir, '.prettierignore'),
          read(dir, '.prettierignore').replace(`${entry}\n`, ''),
        );
        const result = run(dir, ['check', '--fix']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('.gitignore: added .worktrees/');
        expect(result.stdout).toContain(`.prettierignore: added ${entry}`);
        expect(result.stdout).toContain('✓ Config check passed');
        expect(read(dir, '.gitignore')).toContain('\n.worktrees/\n');
        expect(read(dir, '.prettierignore')).toContain(`\n${entry}\n`);
      },
    );

    it('appends a missing .env to .gitignore', () => {
      const dir = make();
      writeFileSync(
        join(dir, '.gitignore'),
        read(dir, '.gitignore').replace('.env\n', ''),
      );
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('.gitignore: added .env');
      expect(read(dir, '.gitignore')).toContain('\n.env\n');
    });

    it('keeps extra lines', () => {
      const dir = make();
      const entry = '.claude/plans';
      writeFileSync(
        join(dir, '.prettierignore'),
        `# header\ncustom/\n${read(dir, '.prettierignore').replace(`${entry}\n`, '')}`,
      );
      expect(run(dir, ['check', '--fix']).status).toBe(0);
      const text = read(dir, '.prettierignore');
      expect(text.startsWith('# header\ncustom/\n')).toBe(true);
      expect(text.endsWith(`${entry}\n`)).toBe(true);
    });

    it('adds a newline before appending to a file without one', () => {
      const dir = make();
      const lines = template('.gitignore').trimEnd().split('\n');
      const removed = lines.pop();
      writeFileSync(join(dir, '.gitignore'), lines.join('\n'));
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`.gitignore: added ${removed}`);
      expect(read(dir, '.gitignore').endsWith('\n')).toBe(true);
      const actual = read(dir, '.gitignore').split('\n');
      for (const line of template('.gitignore').split('\n')) {
        if (line !== '') expect(actual).toContain(line);
      }
    });

    it('appends with CRLF line endings', () => {
      const dir = make();
      writeFileSync(
        join(dir, '.prettierignore'),
        template('.prettierignore')
          .replace('.claude/plans\n', '')
          .replace(/\n/g, '\r\n'),
      );
      expect(run(dir, ['check', '--fix']).status).toBe(0);
      const text = read(dir, '.prettierignore');
      expect(text).toContain('.claude/plans\r\n');
      expect(/(?<!\r)\n/.test(text)).toBe(false);
    });

    it('creates a missing file from the template', () => {
      const dir = make();
      rmSync(join(dir, '.prettierignore'));
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('.prettierignore: created');
      expect(read(dir, '.prettierignore')).toBe(template('.prettierignore'));
    });

    it('is idempotent', () => {
      const dir = make();
      writeFileSync(
        join(dir, '.gitignore'),
        read(dir, '.gitignore').replace('.worktrees/\n', ''),
      );
      rmSync(join(dir, '.prettierignore'));
      const first = run(dir, ['check', '--fix']);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain('.gitignore: added .worktrees/');
      expect(first.stdout).toContain('.prettierignore: created');
      const gitignore = read(dir, '.gitignore');
      const prettierignore = read(dir, '.prettierignore');
      const second = run(dir, ['check', '--fix']);
      expect(second.status).toBe(0);
      expect(second.stdout).toBe('✓ Config check passed\n');
      expect(read(dir, '.gitignore')).toBe(gitignore);
      expect(read(dir, '.prettierignore')).toBe(prettierignore);
    });

    it('exits 1 when other drift remains', () => {
      const dir = make();
      writeFileSync(join(dir, '.github', 'dependabot.yml'), 'version: 2\n');
      writeFileSync(
        join(dir, '.gitignore'),
        read(dir, '.gitignore').replace('.worktrees/\n', ''),
      );
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('.gitignore: added .worktrees/');
      expect(read(dir, '.gitignore')).toContain('.worktrees/');
      expect(result.stderr).toContain('.github/dependabot.yml');
      expect(result.stderr).toContain(
        '1 issue(s) in 1 file(s) that --fix cannot fix; edit them manually',
      );
    });

    it('adds a missing required script', () => {
      const dir = make();
      const pkg = readPackage(dir);
      const expected = pkg.scripts.lint;
      delete pkg.scripts.lint;
      writePackage(dir, pkg);
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('package.json: added scripts.lint');
      expect(readPackage(dir).scripts.lint).toBe(expected);
    });

    it('creates a missing dependabot.yml', () => {
      const dir = make();
      rmSync(join(dir, '.github', 'dependabot.yml'));
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('.github/dependabot.yml: created');
    });
  });
});

describe('check (placeholder scripts)', () => {
  const PRESENT = ['build', 'build:watch', 'typecheck'];

  it('adds a failing placeholder for each missing present script with --fix', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    for (const name of PRESENT) delete pkg.scripts[name];
    writePackage(dir, pkg);
    const result = run(dir, ['check', '--fix']);
    expect(result.status).toBe(0);
    const scripts = readPackage(dir).scripts;
    for (const name of PRESENT) {
      expect(scripts[name]).toBe(placeholderScript(name));
      expect(result.stdout).toContain(
        `package.json: added a placeholder scripts.${name}; replace it`,
      );
      expect(result.stdout).toContain(
        `  warning: scripts.${name} is a placeholder; replace it with the project's command\n`,
      );
    }
    expect(result.stdout.trimEnd()).toMatch(
      /✓ Config check passed with 3 warning\(s\)$/,
    );
  });

  it('reports a placeholder as a warning without failing', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    pkg.scripts.build = placeholderScript('build');
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "package.json\n  warning: scripts.build is a placeholder; replace it with the project's command\n" +
        '✓ Config check passed with 1 warning(s)\n',
    );
  });

  it('still fails on other drift alongside a placeholder', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    pkg.scripts.build = placeholderScript('build');
    delete pkg.scripts.typecheck;
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('warning: scripts.build is a placeholder');
    expect(result.stderr).toContain('1 issue(s) in 1 file(s)\n');
  });

  it.skipIf(process.platform === 'win32')(
    'exits non-zero with the replacement hint when run',
    () => {
      const result = spawnSync('sh', ['-c', placeholderScript('build')], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        'gasdev: replace the scripts.build placeholder in package.json\n',
      );
    },
  );
});

describe('check (preset specifics)', () => {
  it('reports a missing typecheck script on the gas preset', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    delete pkg.scripts.typecheck;
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts.typecheck is missing\n');
  });

  it('reports a missing typecheck script on the node preset', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node' },
    });
    const pkg = readPackage(dir);
    delete pkg.scripts.typecheck;
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'scripts.typecheck is missing; expected: tsc',
    );
  });

  it('defaults to the gas preset', () => {
    const dir = createCleanProject('gas');
    expect(readPackage(dir).gasdev).toBeUndefined();
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('accepts the local bin and coverage gate in this package itself', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node' },
    });
    const pkg = readPackage(dir);
    pkg.name = 'gasdev';
    pkg.scripts.check = pkg.scripts.check
      .replace('gasdev check', 'node bin/gasdev.js check')
      .replace('npm run test &&', 'npm run test:coverage &&');
    pkg.scripts['test:coverage'] = 'vitest run --coverage';
    writePackage(dir, pkg);
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('requires the coverage gate in this package itself', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node' },
    });
    const pkg = readPackage(dir);
    pkg.name = 'gasdev';
    pkg.scripts.check = pkg.scripts.check.replace(
      'gasdev check',
      'node bin/gasdev.js check',
    );
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run test:coverage &&');
  });

  it('requires the test:coverage script in this package itself', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node' },
    });
    const pkg = readPackage(dir);
    pkg.name = 'gasdev';
    pkg.scripts.check = pkg.scripts.check
      .replace('gasdev check', 'node bin/gasdev.js check')
      .replace('npm run test &&', 'npm run test:coverage &&');
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scripts.test:coverage is missing');
  });

  it.each([
    ['gasDevConfig', 'gasdev'],
    ['gasDevBundle', 'gasdev.bundle'],
    ['gasDevRelease', 'gasdev.release'],
    ['gasDevCi', 'gasdev.ci'],
  ])('rejects the legacy %s key', (legacy, replacement) => {
    const dir = createCleanProject('gas', { [legacy]: {} });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`"${legacy}"`);
    expect(result.stderr).toContain(`"${replacement}"`);
    expect(result.stderr).toContain('Migrating to 3.0');
  });

  it('fails on an unknown preset', () => {
    const dir = createCleanProject('gas', { gasdev: { preset: 'web' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown preset "web"');
  });

  it('writes nothing with --fix when the config is invalid', () => {
    const dir = createCleanProject('gas', {
      gasdev: { preset: 'bogus' },
    });
    const file = join(dir, '.gitignore');
    const before = readFileSync(file, 'utf8').replace('.worktrees/\n', '');
    writeFileSync(file, before);
    const result = run(dir, ['check', '--fix']);
    expect(result.status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('fails on an unknown gasdev key', () => {
    const dir = createCleanProject('gas', { gasdev: { presets: 'gas' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown "gasdev" key(s): presets');
    expect(result.stderr).toContain(
      '(expected: preset, loadOrder, peers, gasTest, html, bundle, release, ci)',
    );
  });

  it('accepts a gasdev.bundle object', () => {
    const dir = createCleanProject('gas', {
      gasdev: { bundle: { libraries: {} } },
    });
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('rejects a non-object gasdev.bundle', () => {
    const dir = createCleanProject('gas', { gasdev: { bundle: 'x' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.bundle" must be an object');
  });

  it('accepts a gasdev.release object', () => {
    const dir = createCleanProject('gas', {
      gasdev: { release: { githubRelease: true } },
    });
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('rejects a non-object gasdev.release', () => {
    const dir = createCleanProject('gas', { gasdev: { release: 'x' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.release" must be an object');
  });

  it('accepts a gasdev.ci object', () => {
    const dir = createCleanProject('gas', {
      gasdev: { ci: { title: 'App' } },
    });
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('rejects a non-object gasdev.ci', () => {
    const dir = createCleanProject('gas', { gasdev: { ci: 'x' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.ci" must be an object');
  });

  it('fails when package.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gasdev-check-'));
    dirs.push(dir);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json not found');
  });
});

describe('check (loadOrder and peers)', () => {
  /**
   * @param {Record<string, unknown>} gasdev
   * @param {'gas' | 'node'} [preset]
   * @param {string[]} [srcFiles] Files created under src/.
   */
  function make(gasdev, preset = 'gas', srcFiles = ['a.ts', 'lib/b.ts']) {
    const dir = createCleanProject(preset, { gasdev });
    for (const file of srcFiles) {
      mkdirSync(dirname(join(dir, 'src', file)), { recursive: true });
      writeFileSync(join(dir, 'src', file), '');
    }
    return dir;
  }

  it('passes with a valid loadOrder and peers', () => {
    const dir = make({
      loadOrder: ['a.ts', 'lib/b.ts'],
      peers: { 'gas-logger': '^1.2.0', 'gas.sheet_db': '>=1 <3' },
    });
    const result = run(dir, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('✓ Config check passed\n');
  });

  it('reports a listed file that does not exist as drift', () => {
    const dir = make({ loadOrder: ['a.ts', 'missing.ts'] });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'package.json\n  gasdev.loadOrder: src/missing.ts does not exist',
    );
    expect(result.stderr).toContain('1 issue(s) in 1 file(s)');
  });

  it.each([
    ['a non-array', 'a.ts', 'must be a non-empty array'],
    ['an empty array', [], 'must be a non-empty array'],
    ['a duplicate', ['a.ts', 'a.ts'], 'lists "a.ts" twice'],
    ['a declaration file', ['a.d.ts'], 'entry "a.d.ts" must be a .ts file'],
    ['a non-ts file', ['a.js'], 'entry "a.js" must be a .ts file'],
    ['an absolute path', ['/etc/a.ts'], 'entry "/etc/a.ts" must be relative'],
    ['a drive path', ['C:/a.ts'], 'entry "C:/a.ts" must be relative'],
    ['a backslash', ['lib\\b.ts'], 'entry "lib\\\\b.ts" must use "/"'],
    ['a parent segment', ['../a.ts'], 'entry "../a.ts" must not contain'],
    ['a dot segment', ['./a.ts'], 'entry "./a.ts" must not contain'],
    ['a non-string', ['a.ts', 1], 'entry 1 must be a non-empty string'],
    ['an empty string', [''], 'entry "" must be a non-empty string'],
  ])('rejects loadOrder with %s', (_name, loadOrder, message) => {
    const result = run(make({ loadOrder }), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json: "gasdev.loadOrder"');
    expect(result.stderr).toContain(message);
  });

  it.each([
    ['a non-object', ['gas-logger'], 'must be an object'],
    ['an uppercase name', { Gas: '1' }, 'invalid package name "Gas"'],
    ['a name with a slash', { 'a/b': '1' }, 'invalid package name "a/b"'],
    [
      'an empty range',
      { 'gas-logger': '' },
      '["gas-logger"] must be a non-empty',
    ],
    [
      'a non-string range',
      { 'gas-logger': 1 },
      '["gas-logger"] must be a non-empty',
    ],
  ])('rejects peers with %s', (_name, peers, message) => {
    const result = run(make({ peers }), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json: "gasdev.peers"');
    expect(result.stderr).toContain(message);
  });

  it.each([
    ['loadOrder', ['a.ts']],
    ['peers', { 'gas-logger': '^1.0.0' }],
  ])('rejects %s with the node preset', (key, value) => {
    const dir = make({ preset: 'node', [key]: value }, 'node');
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `package.json: "gasdev.${key}" requires the gas preset`,
    );
  });
});

describe('check (gasTest)', () => {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];

  /** @param {Record<string, unknown>} gasdev */
  function make(gasdev) {
    const dir = createCleanProject('gas', { gasdev });
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    return dir;
  }

  it('passes with valid scopes and an optional scriptId', () => {
    const dir = make({
      loadOrder: ['a.ts'],
      gasTest: { scopes, scriptId: 'abc' },
    });
    expect(run(dir, ['check']).status).toBe(0);
    const bare = make({ loadOrder: ['a.ts'], gasTest: { scopes } });
    expect(run(bare, ['check']).status).toBe(0);
  });

  it.each([
    ['a non-object', ['x'], 'must be an object'],
    ['an unknown key', { scopes, nope: 1 }, '"gasdev.gasTest.nope"'],
    ['missing scopes', {}, '.scopes must be a non-empty array'],
    ['empty scopes', { scopes: [] }, '.scopes must be a non-empty array'],
    [
      'a foreign scope',
      { scopes: ['https://x.test/auth/y'] },
      'must be a string starting with "https://www.googleapis.com/auth/"',
    ],
    ['a non-string scope', { scopes: [1] }, 'entry 1 must be a string'],
    [
      'a duplicate scope',
      { scopes: [...scopes, ...scopes] },
      'lists "https://www.googleapis.com/auth/spreadsheets" twice',
    ],
    [
      'an empty scriptId',
      { scopes, scriptId: ' ' },
      '.scriptId must be a non-empty string',
    ],
    [
      'a non-string scriptId',
      { scopes, scriptId: 1 },
      '.scriptId must be a non-empty string',
    ],
  ])('rejects gasTest with %s', (_name, gasTest, message) => {
    const result = run(make({ loadOrder: ['a.ts'], gasTest }), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  describe('scripts', () => {
    const config = { loadOrder: ['a.ts'], gasTest: { scopes } };

    /** @param {(scripts: Record<string, string>) => void} edit */
    function makeWith(edit) {
      const dir = make(config);
      const pkg = readPackage(dir);
      edit(pkg.scripts);
      writePackage(dir, pkg);
      return dir;
    }

    it('requires test:gas:build and test:gas when configured', () => {
      const dir = makeWith((scripts) => {
        delete scripts['test:gas:build'];
        delete scripts['test:gas'];
      });
      const result = run(dir, ['check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'scripts.test:gas:build is missing; expected: gasdev gas-test build',
      );
      expect(result.stderr).toContain(
        'scripts.test:gas is missing; expected: gasdev gas-test run',
      );
      expect(result.stderr).toContain('2 issue(s) in 1 file(s)');
    });

    it('reports a different value', () => {
      const dir = makeWith((scripts) => {
        scripts['test:gas'] = 'clasp run';
      });
      const result = run(dir, ['check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'scripts.test:gas differs; expected: gasdev gas-test run; found: "clasp run"',
      );
    });

    it('passes with the expected values', () => {
      expect(
        run(
          makeWith(() => {}),
          ['check'],
        ).status,
      ).toBe(0);
    });

    it('does not require the scripts without gasTest', () => {
      const dir = make({ loadOrder: ['a.ts'] });
      const scripts = readPackage(dir).scripts;
      expect(scripts['test:gas']).toBeUndefined();
      expect(run(dir, ['check']).status).toBe(0);
    });
  });

  it('requires loadOrder', () => {
    const result = run(make({ gasTest: { scopes } }), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '"gasdev.gasTest" requires "gasdev.loadOrder"',
    );
  });

  it('rejects gasTest with the node preset', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node', gasTest: { scopes } },
    });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.gasTest" requires the gas preset');
  });
});

describe('init', () => {
  const tpl = (/** @type {string} */ preset, /** @type {string} */ file) =>
    readFileSync(join(TEMPLATES, preset, file), 'utf8');
  const scriptsOf = (/** @type {string} */ preset) =>
    JSON.parse(tpl(preset, 'scripts.json'));

  /**
   * @param {'gas' | 'node'} preset
   * @param {Record<string, unknown>} [extra] Extra package.json fields.
   * @returns {string} Project directory containing only package.json.
   */
  function createEmptyProject(preset, extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gasdev-init-'));
    dirs.push(dir);
    writePackage(dir, {
      name: 'consumer',
      ...(preset === 'node' && { gasdev: { preset } }),
      ...extra,
    });
    return dir;
  }

  describe.each(['gas', 'node'])('%s preset', (preset) => {
    const p = /** @type {'gas' | 'node'} */ (preset);

    it('creates the files and adds every required script', () => {
      const dir = createEmptyProject(p);
      const result = run(dir, ['init']);
      for (const [file, template] of /** @type {[string, string][]} */ ([
        ['.gitignore', 'gitignore'],
        ['.prettierignore', 'prettierignore'],
        ['.github/dependabot.yml', '.github/dependabot.yml'],
      ])) {
        expect(readFileSync(join(dir, file), 'utf8')).toBe(
          tpl(preset, template),
        );
        expect(result.stdout).toContain(`${file}: created`);
      }
      const { required, present } = scriptsOf(preset);
      const placeholders = Object.fromEntries(
        present.map((/** @type {string} */ n) => [n, placeholderScript(n)]),
      );
      const pkg = readPackage(dir);
      expect(pkg.scripts).toEqual({ ...required, ...placeholders });
      expect(Object.keys(pkg.scripts)).toEqual([
        ...Object.keys(required),
        ...present,
      ]);
      for (const name of Object.keys(required)) {
        expect(result.stdout).toContain(`package.json: added scripts.${name}`);
      }
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toMatch(/\n$/);
      expect(result.status).toBe(0);
      const reported = result.stdout
        .split('\n')
        .filter((l) => l.startsWith('  '))
        .map((l) => l.trim());
      expect(reported).toEqual(
        present.map(
          (/** @type {string} */ n) =>
            `warning: scripts.${n} is a placeholder; replace it with the project's command`,
        ),
      );
    });

    it('keeps differing scripts and appends missing ones in order', () => {
      const dir = createEmptyProject(p, { scripts: { test: 'jest' } });
      const result = run(dir, ['init']);
      const { required, present } = scriptsOf(preset);
      const names = Object.keys(required);
      const pkg = readPackage(dir);
      expect(pkg.scripts.test).toBe('jest');
      expect(Object.keys(pkg.scripts)).toEqual([
        'test',
        ...names.filter((n) => n !== 'test'),
        ...present,
      ]);
      expect(result.stdout).not.toContain('added scripts.test\n');
      expect(result.stderr).toContain(
        `scripts.test differs; expected: ${required.test}; found: "jest"`,
      );
    });

    it('does not touch a differing dependabot.yml', () => {
      const dir = createEmptyProject(p);
      mkdirSync(join(dir, '.github'));
      const file = join(dir, '.github', 'dependabot.yml');
      writeFileSync(file, 'version: 2\n');
      const result = run(dir, ['init']);
      expect(readFileSync(file, 'utf8')).toBe('version: 2\n');
      expect(result.stdout).not.toContain('dependabot.yml: created');
      expect(result.stderr).toContain(
        `differs from the template templates/${preset}/.github/dependabot.yml`,
      );
    });

    it('appends missing ignore lines', () => {
      const dir = createEmptyProject(p);
      writeFileSync(join(dir, '.gitignore'), 'dist/\n');
      const result = run(dir, ['init']);
      expect(result.stdout).toContain('.gitignore: added node_modules/');
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(
        /^dist\/\n/,
      );
    });

    it('prints no changes and leaves package.json alone on a second run', () => {
      const dir = createEmptyProject(p);
      run(dir, ['init']);
      const before = readFileSync(join(dir, 'package.json'), 'utf8');
      writeFileSync(join(dir, 'package.json'), before.replace(/\n$/, ''));
      const result = run(dir, ['init']);
      expect(result.stdout).not.toMatch(/created|added/);
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(
        before.replace(/\n$/, ''),
      );
    });

    it('writes nothing when the config is invalid', () => {
      const dir = createEmptyProject(p, { gasdev: { preset: 'bogus' } });
      const before = readFileSync(join(dir, 'package.json'), 'utf8');
      const result = run(dir, ['init']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unknown preset "bogus"');
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
      expect(existsSync(join(dir, '.gitignore'))).toBe(false);
      expect(existsSync(join(dir, '.github'))).toBe(false);
    });
  });

  it('adds the gasTest scripts when gasTest is configured', () => {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    const dir = createEmptyProject('gas', {
      gasdev: { loadOrder: ['a.ts'], gasTest: { scopes } },
    });
    const result = run(dir, ['init']);
    const { gasTest } = scriptsOf('gas');
    const pkg = readPackage(dir);
    for (const [name, value] of Object.entries(gasTest)) {
      expect(pkg.scripts[name]).toBe(value);
      expect(result.stdout).toContain(`package.json: added scripts.${name}`);
    }
  });

  it('does not add the gasTest scripts without gasTest', () => {
    const dir = createEmptyProject('gas');
    run(dir, ['init']);
    const scripts = readPackage(dir).scripts;
    expect(scripts).not.toHaveProperty('test:gas');
    expect(scripts).not.toHaveProperty('test:gas:build');
  });

  it.each([
    ['"x"', 'x'],
    ['an array', ['x']],
  ])('exits 1 and writes nothing when scripts is %s', (_label, scripts) => {
    const dir = createEmptyProject('node', { scripts });
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    const result = run(dir, ['init']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.json: scripts must be an object');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
  });

  it.each([
    ['--fix', '--fix is only valid with check'],
    ['extra', 'unknown command: init extra'],
  ])('exits 2 on init %s', (arg, message) => {
    const dir = createEmptyProject('node');
    const result = run(dir, ['init', arg]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });
});

describe('CLI usage', () => {
  it('lists every validated gasdev key in help', () => {
    const result = run(REPO_ROOT, ['--help']);
    expect(result.stdout).toContain('"bundle", "release" and "ci"');
    expect(result.stdout).toContain('(gas preset only)');
  });

  it('exits 2 without a command', () => {
    const result = run(REPO_ROOT, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('missing command');
  });

  it('exits 2 on an unknown command', () => {
    const result = run(REPO_ROOT, ['sync']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown command: sync');
  });

  it('exits 2 on an unknown option', () => {
    const result = run(REPO_ROOT, ['check', '--bogus']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Run gasdev --help');
  });

  it('exits 2 when --fix is used without check', () => {
    const result = run(REPO_ROOT, ['html', '--fix']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      '--fix is only valid with check or github.',
    );
  });

  it('prints help', () => {
    const result = run(REPO_ROOT, ['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: gasdev check');
    expect(result.stdout).toContain('check [--fix]');
    expect(result.stdout).toContain('gasdev gas-test run [--keep]');
  });

  it('prints the version', () => {
    const { version } = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    const result = run(REPO_ROOT, ['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
  });
});
