// @ts-check
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };

const BIN = fileURLToPath(new URL('../../bin/gasdev.js', import.meta.url));

/**
 * @param {string[]} args
 */
const run = (args) =>
  spawnSync(process.execPath, [BIN, 'release', ...args], { encoding: 'utf8' });

describe('gasdev release CLI', () => {
  it.each(['--help', '-h'])('%s prints usage and exits 0', (flag) => {
    const result = run([flag]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: gasdev release');
    expect(result.stdout).toContain('--dry-run');
    expect(result.stdout).toContain('--target');
  });

  it('--version prints the package version', () => {
    const result = run(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('exits 1 with a prefixed message on a known failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gasdev-release-'));
    try {
      const result = spawnSync(process.execPath, [BIN, 'release'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('gasdev: Cannot read package.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [['--bogus'], /Unknown option '--bogus'/],
    [['extra'], /Unexpected argument 'extra'/],
    [['--target'], /argument missing/],
    [['--dry-run=yes'], /does not take an argument/],
  ])('exits 2 with a hint on invalid usage %j', (args, message) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^gasdev: /);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain('Run gasdev release --help for usage.');
    expect(result.stderr).not.toContain('    at ');
  });
});
