// @ts-check
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEnvIgnored,
  readEnv,
  updateEnv,
} from '../../../src/ci/setup/env.js';
import { DeployError } from '../../../src/ci/errors.js';
import { cleanup, createProject } from './helpers/project.js';

afterEach(cleanup);

/** @param {string} [initial] */
function envPath(initial) {
  const root = createProject({
    files: initial === undefined ? {} : { '.env': initial },
  });
  return join(root, '.env');
}

describe('readEnv', () => {
  it('returns {} when the file is missing', () => {
    expect(readEnv(envPath())).toEqual({});
  });

  it('parses the file', () => {
    expect(readEnv(envPath('A=1\nB="two words"\n'))).toEqual({
      A: '1',
      B: 'two words',
    });
  });
});

describe('updateEnv', () => {
  it('creates the file with mode 0600', () => {
    const path = envPath();
    updateEnv(path, { A: '1' });
    expect(readFileSync(path, 'utf8')).toBe('A=1\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('replaces keys in place, appends new ones and keeps other lines', () => {
    const path = envPath('# header\nA=old\nOTHER=x\n\nB=old\n');
    updateEnv(path, { A: 'new', C: '3' });
    expect(readFileSync(path, 'utf8')).toBe(
      '# header\nA=new\nOTHER=x\n\nB=old\nC=3\n',
    );
  });

  it('keeps keys named like Object.prototype members', () => {
    const path = envPath('constructor=x\ntoString=y\n');
    updateEnv(path, { A: '1' });
    expect(readFileSync(path, 'utf8')).toBe('constructor=x\ntoString=y\nA=1\n');
  });

  it('round-trips quoted values', () => {
    const path = envPath();
    const values = {
      PLAIN: 'abc',
      SPACE: 'a b',
      HASH: 'a#b',
      QUOTE: 'say "hi"',
      SINGLE: "it's",
      EMPTY: '',
    };
    updateEnv(path, values);
    expect(readEnv(path)).toEqual(values);
  });

  it('tightens the mode of an existing file to 0600', () => {
    const path = envPath('A=1\n');
    chmodSync(path, 0o644);
    updateEnv(path, { A: '2' });
    expect(readEnv(path)).toEqual({ A: '2' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('replaces the last of duplicate keys', () => {
    const path = envPath('A=1\nA=2\n');
    updateEnv(path, { A: '3' });
    expect(readEnv(path)).toEqual({ A: '3' });
  });

  it('round-trips a value with a backslash and a space', () => {
    const path = envPath();
    updateEnv(path, { P: 'C:\\new dir' });
    expect(readEnv(path)).toEqual({ P: 'C:\\new dir' });
  });

  it('falls back to backticks, then double quotes, then rejects', () => {
    const path = envPath();
    updateEnv(path, { A: `it's "x"` });
    expect(readFileSync(path, 'utf8')).toBe('A=`it\'s "x"`\n');
    expect(readEnv(path)).toEqual({ A: `it's "x"` });
    updateEnv(path, { B: `it's \`x\`` });
    expect(readEnv(path).B).toBe(`it's \`x\``);
    expect(() => updateEnv(path, { C: `a'b\`c"d` })).toThrow(DeployError);
    expect(() => updateEnv(path, { D: `a'b\`c d\\` })).toThrow(DeployError);
  });

  it('refuses to replace a multi-line value', () => {
    const path = envPath('KEY="line one\nline two"\n');
    expect(() => updateEnv(path, { KEY: 'x' })).toThrow(/KEY/);
    expect(readFileSync(path, 'utf8')).toBe('KEY="line one\nline two"\n');
  });

  it('rejects newlines and invalid keys without writing', () => {
    const path = envPath('A=1\n');
    expect(() => updateEnv(path, { A: 'x\ny' })).toThrow(DeployError);
    expect(() => updateEnv(path, { 'BAD KEY': 'x' })).toThrow(/Invalid/);
    expect(readFileSync(path, 'utf8')).toBe('A=1\n');
  });
});

describe('assertEnvIgnored', () => {
  it('passes outside a git work tree', () => {
    const root = createProject();
    expect(() => assertEnvIgnored(root)).not.toThrow();
  });

  it('passes when .env is ignored', () => {
    const root = createProject({ git: true, gitignore: '.env\n' });
    expect(() => assertEnvIgnored(root)).not.toThrow();
  });

  it('throws when .env is not ignored', () => {
    const root = createProject({ git: true, gitignore: 'node_modules\n' });
    writeFileSync(join(root, '.env'), 'A=1\n');
    expect(() => assertEnvIgnored(root)).toThrow(/Add `.env` to .gitignore/);
  });
});
