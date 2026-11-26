// @ts-check
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');
const MANIFEST = { timeZone: 'America/Sao_Paulo', runtimeVersion: 'V8' };

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {Record<string, string | undefined>} files Relative path to content.
 * @returns {string} A new temp project with the given files.
 */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-manifest-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    if (content === undefined) continue;
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/**
 * @param {string} cwd
 * @param {string[]} [args]
 */
function run(cwd, args = ['manifest']) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const template = JSON.stringify(MANIFEST);
const clasp = JSON.stringify({ rootDir: 'dist' });

describe('gasdev manifest', () => {
  it('writes dist/appsscript.json equal to the template', () => {
    const cwd = project({
      'appsscript.example.json': template,
      '.clasp.example.json': clasp,
    });
    const result = run(cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const text = readFileSync(join(cwd, 'dist', 'appsscript.json'), 'utf8');
    expect(text).toBe(JSON.stringify(MANIFEST, null, 2) + '\n');
  });

  it('creates nested directories for a custom rootDir', () => {
    const cwd = project({
      'appsscript.example.json': template,
      '.clasp.example.json': JSON.stringify({ rootDir: 'build/gas' }),
    });
    expect(run(cwd).status).toBe(0);
    const text = readFileSync(
      join(cwd, 'build', 'gas', 'appsscript.json'),
      'utf8',
    );
    expect(JSON.parse(text)).toEqual(MANIFEST);
  });

  it('writes ./appsscript.json when rootDir is absent', () => {
    const cwd = project({
      'appsscript.example.json': template,
      '.clasp.example.json': '{}',
    });
    expect(run(cwd).status).toBe(0);
    const text = readFileSync(join(cwd, 'appsscript.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(MANIFEST);
  });

  it('overwrites an existing manifest', () => {
    const cwd = project({
      'appsscript.example.json': template,
      '.clasp.example.json': clasp,
      'dist/appsscript.json': '{"timeZone":"UTC","extra":true}',
    });
    expect(run(cwd).status).toBe(0);
    const text = readFileSync(join(cwd, 'dist', 'appsscript.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(MANIFEST);
  });

  it.each([
    [
      'template missing',
      { '.clasp.example.json': clasp },
      'appsscript.example.json not found',
    ],
    [
      'invalid JSON',
      { 'appsscript.example.json': '{', '.clasp.example.json': clasp },
      'not valid JSON',
    ],
    [
      'array template',
      { 'appsscript.example.json': '[]', '.clasp.example.json': clasp },
      'must contain a JSON object',
    ],
    [
      '.clasp.example.json missing',
      { 'appsscript.example.json': template },
      '.clasp.example.json not found',
    ],
    [
      'rootDir outside the project',
      {
        'appsscript.example.json': template,
        '.clasp.example.json': JSON.stringify({ rootDir: '../x' }),
      },
      'rootDir',
    ],
  ])('exits 1 when %s', (_name, files, message) => {
    const result = run(project(files));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gasdev: ');
    expect(result.stderr).toContain(message);
  });

  it('exits 1 when rootDir cannot be created', () => {
    const cwd = project({
      'appsscript.example.json': template,
      '.clasp.example.json': clasp,
      dist: 'not a directory',
    });
    const result = run(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gasdev: cannot write');
  });

  it.each([
    ['missing', '{"runtimeVersion":"V8"}'],
    ['empty', '{"timeZone":""}'],
  ])('warns on stderr and exits 0 when timeZone is %s', (_name, content) => {
    const cwd = project({
      'appsscript.example.json': content,
      '.clasp.example.json': clasp,
    });
    const result = run(cwd);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'gasdev manifest: appsscript.example.json has no timeZone; add one so every build uses the same time zone',
    );
    const text = readFileSync(join(cwd, 'dist', 'appsscript.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(JSON.parse(content));
  });

  it('exits 2 on extra arguments', () => {
    expect(run(project({}), ['manifest', 'extra']).status).toBe(2);
  });
});
