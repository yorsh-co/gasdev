import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CheckError,
  chooseProjectType,
  initProject,
  placeholderScript,
} from '../bin/check.js';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');
const TEMPLATES = join(REPO_ROOT, 'templates');
const GASDEV_NODE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
).engines.node;

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
  const { required, library, present, gasTest } = JSON.parse(
    read('scripts.json'),
  );
  const configured = /** @type {any} */ (pkgExtra.gasdev)?.gasTest;
  const projectType = /** @type {any} */ (pkgExtra.gasdev)?.type;
  const scripts = {
    ...required,
    ...((projectType === undefined || projectType === 'library') && library),
    ...(configured && gasTest),
  };
  for (const name of present) scripts[name] = 'true';
  const { type, prettier, overrides } = JSON.parse(read('package.json'));
  writePackage(dir, {
    name: 'consumer',
    type,
    prettier,
    engines: { node: GASDEV_NODE },
    overrides,
    scripts,
    ...pkgExtra,
  });
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

    it('adds missing type, engines and overrides', () => {
      const dir = make();
      const pkg = readPackage(dir);
      delete pkg.type;
      delete pkg.engines;
      delete pkg.overrides;
      writePackage(dir, pkg);
      const result = run(dir, ['check', '--fix']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('package.json: added type');
      expect(result.stdout).toContain('package.json: added engines.node');
      expect(result.stdout).toContain(
        'package.json: added overrides.minimatch',
      );
      const fixed = readPackage(dir);
      expect(fixed.type).toBe('module');
      expect(fixed.engines).toEqual({ node: GASDEV_NODE });
      expect(fixed.overrides).toEqual({ minimatch: '^11.0.1' });
      expect(run(dir, ['check']).status).toBe(0);
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

describe.each(['gas', 'node'])(
  'check (package fields, %s preset)',
  (preset) => {
    const make = (/** @type {Record<string, unknown>} */ extra = {}) =>
      createCleanProject(/** @type {'gas' | 'node'} */ (preset), {
        ...(preset === 'node' && { gasdev: { preset } }),
        ...extra,
      });
    const drift = (/** @type {string} */ dir) => run(dir, ['check']).stderr;

    it.each(['type', 'prettier'])('reports a missing %s', (key) => {
      const dir = make({ [key]: undefined });
      expect(drift(dir)).toContain(`${key} is missing`);
    });

    it.each([
      ['type', 'commonjs'],
      ['prettier', { semi: false }],
    ])('reports a differing %s', (key, value) => {
      const dir = make({ [key]: value });
      expect(drift(dir)).toContain(`${key} differs`);
    });

    it('reports a missing engines.node', () => {
      const dir = make({ engines: undefined });
      expect(drift(dir)).toContain('engines.node is missing');
    });

    it('accepts a subset of the gasdev range', () => {
      const dir = make({ engines: { node: '^24.0.0' } });
      expect(run(dir, ['check']).status).toBe(0);
    });

    it.each(['>=20', 'not a range', 24])('reports engines.node %s', (node) => {
      const dir = make({ engines: { node } });
      expect(drift(dir)).toContain(
        `engines.node ${JSON.stringify(node)} is not within gasdev's`,
      );
    });

    it('reports engines that is not an object', () => {
      const dir = make({ engines: '>=22' });
      const output = drift(dir);
      expect(output).toContain('engines must be an object');
      expect(output).not.toContain('engines.node is missing');
    });

    it('exempts gasdev itself from prettier', () => {
      const dir = make({ name: 'gasdev', prettier: undefined });
      expect(drift(dir)).not.toContain('prettier');
    });

    it('reports a missing override', () => {
      const dir = make({ overrides: undefined });
      expect(drift(dir)).toContain(
        'overrides.minimatch is missing; expected: "^11.0.1"',
      );
    });

    it('reports a differing override', () => {
      const dir = make({ overrides: { minimatch: '^10.0.0' } });
      expect(drift(dir)).toContain('overrides.minimatch differs');
    });

    it('reports overrides that is not an object', () => {
      const dir = make({ overrides: 'x' });
      expect(drift(dir)).toContain('overrides must be an object');
    });

    it('ignores extra overrides', () => {
      const dir = make({ overrides: { minimatch: '^11.0.1', extra: '1.0.0' } });
      expect(run(dir, ['check']).status).toBe(0);
    });

    it('requires the clasp overrides only with @google/clasp', () => {
      const without = make();
      expect(drift(without)).not.toContain('gaxios');
      for (const key of ['dependencies', 'devDependencies']) {
        const dir = make({ [key]: { '@google/clasp': '^3.0.0' } });
        expect(drift(dir)).toContain('overrides.gaxios is missing');
        writePackage(dir, {
          ...readPackage(dir),
          overrides: { minimatch: '^11.0.1', gaxios: '^7.3.1' },
        });
        expect(run(dir, ['check']).status).toBe(0);
      }
    });
  },
);

describe('gasdev overrides', () => {
  it("equal the node template's merged overrides", () => {
    const own = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ).overrides;
    const template = JSON.parse(
      readFileSync(join(TEMPLATES, 'node', 'package.json'), 'utf8'),
    );
    expect(own).toEqual({
      ...template.overrides,
      ...template.claspOverrides,
    });
  });
});

describe('check (clean script)', () => {
  it('warns about the legacy rimraf clean script without failing', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    pkg.scripts.clean = 'rimraf dist';
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'warning: scripts.clean uses rimraf; change it to "gasdev clean", then run npm uninstall rimraf',
    );
  });

  it('does not warn when clean is gasdev clean', () => {
    const result = run(createCleanProject('gas'), ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('rimraf');
  });

  it('reports any other clean value as drift', () => {
    const dir = createCleanProject('gas');
    const pkg = readPackage(dir);
    pkg.scripts.clean = 'rm -rf dist';
    writePackage(dir, pkg);
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'scripts.clean differs; expected: gasdev clean; found: "rm -rf dist"',
    );
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
      '(expected: preset, type, loadOrder, peers, gasTest, html, bundle, release, ci)',
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
  const scriptsOf = (/** @type {string} */ preset) => {
    const template = JSON.parse(tpl(preset, 'scripts.json'));
    const { library, ...rest } = template;
    // A project without gasdev.type is treated as a library.
    return { ...rest, required: { ...rest.required, ...library } };
  };

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
      expect(pkg.type).toBe('module');
      expect(pkg.prettier).toBe('gasdev/prettier');
      expect(pkg.engines).toEqual({ node: GASDEV_NODE });
      expect(Object.keys(pkg).slice(-5)).toEqual([
        'scripts',
        'type',
        'prettier',
        'engines',
        'overrides',
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

    it('keeps existing fields and other engines keys', () => {
      const dir = createEmptyProject(p, {
        type: 'commonjs',
        prettier: { semi: false },
        engines: { npm: '>=10' },
      });
      run(dir, ['init']);
      const pkg = readPackage(dir);
      expect(pkg.type).toBe('commonjs');
      expect(pkg.prettier).toEqual({ semi: false });
      expect(pkg.engines).toEqual({ npm: '>=10', node: GASDEV_NODE });
    });

    it('does not add prettier to gasdev itself', () => {
      const dir = createEmptyProject(p, { name: 'gasdev' });
      run(dir, ['init']);
      expect(readPackage(dir).prettier).toBeUndefined();
    });

    it('keeps a non-string engines.node', () => {
      const dir = createEmptyProject(p, { engines: { node: 24 } });
      run(dir, ['init']);
      expect(readPackage(dir).engines).toEqual({ node: 24 });
    });

    it('keeps an existing engines.node', () => {
      const dir = createEmptyProject(p, { engines: { node: '^24.0.0' } });
      const result = run(dir, ['init']);
      expect(readPackage(dir).engines).toEqual({ node: '^24.0.0' });
      expect(result.stdout).not.toContain('engines.node');
    });

    it('adds the overrides, with clasp ones only when clasp is installed', () => {
      const plain = createEmptyProject(p);
      const result = run(plain, ['init']);
      expect(readPackage(plain).overrides).toEqual({ minimatch: '^11.0.1' });
      expect(result.stdout).toContain(
        'package.json: added overrides.minimatch; run npm install to apply it',
      );
      const clasp = createEmptyProject(p, {
        devDependencies: { '@google/clasp': '^3.0.0' },
      });
      run(clasp, ['init']);
      expect(readPackage(clasp).overrides).toEqual({
        minimatch: '^11.0.1',
        gaxios: '^7.3.1',
      });
    });

    it('keeps a differing override and extra ones', () => {
      const dir = createEmptyProject(p, {
        overrides: { minimatch: '^10.0.0', extra: '1.0.0' },
      });
      const result = run(dir, ['init']);
      expect(readPackage(dir).overrides).toEqual({
        minimatch: '^10.0.0',
        extra: '1.0.0',
      });
      expect(result.stdout).not.toContain('overrides');
      expect(result.stderr).toContain('overrides.minimatch differs');
    });

    it('writes nothing when overrides is invalid', () => {
      const dir = createEmptyProject(p, { overrides: 'x' });
      const before = readFileSync(join(dir, 'package.json'), 'utf8');
      const result = run(dir, ['init']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'package.json: overrides must be an object',
      );
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
      expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    });

    it('writes nothing when engines is invalid', () => {
      const dir = createEmptyProject(p, { engines: '>=22' });
      const before = readFileSync(join(dir, 'package.json'), 'utf8');
      const result = run(dir, ['init']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'package.json: engines must be an object',
      );
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before);
      expect(existsSync(join(dir, '.gitignore'))).toBe(false);
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

describe('gasdev.type', () => {
  /**
   * @param {Record<string, unknown>} [extra]
   * @returns {string}
   */
  function emptyProject(extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gasdev-type-'));
    dirs.push(dir);
    writePackage(dir, { name: 'consumer', ...extra });
    return dir;
  }

  it('rejects an unknown type', () => {
    const dir = createCleanProject('gas', { gasdev: { type: 'lib' } });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'unknown type "lib" (expected: library, app, webapp)',
    );
  });

  it('rejects a type with the node preset', () => {
    const dir = createCleanProject('node', {
      gasdev: { preset: 'node', type: 'app' },
    });
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.type" requires the gas preset');
  });

  it.each(['library', 'app', 'webapp'])('accepts %s', (type) => {
    const dir = createCleanProject('gas', { gasdev: { type } });
    expect(run(dir, ['check']).status).toBe(0);
  });

  describe('chooseProjectType', () => {
    it('returns the chosen type', async () => {
      const prompt = async () => ({ type: 'webapp' });
      expect(await chooseProjectType(prompt)).toBe('webapp');
    });

    it('throws when cancelled', async () => {
      await expect(chooseProjectType(async () => ({}))).rejects.toThrow(
        new CheckError('init cancelled'),
      );
    });
  });

  describe('initProject with a type', () => {
    it('persists it once and not again on rerun', () => {
      const dir = emptyProject();
      const first = initProject(dir, { type: 'app' });
      expect(first).toContain('package.json: set gasdev.type to "app"');
      expect(readPackage(dir).gasdev).toEqual({ type: 'app' });
      expect(initProject(dir, { type: 'app' })).toEqual([]);
    });

    it('keeps other gasdev keys', () => {
      const dir = emptyProject({ gasdev: { loadOrder: ['a.ts'] } });
      initProject(dir, { type: 'library' });
      expect(readPackage(dir).gasdev).toEqual({
        loadOrder: ['a.ts'],
        type: 'library',
      });
    });

    it('does not override a configured type', () => {
      const dir = emptyProject({ gasdev: { type: 'app' } });
      initProject(dir, { type: 'library' });
      expect(readPackage(dir).gasdev.type).toBe('app');
      const scripts = readPackage(dir).scripts ?? {};
      expect(scripts).not.toHaveProperty('release');
      expect(scripts).not.toHaveProperty('build:release');
    });

    it('writes nothing when the passed type is invalid', () => {
      const dir = emptyProject();
      const before = readdirSync(dir).sort();
      const pkgBefore = readFileSync(join(dir, 'package.json'), 'utf8');
      expect(() => initProject(dir, { type: 'bogus' })).toThrow(CheckError);
      expect(readdirSync(dir).sort()).toEqual(before);
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(pkgBefore);
    });
  });

  describe('type-driven files', () => {
    const templateFile = (/** @type {string} */ f) =>
      readFileSync(join(TEMPLATES, 'gas', 'files', f), 'utf8');
    const ALL = [
      'tsconfig.json',
      'tsconfig.test.json',
      'eslint.config.js',
      'tsconfig.frontend.json',
      'gas-test/tsconfig.json',
    ];
    const created = (/** @type {string} */ dir) =>
      ALL.filter((f) => existsSync(join(dir, f)));

    it.each([
      ['library', ['tsconfig.json', 'tsconfig.test.json', 'eslint.config.js']],
      ['app', ['tsconfig.json', 'tsconfig.test.json', 'eslint.config.js']],
      [
        'webapp',
        [
          'tsconfig.json',
          'tsconfig.test.json',
          'eslint.config.js',
          'tsconfig.frontend.json',
        ],
      ],
    ])('init creates the %s file set from the templates', (type, expected) => {
      const dir = emptyProject({ gasdev: { type } });
      const messages = initProject(dir, { init: true });
      expect(created(dir).sort()).toEqual([...expected].sort());
      for (const file of expected) {
        expect(messages).toContain(`${file}: created`);
        const template =
          type === 'webapp' && file === 'eslint.config.js'
            ? 'eslint.webapp.config.js'
            : file;
        expect(readFileSync(join(dir, file), 'utf8')).toBe(
          templateFile(template),
        );
        if (file.endsWith('.json')) {
          expect(() =>
            JSON.parse(readFileSync(join(dir, file), 'utf8')),
          ).not.toThrow();
        }
      }
      expect(initProject(dir, { init: true })).toEqual([]);
    });

    it('creates the chosen type files and gas-test/tsconfig.json when configured', () => {
      const dir = emptyProject({
        gasdev: {
          loadOrder: ['a.ts'],
          gasTest: { scopes: ['https://www.googleapis.com/auth/drive'] },
        },
      });
      const messages = initProject(dir, { type: 'app', init: true });
      expect(messages).toContain('gas-test/tsconfig.json: created');
      expect(existsSync(join(dir, 'gas-test', 'tsconfig.json'))).toBe(true);
    });

    it('leaves existing files untouched', () => {
      const dir = emptyProject({ gasdev: { type: 'app' } });
      writeFileSync(join(dir, 'tsconfig.json'), '{ "mine": true }\n');
      const messages = initProject(dir, { init: true });
      expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toBe(
        '{ "mine": true }\n',
      );
      expect(messages).not.toContain('tsconfig.json: created');
      expect(messages).toContain('tsconfig.test.json: created');
    });

    it('creates nothing without init, or without a known type', () => {
      const dir = emptyProject({ gasdev: { type: 'webapp' } });
      initProject(dir);
      expect(created(dir)).toEqual([]);
      const untyped = emptyProject();
      initProject(untyped, { init: true });
      expect(created(untyped)).toEqual([]);
    });

    it('check --fix creates none of them', () => {
      const dir = emptyProject({ gasdev: { type: 'webapp' } });
      run(dir, ['check', '--fix']);
      expect(created(dir)).toEqual([]);
    });

    it('the init command creates them', () => {
      const dir = emptyProject({ gasdev: { type: 'webapp' } });
      run(dir, ['init']);
      expect(existsSync(join(dir, 'tsconfig.frontend.json'))).toBe(true);
    });
  });

  describe('release scripts', () => {
    const pkgWithScript = (
      /** @type {string} */ dir,
      /** @type {string} */ name,
      /** @type {string} */ value,
    ) => {
      const pkg = readPackage(dir);
      pkg.scripts[name] = value;
      writePackage(dir, pkg);
    };
    const RELEASE = ['release', 'build:release'];
    const withoutRelease = (/** @type {string} */ type) => {
      const dir = createCleanProject('gas', { gasdev: { type } });
      const pkg = readPackage(dir);
      for (const name of RELEASE) delete pkg.scripts[name];
      writePackage(dir, pkg);
      return dir;
    };

    it.each(['library', undefined])('requires them for type %s', (type) => {
      const dir = withoutRelease('library');
      if (type === undefined) {
        const pkg = readPackage(dir);
        delete pkg.gasdev;
        writePackage(dir, pkg);
      }
      const result = run(dir, ['check']);
      expect(result.status).toBe(1);
      for (const name of RELEASE) {
        expect(result.stderr).toContain(`scripts.${name} is missing`);
      }
      initProject(dir);
      expect(Object.keys(readPackage(dir).scripts)).toEqual(
        expect.arrayContaining(RELEASE),
      );
    });

    it.each(['app', 'webapp'])(
      'does not require or add them for %s',
      (type) => {
        const dir = withoutRelease(type);
        expect(run(dir, ['check']).status).toBe(0);
        initProject(dir);
        const scripts = readPackage(dir).scripts;
        for (const name of RELEASE) expect(scripts[name]).toBeUndefined();
      },
    );

    it('leaves an existing release script in an app alone', () => {
      const dir = createCleanProject('gas', { gasdev: { type: 'app' } });
      pkgWithScript(dir, 'release', 'echo custom');
      expect(run(dir, ['check']).status).toBe(0);
    });

    it('does not affect the node preset', () => {
      const dir = createCleanProject('node', {
        gasdev: { preset: 'node' },
      });
      expect(run(dir, ['check']).status).toBe(0);
    });
  });

  describe('clasp and manifest templates', () => {
    const NAMES = ['.clasp.example.json', 'appsscript.example.json'];
    const present = (/** @type {string} */ dir) =>
      NAMES.filter((f) => existsSync(join(dir, f)));

    it.each([
      ['app', NAMES],
      ['webapp', NAMES],
      ['library', []],
    ])('init creates them for %s: %j', (type, expected) => {
      const dir = emptyProject({ gasdev: { type } });
      const messages = initProject(dir, { init: true });
      expect(present(dir)).toEqual(expected);
      for (const f of expected) {
        expect(messages).toContain(
          f === 'appsscript.example.json'
            ? `${f}: created; set oauthScopes in ${f}`
            : `${f}: created`,
        );
      }
    });

    it('webapp manifest is least-privileged, app has no webapp block', () => {
      const web = emptyProject({ gasdev: { type: 'webapp' } });
      initProject(web, { init: true });
      expect(
        JSON.parse(readFileSync(join(web, 'appsscript.example.json'), 'utf8'))
          .webapp,
      ).toEqual({ executeAs: 'USER_DEPLOYING', access: 'MYSELF' });
      const app = emptyProject({ gasdev: { type: 'app' } });
      initProject(app, { init: true });
      expect(
        JSON.parse(readFileSync(join(app, 'appsscript.example.json'), 'utf8')),
      ).not.toHaveProperty('webapp');
    });

    it('leaves existing files untouched and is skipped without init', () => {
      const dir = emptyProject({ gasdev: { type: 'app' } });
      initProject(dir);
      expect(present(dir)).toEqual([]);
      writeFileSync(join(dir, '.clasp.example.json'), '{ "mine": true }\n');
      initProject(dir, { init: true });
      expect(readFileSync(join(dir, '.clasp.example.json'), 'utf8')).toBe(
        '{ "mine": true }\n',
      );
      expect(present(dir)).toEqual(NAMES);
    });
  });

  describe('deploy workflow', () => {
    const FILE = '.github/workflows/deploy.yml';
    const version = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ).version;

    it.each(['app', 'webapp'])('init creates it for %s', (type) => {
      const dir = emptyProject({ gasdev: { type } });
      const messages = initProject(dir, { init: true });
      expect(messages).toContain(
        `${FILE}: created; add the dev and live environments (see "CI deployment" in the README)`,
      );
      const text = readFileSync(join(dir, FILE), 'utf8');
      const template = readFileSync(
        join(REPO_ROOT, 'templates/gas/files', FILE),
        'utf8',
      );
      expect(text).not.toContain('{{GASDEV_VERSION}}');
      expect(text).toBe(template.replaceAll('{{GASDEV_VERSION}}', version));
    });

    it('does not create it for a library or without init', () => {
      const lib = emptyProject({ gasdev: { type: 'library' } });
      initProject(lib, { init: true });
      expect(existsSync(join(lib, FILE))).toBe(false);
      const app = emptyProject({ gasdev: { type: 'app' } });
      initProject(app);
      expect(existsSync(join(app, FILE))).toBe(false);
    });

    it('leaves an existing file untouched', () => {
      const dir = emptyProject({ gasdev: { type: 'app' } });
      mkdirSync(join(dir, '.github/workflows'), { recursive: true });
      writeFileSync(join(dir, FILE), 'mine\n');
      initProject(dir, { init: true });
      expect(readFileSync(join(dir, FILE), 'utf8')).toBe('mine\n');
    });

    describe('gitea platform', () => {
      const GITEA = '.gitea/workflows/deploy.yml';
      const template = readFileSync(
        join(REPO_ROOT, 'templates/gas/files', GITEA),
        'utf8',
      );
      const gitea = (type = 'app') => ({
        gasdev: { type, ci: { platform: 'gitea' } },
      });

      it.each(['app', 'webapp'])('init creates it for %s', (type) => {
        const dir = emptyProject(gitea(type));
        const messages = initProject(dir, { init: true });
        expect(messages).toContain(
          `${GITEA}: created; add the dev and live secrets and variables (see "Deploy from Gitea" in the README)`,
        );
        expect(readFileSync(join(dir, GITEA), 'utf8')).toBe(template);
        expect(existsSync(join(dir, FILE))).toBe(false);
      });

      it('platform github creates the GitHub file', () => {
        const dir = emptyProject({
          gasdev: { type: 'app', ci: { platform: 'github' } },
        });
        const messages = initProject(dir, { init: true });
        const github = readFileSync(
          join(REPO_ROOT, 'templates/gas/files', FILE),
          'utf8',
        ).replaceAll('{{GASDEV_VERSION}}', version);
        expect(messages).toContain(
          `${FILE}: created; add the dev and live environments (see "CI deployment" in the README)`,
        );
        expect(readFileSync(join(dir, FILE), 'utf8')).toBe(github);
        expect(existsSync(join(dir, GITEA))).toBe(false);
      });

      it('does not create it for a library or without init', () => {
        const lib = emptyProject(gitea('library'));
        initProject(lib, { init: true });
        expect(existsSync(join(lib, GITEA))).toBe(false);
        const app = emptyProject(gitea());
        initProject(app);
        expect(existsSync(join(app, GITEA))).toBe(false);
      });

      it('leaves an existing file untouched', () => {
        const dir = emptyProject(gitea());
        mkdirSync(join(dir, '.gitea/workflows'), { recursive: true });
        writeFileSync(join(dir, GITEA), 'mine\n');
        initProject(dir, { init: true });
        expect(readFileSync(join(dir, GITEA), 'utf8')).toBe('mine\n');
      });

      it('adds the gitea file next to an existing github one', () => {
        const dir = emptyProject(gitea());
        mkdirSync(join(dir, '.github/workflows'), { recursive: true });
        writeFileSync(join(dir, FILE), 'mine\n');
        const messages = initProject(dir, { init: true });
        expect(readFileSync(join(dir, FILE), 'utf8')).toBe('mine\n');
        expect(readFileSync(join(dir, GITEA), 'utf8')).toBe(template);
        expect(messages).toContain(
          `${GITEA}: created; add the dev and live secrets and variables (see "Deploy from Gitea" in the README)`,
        );
      });

      it.each(['gitlab', 1, null])('rejects platform %j', (platform) => {
        const dir = emptyProject({
          gasdev: { type: 'app', ci: { platform } },
        });
        const message = `package.json: unknown ci platform ${JSON.stringify(platform)} (expected: github, gitea)`;
        expect(() => initProject(dir, { init: true })).toThrow(message);
        const result = run(dir, ['check']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(message);
      });

      it('template has per-target secrets, no fallthrough and explicit GITHUB_ACTIONS', () => {
        expect(template).not.toContain('{{GASDEV_VERSION}}');
        for (const name of [
          'CLASPRC_JSON_DEV',
          'CLASPRC_JSON_LIVE',
          'GAS_SCRIPT_ID_DEV',
          'GAS_SCRIPT_ID_LIVE',
          'GAS_DEPLOYMENT_ID_DEV',
          'GAS_DEPLOYMENT_ID_LIVE',
        ]) {
          expect(template).toContain(name);
        }
        expect(template).not.toContain(' || ');
        expect(template.match(/GITHUB_ACTIONS: 'true'/g)).toHaveLength(2);
      });

      it('each deploy step uses only its own target names', () => {
        const steps = template.split('\n      - ');
        const stepFor = (/** @type {string} */ branch) =>
          steps.filter((step) =>
            step.includes(`if: github.ref_name == '${branch}'`),
          );
        const dev = stepFor('develop');
        const live = stepFor('main');
        expect(dev).toHaveLength(1);
        expect(live).toHaveLength(1);
        for (const name of [
          'CLASPRC_JSON_DEV',
          'GAS_SCRIPT_ID_DEV',
          'GAS_DEPLOYMENT_ID_DEV',
        ]) {
          expect(dev[0]).toContain(name);
        }
        expect(dev[0]).not.toContain('_LIVE');
        for (const name of [
          'CLASPRC_JSON_LIVE',
          'GAS_SCRIPT_ID_LIVE',
          'GAS_DEPLOYMENT_ID_LIVE',
        ]) {
          expect(live[0]).toContain(name);
        }
        expect(live[0]).not.toContain('_DEV');
      });
    });
  });

  it('init without a TTY prints the note and still runs the rest', () => {
    const dir = emptyProject();
    const result = run(dir, ['init']);
    expect(result.stdout).toContain(
      'gasdev.type is not set; set it in package.json (library, app or webapp) and rerun init',
    );
    expect(readPackage(dir).gasdev).toBeUndefined();
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
  });

  it('init with a configured type prints no note', () => {
    const dir = emptyProject({ gasdev: { type: 'app' } });
    expect(run(dir, ['init']).stdout).not.toContain('gasdev.type is not set');
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

describe('check (peer declaration version)', () => {
  const FILE = 'peer/gas-lib.peer.types.d.ts';

  /**
   * @param {string | undefined} header File content, or `undefined` for no file.
   * @param {Record<string, unknown>} [pkgExtra]
   */
  const make = (header, pkgExtra = { name: 'gas-lib', version: '1.2.0' }) => {
    const dir = createCleanProject('gas', pkgExtra);
    if (header !== undefined) {
      mkdirSync(join(dir, 'peer'));
      writeFileSync(join(dir, FILE), header);
    }
    return dir;
  };
  const header = (/** @type {string} */ v) =>
    `/**\n * @version ${v}\n */\nexport {};\n`;

  it('passes when the header matches package.json', () => {
    expect(run(make(header('1.2.0')), ['check']).status).toBe(0);
  });

  it('fails when the header differs', () => {
    const result = run(make(header('1.1.0')), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(FILE);
    expect(result.stderr).toContain(
      '@version 1.1.0 differs from package.json version 1.2.0',
    );
  });

  it('fails when the header has no @version tag', () => {
    const result = run(make('export {};\n'), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(FILE);
    expect(result.stderr).toContain(
      'has no @version tag; expected: @version 1.2.0',
    );
  });

  it('passes when the file is absent', () => {
    expect(run(make(undefined), ['check']).status).toBe(0);
  });

  it('reports no peer drift when the package has no version', () => {
    const dir = make(header('0.0.1'), { name: 'gas-lib' });
    const result = run(dir, ['check']);
    expect(result.stderr).not.toContain(FILE);
    expect(result.stderr).not.toContain('undefined');
  });

  it('is not fixed by --fix', () => {
    const dir = make(header('1.1.0'));
    const result = run(dir, ['check', '--fix']);
    expect(result.status).toBe(1);
    expect(readFileSync(join(dir, FILE), 'utf8')).toBe(header('1.1.0'));
  });
});

describe('check (gas-deploy workflow ref)', () => {
  const VERSION = JSON.parse(
    readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
  ).version;
  const MAJOR = semver.major(VERSION);
  const WF = '.github/workflows/deploy.yml';
  const workflow = (/** @type {string} */ ref, eol = '\n') =>
    [
      'name: Deploy',
      'jobs:',
      '  deploy:',
      `    uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@${ref} # pinned`,
      '    secrets: inherit',
      '',
    ].join(eol);
  const make = (
    /** @type {string | undefined} */ content,
    /** @type {Record<string, unknown>} */ extra = {},
  ) => {
    const dir = createCleanProject('gas', extra);
    if (content !== undefined) {
      mkdirSync(join(dir, '.github', 'workflows'));
      writeFileSync(join(dir, WF), content);
    }
    return dir;
  };

  it('passes when the ref matches the installed version', () => {
    expect(run(make(workflow(`v${VERSION}`)), ['check']).status).toBe(0);
  });

  it('passes without a workflows directory', () => {
    expect(run(make(undefined), ['check']).status).toBe(0);
  });

  it('reports an older ref and check --fix rewrites only the version', () => {
    const dir = make(workflow('v0.0.1'));
    const result = run(dir, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(WF);
    expect(result.stderr).toContain(
      `uses gas-deploy.yml@v0.0.1; installed gasdev is ${VERSION}`,
    );
    const fixed = run(dir, ['check', '--fix']);
    expect(fixed.stdout).toContain(
      `${WF}: gas-deploy.yml ref updated to v${VERSION}`,
    );
    expect(fixed.status).toBe(0);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow(`v${VERSION}`));
  });

  it('warns on an older ref in the same major and --fix rewrites it', () => {
    const ref = `v${MAJOR}.0.0-alpha.0`;
    const dir = make(workflow(ref));
    const result = run(dir, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `warning: uses gas-deploy.yml@${ref}; installed gasdev is ${VERSION}`,
    );
    expect(result.stdout).toContain('with 1 warning(s)');
    const fixed = run(dir, ['check', '--fix']);
    expect(fixed.status).toBe(0);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow(`v${VERSION}`));
  });

  it.skipIf(semver.minor(VERSION) === 0 && semver.patch(VERSION) === 0)(
    'warns on an older stable ref in the same major',
    () => {
      const ref = `v${MAJOR}.0.0`;
      const result = run(make(workflow(ref)), ['check']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        `warning: uses gas-deploy.yml@${ref}; installed gasdev is ${VERSION}`,
      );
      expect(result.stdout).toContain('with 1 warning(s)');
    },
  );

  it('fails on a newer ref in the same major', () => {
    const ref = `v${MAJOR}.999.0`;
    const result = run(make(workflow(ref)), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`uses gas-deploy.yml@${ref}`);
    expect(result.stderr).not.toContain(`warning: uses gas-deploy.yml@${ref}`);
  });

  it('reports a downgrade when fixing a newer ref', () => {
    const dir = make(workflow(`v${MAJOR}.999.0`));
    const result = run(dir, ['check', '--fix']);
    expect(result.stdout).toContain(
      `gas-deploy.yml ref downgraded to v${VERSION}`,
    );
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow(`v${VERSION}`));
  });

  it('preserves CRLF line endings when fixing', () => {
    const dir = make(workflow('v0.0.1', '\r\n'));
    run(dir, ['check', '--fix']);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(
      workflow(`v${VERSION}`, '\r\n'),
    );
  });

  it('reports a branch ref without rewriting it', () => {
    const dir = make(workflow('main'));
    const result = run(dir, ['check', '--fix']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `uses gas-deploy.yml@main; pin it to v${VERSION}`,
    );
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow('main'));
  });

  it('skips gasdev itself', () => {
    const dir = make(workflow('v0.0.1'));
    const pkg = readPackage(dir);
    writePackage(dir, {
      ...pkg,
      name: 'gasdev',
      scripts: {
        ...pkg['scripts'],
        check:
          'npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && node bin/gasdev.js check',
        'test:coverage': 'true',
      },
    });
    const result = run(dir, ['check']);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('gas-deploy.yml');
    run(dir, ['check', '--fix']);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow('v0.0.1'));
  });

  it('treats a prerelease ref as a version ref', () => {
    const dir = make(workflow('v0.0.1-beta.1'));
    const result = run(dir, ['check']);
    expect(result.stderr).toContain(
      `uses gas-deploy.yml@v0.0.1-beta.1; installed gasdev is ${VERSION}`,
    );
    run(dir, ['check', '--fix']);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(workflow(`v${VERSION}`));
    expect(run(dir, ['check']).status).toBe(0);
  });

  it('reports and fixes a quoted ref keeping the quotes', () => {
    const quoted = (/** @type {string} */ ref) =>
      workflow(ref)
        .replace(/@(\S+) #/, `@$1" #`)
        .replace('uses: ', 'uses: "');
    const dir = make(quoted('v0.0.1'));
    expect(run(dir, ['check']).stderr).toContain(
      `uses gas-deploy.yml@v0.0.1; installed gasdev is ${VERSION}`,
    );
    run(dir, ['check', '--fix']);
    expect(readFileSync(join(dir, WF), 'utf8')).toBe(quoted(`v${VERSION}`));
  });

  it('handles .yaml files with several stale refs', () => {
    const dir = make(undefined);
    mkdirSync(join(dir, '.github', 'workflows'));
    const file = join(dir, '.github', 'workflows', 'ci.yaml');
    const job = (/** @type {string} */ n, /** @type {string} */ ref) =>
      `  ${n}:\n    uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@${ref}\n`;
    writeFileSync(file, `jobs:\n${job('a', 'v0.0.1')}${job('b', 'v0.0.2')}`);
    const result = run(dir, ['check']);
    expect(result.stderr.match(/installed gasdev is/g)).toHaveLength(2);
    run(dir, ['check', '--fix']);
    expect(readFileSync(file, 'utf8')).toBe(
      `jobs:\n${job('a', `v${VERSION}`)}${job('b', `v${VERSION}`)}`,
    );
  });
});
