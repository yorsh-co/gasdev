import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject } from './support.js';

/** The `.prettierrc.json` previously copied into every gas-* repository. */
/** @type {import('prettier').Options} */
const LEGACY_OPTIONS = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
};

describe('prettier config', () => {
  /** @type {ReturnType<typeof createProject>} */
  let project;
  let sample = '';

  beforeAll(() => {
    project = createProject('prettier');
    sample = readFileSync(join(project.dir, 'sample.ts'), 'utf8');
  });

  afterAll(() => project.cleanup());

  it('resolves the "gasdev/prettier" package.json specifier', async () => {
    const options = await prettier.resolveConfig(
      join(project.dir, 'sample.ts'),
    );
    expect(options).toMatchObject({ singleQuote: true });
  });

  it('formats identically to the legacy .prettierrc.json options', async () => {
    const filepath = join(project.dir, 'sample.ts');
    const resolved = await prettier.resolveConfig(filepath);
    const actual = await prettier.format(sample, { ...resolved, filepath });
    const expected = await prettier.format(sample, {
      ...LEGACY_OPTIONS,
      filepath,
    });
    expect(actual).toBe(expected);
    expect(actual).toContain("'Hello, '");
  });
});
