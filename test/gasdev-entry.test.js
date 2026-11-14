import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const BIN = fileURLToPath(new URL('../bin/gasdev.js', import.meta.url));

describe('bin/gasdev.js entry point', () => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  /** @type {string | undefined} */
  let dir;

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('does not run main when imported', async () => {
    process.argv = ['node', 'vitest'];
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const before = process.exitCode;

    await import('../bin/gasdev.js');

    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(before);
  });

  it('runs main when launched through a symlink', () => {
    dir = mkdtempSync(join(tmpdir(), 'gasdev-entry-'));
    const link = join(dir, 'gasdev-link');
    symlinkSync(BIN, link);

    const result = spawnSync(process.execPath, [link, '--version'], {
      encoding: 'utf8',
    });

    expect(result.stdout).toBe(`${pkg.version}\n`);
    expect(result.status).toBe(0);
  });
});
