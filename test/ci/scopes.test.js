// @ts-check
import { describe, expect, it } from 'vitest';
import { diffScopes } from '../../src/ci/scopes.js';

describe('diffScopes', () => {
  it('returns nothing for equal sets in any order, ignoring duplicates', () => {
    expect(
      diffScopes({ oauthScopes: ['b', 'a', 'a'] }, { oauthScopes: ['a', 'b'] }),
    ).toEqual({ added: [], removed: [] });
  });

  it('returns sorted added and removed scopes', () => {
    expect(
      diffScopes(
        { oauthScopes: ['z', 'c', 'a'] },
        { oauthScopes: ['a', 'y', 'b'] },
      ),
    ).toEqual({ added: ['c', 'z'], removed: ['b', 'y'] });
  });

  it('treats a missing key as empty', () => {
    expect(diffScopes({}, { oauthScopes: ['a'] })).toEqual({
      added: [],
      removed: ['a'],
    });
    expect(diffScopes({ oauthScopes: ['a'] }, {})).toEqual({
      added: ['a'],
      removed: [],
    });
    expect(diffScopes({}, {})).toEqual({ added: [], removed: [] });
  });
});
