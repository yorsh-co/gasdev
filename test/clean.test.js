import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CleanError, runClean } from '../bin/clean.js';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} A new temp directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-clean-'));
  dirs.push(dir);
  return dir;
}

/**
 * @param {string} root
 * @param {string} dir
 * @returns {string} The path of a file created inside `dir`.
 */
function seed(root, dir) {
  const file = join(root, dir, 'nested', 'a.js');
  mkdirSync(join(root, dir, 'nested'), { recursive: true });
  writeFileSync(file, 'x');
  return file;
}

describe('runClean', () => {
  it('removes a nested dist tree', () => {
    const root = tempDir();
    seed(root, 'dist');
    expect(runClean(root)).toBe(0);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  });

  it('succeeds when dist is missing', () => {
    expect(runClean(tempDir())).toBe(0);
  });

  it('removes a custom directory', () => {
    const root = tempDir();
    const keep = seed(root, 'dist');
    seed(root, 'out/build');
    expect(runClean(root, 'out/build')).toBe(0);
    expect(existsSync(join(root, 'out', 'build'))).toBe(false);
    expect(existsSync(keep)).toBe(true);
  });

  it('refuses paths outside the root and the root itself', () => {
    const base = tempDir();
    const root = join(base, 'project');
    const outside = join(base, 'x');
    const inRoot = seed(root, 'dist');
    const outsideFile = seed(base, 'x');
    for (const dir of ['.', '']) {
      expect(() => runClean(root, dir)).toThrow(
        /refusing to remove the project root/,
      );
    }
    for (const dir of ['../x', outside]) {
      expect(() => runClean(root, dir)).toThrow(/outside the project root/);
    }
    expect(existsSync(inRoot)).toBe(true);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('refuses a path that escapes through a symlink', (ctx) => {
    const base = tempDir();
    const root = join(base, 'project');
    const outsideFile = seed(base, 'external/dist');
    mkdirSync(root);
    try {
      symlinkSync(join(base, 'external'), join(root, 'link'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(() => runClean(root, 'link/dist')).toThrow(CleanError);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('refuses a path under a symlink when intermediate dirs are missing', (ctx) => {
    const base = tempDir();
    const root = join(base, 'project');
    const outsideFile = seed(base, 'external');
    mkdirSync(root);
    try {
      symlinkSync(join(base, 'external'), join(root, 'link'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(() => runClean(root, 'link/a/b')).toThrow(CleanError);
    expect(existsSync(outsideFile)).toBe(true);
  });

  it('does not touch anything outside the root via a dangling symlink', (ctx) => {
    const base = tempDir();
    const root = join(base, 'project');
    mkdirSync(root);
    try {
      symlinkSync(join(base, 'missing'), join(root, 'link'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(runClean(root, 'link/a')).toBe(0);
    expect(existsSync(join(base, 'missing'))).toBe(false);
  });

  it('reports filesystem errors as CleanError', (ctx) => {
    const base = tempDir();
    const root = join(base, 'loop');
    try {
      symlinkSync(root, root);
    } catch {
      ctx.skip();
    }
    expect(() => runClean(root)).toThrow(CleanError);
    expect(() => runClean(root)).toThrow(/^clean: /);
  });

  it('removes a symlink target without following it', (ctx) => {
    const base = tempDir();
    const root = join(base, 'project');
    const outsideFile = seed(base, 'external');
    mkdirSync(root);
    try {
      symlinkSync(join(base, 'external'), join(root, 'dist'), 'junction');
    } catch {
      ctx.skip();
    }
    expect(runClean(root)).toBe(0);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(existsSync(outsideFile)).toBe(true);
  });
});

describe('gasdev clean', () => {
  it('rejects more than one argument with exit 2', () => {
    const result = spawnSync(process.execPath, [BIN, 'clean', 'a', 'b'], {
      cwd: tempDir(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown command');
  });

  it('rejects --fix with exit 2', () => {
    const result = spawnSync(process.execPath, [BIN, 'clean', '--fix'], {
      cwd: tempDir(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
  });

  it('removes dist from the current directory', () => {
    const root = tempDir();
    seed(root, 'dist');
    const result = spawnSync(process.execPath, [BIN, 'clean'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'dist'))).toBe(false);
  });

  it('exits 1 for a path outside the root', () => {
    const result = spawnSync(process.execPath, [BIN, 'clean', '..'], {
      cwd: tempDir(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outside the project root');
  });
});
