// @ts-check
import { describe, expect, it } from 'vitest';
import { globMatcher, matchesAny } from '../../src/release/glob.js';

describe('globMatcher', () => {
  it.each([
    ['*.types.js', 'lib.types.js', true],
    ['*.types.js', 'nested/dir/lib.types.js', true],
    ['*.types.js', 'lib.types.d.ts', false],
    ['*.types.js', 'libXtypesXjs', false],
    ['*.js', 'a.js', true],
    ['*.js', 'a.json', false],
    ['lib.?s', 'lib.js', true],
    ['lib.?s', 'lib.jss', false],
    ['shared/*.js', 'shared/a.js', true],
    ['shared/*.js', 'shared/deep/a.js', false],
    ['shared/*.js', 'other/shared/a.js', false],
    ['**/types/*.js', 'types/a.js', true],
    ['**/types/*.js', 'a/b/types/c.js', true],
    ['**/types/*.js', 'a/types/c/d.js', false],
    ['web/**', 'web/a/b.js', true],
    ['web/**', 'webx/a.js', false],
    ['a.b', 'axb', false],
    ['(x)+.js', '(x)+.js', true],
  ])('%s vs %s -> %s', (pattern, path, expected) => {
    expect(globMatcher(pattern)(path)).toBe(expected);
  });
});

describe('matchesAny', () => {
  it('matches when any pattern matches', () => {
    expect(matchesAny('a/b.js', ['*.ts', 'a/*.js'])).toBe(true);
  });

  it('does not match an empty pattern list', () => {
    expect(matchesAny('a.js', [])).toBe(false);
  });
});
