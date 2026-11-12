// @ts-check
import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  maskCommands,
  secretValues,
} from '../../src/ci/secrets.js';

describe('secretValues', () => {
  it('collects string leaves of length 8 or more, recursively', () => {
    const values = secretValues({
      a: 'short',
      b: 'exactly8',
      c: { d: ['nested-value', 42, null, 'tiny'] },
    });
    expect(values.sort()).toEqual(['exactly8', 'nested-value']);
  });

  it('returns a duplicate leaf only once', () => {
    expect(
      secretValues({ a: 'duplicate-value', b: ['duplicate-value'] }),
    ).toEqual(['duplicate-value']);
  });
});

describe('createRedactor', () => {
  it('replaces all occurrences, longest value first', () => {
    const redact = createRedactor(['abcdefgh', 'abcdefghij']);
    expect(redact('x abcdefghij y abcdefgh abcdefgh')).toBe('x *** y *** ***');
  });

  it('leaves text without secrets untouched', () => {
    expect(createRedactor(['abcdefgh'])('nothing here')).toBe('nothing here');
  });
});

describe('maskCommands', () => {
  it('emits one add-mask line per value', () => {
    expect(maskCommands(['abcdefgh', 'ijklmnop'])).toEqual([
      '::add-mask::abcdefgh',
      '::add-mask::ijklmnop',
    ]);
  });

  it('escapes workflow command characters', () => {
    expect(maskCommands(['abc%0Adefgh'])).toEqual([
      '::add-mask::abc%250Adefgh',
    ]);
  });

  it('masks multi-line values line by line and dedupes', () => {
    expect(
      maskCommands([
        'line-one\r\n\nline-two\nline-one',
        'abcdefgh',
        'abcdefgh',
      ]),
    ).toEqual([
      '::add-mask::line-one',
      '::add-mask::line-two',
      '::add-mask::abcdefgh',
    ]);
  });
});
