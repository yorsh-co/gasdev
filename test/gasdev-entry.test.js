import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const BIN_URL = new URL('../bin/gasdev.js', import.meta.url);
const BIN = fileURLToPath(BIN_URL);

// Both cases spawn node: importing bin/gasdev.js in the test process breaks
// the merge of its subprocess coverage.
describe('bin/gasdev.js entry point', () => {
  /** @type {string | undefined} */
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('does not run main when imported', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(BIN_URL.href)});`,
      ],
      { encoding: 'utf8' },
    );

    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('runs main when launched through a symlink', () => {
    dir = mkdtempSync(join(tmpdir(), 'gasdev-entry-'));
    const link = join(dir, 'gasdev-link');
    symlinkSync(BIN, link);

    const result = spawnSync(process.execPath, [link, '--version'], {
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${pkg.version}\n`);
    expect(result.status).toBe(0);
  });
});
