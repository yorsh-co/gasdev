// @ts-check
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** @type {string[]} */
const sandboxes = [];

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
 * Creates a temporary project directory with the required package.json and templates.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.pkg] package.json fields merged over the defaults.
 * @param {Record<string, unknown> | null} [options.clasp] Content of `.clasp.example.json`; the file is skipped when null.
 * @param {Record<string, unknown> | null} [options.manifest] Content of `appsscript.example.json`; the file is skipped when null.
 * @param {string} [options.gitignore] Content of `.gitignore`; omitted when undefined.
 * @param {boolean} [options.git] Run `git init` in the project.
 * @param {Record<string, string>} [options.files] Extra files (path -> content).
 * @returns {string} The project root.
 */
export function createProject({
  pkg = {},
  clasp = { scriptId: '' },
  manifest = { timeZone: 'Etc/UTC', runtimeVersion: 'V8' },
  gitignore,
  git = false,
  files = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gasdev-'));
  sandboxes.push(root);
  writeFiles(root, {
    'package.json': `${JSON.stringify({ name: 'my-app', version: '1.0.0', ...pkg }, null, 2)}\n`,
    ...(clasp !== null && {
      '.clasp.example.json': `${JSON.stringify(clasp, null, 2)}\n`,
    }),
    ...(manifest !== null && {
      'appsscript.example.json': `${JSON.stringify(manifest, null, 2)}\n`,
    }),
    ...(gitignore !== undefined && { '.gitignore': gitignore }),
  });
  writeFiles(root, files);
  if (git) {
    execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  }
  return root;
}

/** Removes every project created by `createProject`. */
export function cleanup() {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Creates a scratch directory for the fake clasp's call log.
 *
 * @returns {{ logPath: string, cleanup: () => void }}
 */
export function createFakeLog() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-fake-'));
  return {
    logPath: join(dir, 'calls.jsonl'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
