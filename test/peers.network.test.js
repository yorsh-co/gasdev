import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');
const OUTPUT = join('src', 'internal', 'gas-lock.peer.types.d.ts');

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Creates a project that lists gas-lock as a peer.
 *
 * @returns {string} The project directory.
 */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-peers-net-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'x',
      gasdev: { peers: { 'gas-lock': '^1.2.0' } },
    }),
  );
  return dir;
}

/**
 * Runs the CLI in `cwd`.
 *
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

describe.skipIf(process.env.GASDEV_NETWORK !== '1')(
  'CLI against GitHub',
  () => {
    it('peers sync --check reports a missing file and writes nothing', () => {
      const dir = project();
      const result = run(dir, ['peers', 'sync', '--check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /src\/internal\/gas-lock\.peer\.types\.d\.ts is out of date with gas-lock@1\.\d+\.\d+: run gasdev peers sync/,
      );
      expect(existsSync(join(dir, OUTPUT))).toBe(false);
    });

    it('peers sync writes the file, then --check passes', () => {
      const dir = project();
      const sync = run(dir, ['peers', 'sync']);
      expect(sync.status).toBe(0);
      expect(sync.stdout).toMatch(
        /✓ Synced src\/internal\/gas-lock\.peer\.types\.d\.ts from gas-lock@1\.\d+\.\d+/,
      );
      const text = readFileSync(join(dir, OUTPUT), 'utf8');
      expect(text).toContain('@see https://github.com/yorsh-co/gas-lock');
      expect(text).not.toMatch(/^ \* @version /m);

      const check = run(dir, ['peers', 'sync', '--check']);
      expect(check.status).toBe(0);
      expect(check.stdout).toContain('✓ Peer types are up to date');
    });
  },
);
