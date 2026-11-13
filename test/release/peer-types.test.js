// @ts-check
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReleaseError } from '../../src/release/errors.js';
import {
  assertPeerTypesVersion,
  readPeerTypesVersion,
} from '../../src/release/peer-types.js';
import { writeFiles } from './helpers/project.js';

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

/**
 * Creates a project root, optionally holding `peer/gas-lib.peer.types.d.ts`.
 *
 * @param {string} [declarations] File content; the file is omitted when undefined.
 * @returns {string}
 */
function project(declarations) {
  const cwd = mkdtempSync(join(tmpdir(), 'gasdev-release-unit-'));
  dirs.push(cwd);
  if (declarations !== undefined) {
    writeFiles(cwd, { 'peer/gas-lib.peer.types.d.ts': declarations });
  }
  return cwd;
}

/**
 * @param {string} version
 * @returns {string}
 */
const header = (version) =>
  `/**\n * Peer declarations for gas-lib.\n *\n * @version ${version}\n */\nexport {};\n`;

describe('assertPeerTypesVersion', () => {
  const pkg = { name: 'gas-lib', version: '1.2.0' };

  it('does nothing when the declaration file is absent', () => {
    expect(() => assertPeerTypesVersion(pkg, project())).not.toThrow();
  });

  it('does nothing when the package has no name', () => {
    const cwd = project(header('0.0.1'));
    expect(() =>
      assertPeerTypesVersion({ version: '1.2.0' }, cwd),
    ).not.toThrow();
  });

  it('accepts a matching @version', () => {
    expect(() =>
      assertPeerTypesVersion(pkg, project(header('1.2.0'))),
    ).not.toThrow();
  });

  it('rejects a mismatch, naming the file, both versions and the fix', () => {
    const run = () => assertPeerTypesVersion(pkg, project(header('1.1.0')));
    expect(run).toThrow(ReleaseError);
    expect(run).toThrow(/peer\/gas-lib\.peer\.types\.d\.ts/);
    expect(run).toThrow(/1\.1\.0/);
    expect(run).toThrow(/1\.2\.0/);
    expect(run).toThrow(/update the @version header/);
  });

  it('rejects a file without an @version tag', () => {
    const run = () =>
      assertPeerTypesVersion(pkg, project('/** No tag. */\nexport {};\n'));
    expect(run).toThrow(ReleaseError);
    expect(run).toThrow(/add "@version 1\.2\.0"/);
  });
});

describe('readPeerTypesVersion', () => {
  it('returns undefined when the package has no name', () => {
    const cwd = project();
    writeFiles(cwd, { 'peer/undefined.peer.types.d.ts': header('1.2.0') });
    const pkg = {};
    expect(readPeerTypesVersion(pkg, cwd)).toBeUndefined();
  });
});
