import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Absolute path of the gasdev repository root. */
export const REPO_ROOT = ROOT;

/**
 * Copies a fixture into a temporary project whose `node_modules` exposes
 * gasdev (symlinked to the repository) and the repository's `@types`,
 * mimicking an installed consumer.
 *
 * @param {string} fixture Path relative to `test/fixtures`.
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function createProject(fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-'));
  cpSync(join(ROOT, 'test', 'fixtures', fixture), dir, { recursive: true });
  const modules = join(dir, 'node_modules');
  mkdirSync(modules);
  symlinkSync(ROOT, join(modules, 'gasdev'), 'dir');
  symlinkSync(join(ROOT, 'node_modules', '@types'), join(modules, '@types'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
