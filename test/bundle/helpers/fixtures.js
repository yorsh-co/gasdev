// @ts-check
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../../bin/gasdev.js', import.meta.url));

/** @type {string[]} */
const sandboxes = [];

/**
 * Creates a temporary directory removed by `cleanup`.
 *
 * @returns {string}
 */
export function createSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'gasdev-bundle-'));
  sandboxes.push(sandbox);
  return sandbox;
}

/** Removes every sandbox created by `createSandbox`. */
export function cleanup() {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

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
 * @typedef {object} LibraryVersion
 * @property {string} version Tagged as `dist/v<version>`.
 * @property {Record<string, string>} [files] Defaults to a single `<name>.js`.
 * @property {Record<string, string>} [symlinks] Link path -> target, committed as symbolic links.
 * @property {string[]} [loadOrder] Defaults to the `.js` files.
 * @property {Record<string, string>} [peers]
 * @property {Record<string, unknown> | null} [gasLibrary] Replaces the generated metadata; `null` omits it.
 * @property {string} [packageName] Overrides the package.json name.
 */

/**
 * Creates a library repo whose commits are tagged `dist/vX.Y.Z`, one per version.
 *
 * @param {string} sandbox
 * @param {string} name
 * @param {LibraryVersion[]} versions
 * @returns {string} The repository path.
 */
export function createLibrary(sandbox, name, versions) {
  const repo = join(sandbox, `${name}.git-src`);
  mkdirSync(repo);
  git(repo, 'init', '-b', 'dist');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  for (const entry of versions) {
    for (const child of readdirSync(repo)) {
      if (child !== '.git')
        rmSync(join(repo, child), { recursive: true, force: true });
    }
    const files = entry.files ?? {
      [`${name}.js`]: `"use strict";\nvar ${name.replace(/\W/g, '_')} = '${entry.version}';\n`,
    };
    const gasLibrary =
      entry.gasLibrary === undefined
        ? {
            loadOrder:
              entry.loadOrder ??
              Object.keys(files).filter((file) => file.endsWith('.js')),
            ...(entry.peers && { peers: entry.peers }),
          }
        : entry.gasLibrary;
    writeFiles(repo, {
      ...files,
      'package.json': `${JSON.stringify(
        {
          name: entry.packageName ?? name,
          version: entry.version,
          ...(gasLibrary && { gasLibrary }),
        },
        null,
        2,
      )}\n`,
    });
    for (const [path, target] of Object.entries(entry.symlinks ?? {})) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      symlinkSync(target, join(repo, path));
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', `merge: v${entry.version}`);
    git(repo, 'tag', `dist/v${entry.version}`);
  }
  return repo;
}

/**
 * Creates a project directory with a package.json.
 *
 * @param {string} sandbox
 * @param {unknown} [bundleConfig] The `gasdev.bundle` key.
 * @returns {string} The project root.
 */
export function createProject(sandbox, bundleConfig) {
  const root = join(sandbox, 'project');
  mkdirSync(root, { recursive: true });
  writeFiles(root, {
    'package.json': `${JSON.stringify({ name: 'app', version: '1.0.0', ...(bundleConfig !== undefined && { gasdev: { bundle: bundleConfig } }) }, null, 2)}\n`,
  });
  return root;
}

/**
 * Runs the CLI in a project.
 *
 * @param {string} cwd
 * @param {string[]} [args]
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runBundle(cwd, args = []) {
  return spawnSync(process.execPath, [BIN, 'bundle', ...args], {
    cwd,
    encoding: 'utf8',
  });
}
