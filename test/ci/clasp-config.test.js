// @ts-check
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderClaspConfig } from '../../src/ci/clasp-config.js';
import { DeployError } from '../../src/ci/errors.js';

/** @type {string} */
let cwd;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'gasdev-cwd-'));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

/** @param {string} text */
const writeTemplate = (text) =>
  writeFileSync(join(cwd, '.clasp.example.json'), text);

describe('renderClaspConfig', () => {
  it('writes the template plus scriptId, keeping filePushOrder', () => {
    const template = {
      rootDir: 'dist',
      filePushOrder: ['dist/a.js', 'dist/b.js'],
    };
    writeTemplate(JSON.stringify(template));
    writeFileSync(join(cwd, '.clasp.json'), '{"scriptId":"old"}');
    const result = renderClaspConfig(cwd, 'script-1');
    const text = readFileSync(join(cwd, '.clasp.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ ...template, scriptId: 'script-1' });
    expect(text).toBe(
      JSON.stringify({ ...template, scriptId: 'script-1' }, null, 2) + '\n',
    );
    expect(result).toEqual({
      rootDir: 'dist',
      manifestPath: join(cwd, 'dist', 'appsscript.json'),
    });
  });

  it('defaults rootDir to "."', () => {
    writeTemplate('{}');
    expect(renderClaspConfig(cwd, 's').rootDir).toBe('.');
  });

  it.each([
    ['missing template', undefined, 'not found'],
    ['invalid JSON', '{nope', 'not valid JSON'],
    ['non-object', '[]', 'must contain a JSON object'],
    ['empty rootDir', '{"rootDir":" "}', 'non-empty string'],
    ['non-string rootDir', '{"rootDir":1}', 'non-empty string'],
    ['absolute rootDir', '{"rootDir":"/abs"}', 'relative path'],
    ['parent rootDir', '{"rootDir":"../x"}', 'relative path'],
  ])('rejects %s', (_name, text, expected) => {
    if (text !== undefined) {
      writeTemplate(text);
    }
    expect(() => renderClaspConfig(cwd, 's')).toThrow(DeployError);
    expect(() => renderClaspConfig(cwd, 's')).toThrow(expected);
  });
});
