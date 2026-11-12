// @ts-check
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/ci/setup/config.js';
import { DeployError } from '../../../src/ci/errors.js';
import { cleanup, createProject } from './helpers/project.js';

afterEach(cleanup);

describe('loadConfig', () => {
  it('rejects a legacy gasDevCi key', () => {
    const root = createProject({ pkg: { gasDevCi: {} } });
    expect(() => loadConfig(root)).toThrow(DeployError);
    expect(() => loadConfig(root)).toThrow(
      /"gasDevCi".*"gasdev\.ci".*Migrating to 3\.0/,
    );
  });

  it('applies defaults', () => {
    const root = createProject();
    const config = loadConfig(root);
    expect(config.title).toBe('my-app');
    expect(config.rootDir).toBe('.');
    expect(config.pkg.name).toBe('my-app');
    expect(config.claspTemplate).toEqual({ scriptId: '' });
    expect(config.manifestTemplate).toEqual({
      timeZone: 'Etc/UTC',
      runtimeVersion: 'V8',
    });
    expect(config.paths).toEqual({
      env: join(root, '.env'),
      clasp: join(root, '.clasp.json'),
      manifest: join(root, 'appsscript.json'),
      claspTemplate: join(root, '.clasp.example.json'),
      manifestTemplate: join(root, 'appsscript.example.json'),
    });
  });

  it('overrides the title', () => {
    const root = createProject({
      pkg: { gasdev: { ci: { title: 'Custom' } } },
    });
    expect(loadConfig(root).title).toBe('Custom');
  });

  it('puts the manifest under rootDir', () => {
    const root = createProject({ clasp: { scriptId: '', rootDir: 'dist' } });
    const config = loadConfig(root);
    expect(config.rootDir).toBe('dist');
    expect(config.paths.manifest).toBe(join(root, 'dist', 'appsscript.json'));
  });

  it('rejects an unknown key', () => {
    const root = createProject({ pkg: { gasdev: { ci: { nope: 1 } } } });
    expect(() => loadConfig(root)).toThrow('gasdev.ci.nope');
  });

  it.each([
    ['ci', 'text', 'gasdev.ci must be an object'],
    ['ci', [], 'gasdev.ci must be an object'],
    ['title', 5, 'gasdev.ci.title must be a non-empty string'],
    ['title', '  ', 'gasdev.ci.title must be a non-empty string'],
  ])('rejects wrong type for %s (%j)', (key, value, message) => {
    const ci = key === 'title' ? { title: value } : value;
    const root = createProject({ pkg: { gasdev: { ci } } });
    expect(() => loadConfig(root)).toThrow(message);
  });

  it('resolves the steps module to an absolute path', () => {
    const root = createProject({
      pkg: { gasdev: { ci: { steps: 'deploy/steps.mjs' } } },
      files: { 'deploy/steps.mjs': 'export default [];\n' },
    });
    expect(loadConfig(root).stepsPath).toBe(join(root, 'deploy/steps.mjs'));
  });

  it.each([
    [5, 'must be a non-empty string'],
    ['', 'must be a non-empty string'],
    ['/abs/steps.js', 'relative path inside the project'],
    ['../steps.js', 'relative path inside the project'],
    ['steps.ts', 'must end in .js or .mjs'],
    ['missing.js', 'not found'],
  ])('rejects invalid steps %j', (steps, message) => {
    const root = createProject({ pkg: { gasdev: { ci: { steps } } } });
    expect(() => loadConfig(root)).toThrow(message);
  });

  it('requires a package name', () => {
    const root = createProject({ pkg: { name: undefined } });
    expect(() => loadConfig(root)).toThrow(DeployError);
    expect(() => loadConfig(root)).toThrow('no "name"');
  });

  it('fails when package.json is missing', () => {
    const root = createProject();
    expect(() => loadConfig(join(root, 'missing'))).toThrow(
      'package.json not found',
    );
  });

  it.each(['.clasp.example.json', 'appsscript.example.json'])(
    'names the missing template %s',
    (name) => {
      const root = createProject();
      rmSync(join(root, name));
      expect(() => loadConfig(root)).toThrow(`${name} not found`);
    },
  );

  it('reports invalid JSON in a template', () => {
    const root = createProject({ files: { '.clasp.example.json': '{oops' } });
    expect(() => loadConfig(root)).toThrow(
      '.clasp.example.json is not valid JSON',
    );
  });

  it.each(['../outside', '/etc', 'a/../../b'])(
    'rejects rootDir %s escaping the project',
    (rootDir) => {
      const root = createProject({ clasp: { scriptId: '', rootDir } });
      expect(() => loadConfig(root)).toThrow('inside the project');
    },
  );
});
