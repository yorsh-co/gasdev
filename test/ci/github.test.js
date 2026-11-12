// @ts-check
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeployError } from '../../src/ci/errors.js';
import { writeOutput, writeSummary } from '../../src/ci/github.js';

describe('github file commands', () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let file;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gas-github-'));
    file = join(dir, 'out');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends outputs', () => {
    writeOutput(file, 'a', '1');
    writeOutput(file, 'b', '2');
    expect(readFileSync(file, 'utf8')).toBe('a=1\nb=2\n');
  });

  it('appends summaries', () => {
    writeSummary(file, '# one\n');
    writeSummary(file, 'two\n');
    expect(readFileSync(file, 'utf8')).toBe('# one\ntwo\n');
  });

  it('does nothing for an undefined path', () => {
    expect(() => writeOutput(undefined, 'a', '1')).not.toThrow();
    expect(() => writeSummary(undefined, 'x')).not.toThrow();
  });

  it.each([
    ['name', 'a\nb', '1'],
    ['name', 'a\rb', '1'],
    ['value', 'a', '1\nINJECTED=2'],
    ['value', 'a', '1\r2'],
  ])('rejects a line break in the %s', (_part, name, value) => {
    expect(() => writeOutput(file, name, value)).toThrow(DeployError);
    expect(() => readFileSync(file)).toThrow();
  });
});
