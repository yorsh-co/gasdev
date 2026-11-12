// @ts-check
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE_GH = fileURLToPath(new URL('./fake-gh.js', import.meta.url));

const BIN = fileURLToPath(new URL('../../../bin/gasdev.js', import.meta.url));

/** @type {string[]} */
const sandboxes = [];

/**
 * Runs git and returns its trimmed stdout.
 *
 * @param {string} cwd
 * @param {...string} args
 * @returns {string}
 */
export function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Writes files (path -> content) below a directory.
 *
 * @param {string} root
 * @param {Record<string, string>} files
 */
export function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/**
 * @param {string} root
 * @param {string} name
 */
function configureUser(root, name = 'Test') {
  git(root, 'config', 'user.name', name);
  git(root, 'config', 'user.email', 'test@example.com');
}

/**
 * Creates a project repo with a bare `origin`, a built `dist/` and the `v1.0.0` tag.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.config] The `gasdev.release` package.json value.
 * @param {Record<string, unknown>} [options.pkg] Extra package.json fields, e.g. `gasdev`.
 * @param {string} [options.gitignore] Content of `.gitignore`.
 * @param {Record<string, string>} [options.files] Extra tracked files (path -> content).
 * @param {(root: string) => void} [options.build] Writes the initial build output.
 * @returns {{ root: string, origin: string, sandbox: string }}
 */
export function createProject({
  config,
  pkg = {},
  gitignore = 'dist/\n.worktrees/\n',
  files = {},
  build = (dir) => writeBuild(dir, 'one'),
} = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'gasdev-release-'));
  sandboxes.push(sandbox);
  const origin = join(sandbox, 'origin.git');
  const root = join(sandbox, 'project');
  git(sandbox, 'init', '--bare', '-b', 'main', origin);
  mkdirSync(root);
  git(root, 'init', '-b', 'main');
  configureUser(root);
  git(root, 'remote', 'add', 'origin', origin);

  writeFiles(root, {
    '.gitignore': gitignore,
    'README.md': '# lib\n',
    'LICENSE.md': 'MIT\n',
    'CHANGELOG.md': '# Changelog\n',
    'package.json': `${JSON.stringify(
      {
        name: 'gas-lib',
        version: '1.0.0',
        private: true,
        description: 'A library',
        license: 'MIT',
        author: 'Someone',
        repository: { type: 'git', url: 'https://example.com/gas-lib.git' },
        scripts: { build: 'tsc' },
        devDependencies: { typescript: '^5.0.0' },
        ...pkg,
        ...(config !== undefined || pkg['gasdev'] !== undefined
          ? {
              gasdev: {
                ...(config && { release: config }),
                .../** @type {Record<string, unknown> | undefined} */ (
                  pkg['gasdev']
                ),
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  });
  writeFiles(root, files);
  build(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'feat: initial');
  git(root, 'tag', 'v1.0.0');
  git(root, 'push', 'origin', 'main', '--tags');
  return { root, origin, sandbox };
}

/**
 * Writes the (git-ignored) build output; `marker` changes the compiled content.
 *
 * @param {string} root
 * @param {string} marker
 */
export function writeBuild(root, marker) {
  writeFiles(root, {
    'dist/lib.js': `// ${marker}\n`,
    'dist/lib.d.ts': `// ${marker}\n`,
    'dist/lib.types.js': "'use strict';\n",
    'dist/lib.types.d.ts': `// ${marker}\n`,
  });
}

/**
 * Writes a gas-webapp shaped build: backend files, `web/` client and `shared/` contract.
 *
 * @param {string} root
 * @param {string} marker Changes the backend content only.
 */
export function writeWebappBuild(root, marker) {
  writeFiles(root, {
    'dist/main.js': `// ${marker}\n`,
    'dist/main.d.ts': `// ${marker}\n`,
    'dist/web/client.js': '// client\n',
    'dist/web/client.d.ts': '// client\n',
    'dist/web/types/x.js': "'use strict';\n",
    'dist/web/types/x.d.ts': '// x\n',
    'dist/shared/contract.types.js': "'use strict';\n",
    'dist/shared/contract.types.d.ts': '// contract\n',
  });
}

/**
 * Bumps the version in package.json, commits it and creates and pushes `v<version>`.
 *
 * @param {string} root
 * @param {string} version
 */
export function bumpVersion(root, version) {
  const path = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  git(root, 'commit', '-am', `chore: release ${version}`);
  git(root, 'tag', `v${version}`);
  git(root, 'push', 'origin', 'main', '--tags');
}

/**
 * Clones the origin into a new project directory carrying over the build output.
 *
 * @param {{ root: string, origin: string, sandbox: string }} project
 * @returns {string} The clone's root.
 */
export function cloneProject({ root, origin, sandbox }) {
  const clone = join(sandbox, 'clone');
  git(sandbox, 'clone', origin, clone);
  configureUser(clone, 'Clone');
  cpSync(join(root, 'dist'), join(clone, 'dist'), { recursive: true });
  return clone;
}

/**
 * Runs the CLI in a project.
 *
 * @param {string} cwd
 * @param {string[]} [args]
 * @param {Record<string, string>} [env] Variables merged over `process.env`.
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runRelease(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [BIN, 'release', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/**
 * Makes the project's `origin` look like a GitHub remote: sets its URL to
 * `https://github.com/acme/gas-lib.git` and maps that URL back to the local bare repo.
 *
 * @param {string} root Project root.
 * @param {string} origin Path of the bare origin repo.
 */
export function useGitHubRemote(root, origin) {
  const url = 'https://github.com/acme/gas-lib.git';
  git(root, 'config', 'remote.origin.url', url);
  git(root, 'config', `url.${origin}.insteadOf`, url);
}

/**
 * Installs a stub `gh` on a temporary `PATH` entry.
 *
 * @param {object} [behavior]
 * @param {'absent' | 'published' | 'draft' | 'error'} [behavior.view] Outcome of `release view`.
 * @param {'ok' | 'fail' | 'silent-fail'} [behavior.create] Outcome of `release create`; `silent-fail` exits 1 with no stderr.
 * @param {'protected' | 'error' | 'garbage' | { branches?: Record<string, string[]>, rulesets?: object[] }} [behavior.rules]
 *   Outcome of `gh api` rulesets lookups: fully protected, an auth failure, non-JSON output, or the rule types per
 *   branch (`branches`) and the repository rulesets (`rulesets`, with `id`, `target`, `enforcement`,
 *   `conditions` and `rules`).
 * @returns {{ env: Record<string, string>, calls: () => { args: string[], stdin: string }[] }}
 */
export function fakeGh({
  view = 'absent',
  create = 'ok',
  rules = 'protected',
} = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'gasdev-release-gh-'));
  sandboxes.push(sandbox);
  const bin = join(sandbox, 'bin');
  const log = join(sandbox, 'calls.jsonl');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  cpSync(FAKE_GH, gh);
  chmodSync(gh, 0o755);
  writeFileSync(log, '');
  /** @type {Record<string, string>} */
  const rulesEnv = {};
  if (rules === 'error' || rules === 'garbage') {
    rulesEnv.FAKE_GH_RULES = rules;
  } else if (rules !== 'protected') {
    const file = join(sandbox, 'rules.json');
    writeFileSync(file, JSON.stringify(rules));
    rulesEnv.FAKE_GH_RULES = file;
  }
  return {
    env: {
      ...rulesEnv,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_LOG: log,
      FAKE_GH_VIEW: view,
      FAKE_GH_CREATE: create,
    },
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

/** Removes every sandbox created by `createProject`. */
export function cleanup() {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
