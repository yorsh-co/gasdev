import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { resolveClaspBin, resolveProjectClaspBin } from '../src/clasp-bin.js';

describe('resolveClaspBin', () => {
  it('returns the installed clasp entry script', () => {
    const bin = resolveClaspBin();
    expect(existsSync(bin)).toBe(true);
    expect(bin.endsWith(join('build', 'src', 'index.js'))).toBe(true);
  });

  it('throws a plain Error when clasp cannot be resolved', () => {
    expect(() => resolveClaspBin(join(tmpdir(), 'nowhere.js'))).toThrow(
      '@google/clasp is not installed. Install it with `npm install -D @google/clasp`.',
    );
  });
});

describe('resolveProjectClaspBin', () => {
  it('prefers the project install', () => {
    /** @type {import('vitest').Mock<(from?: string | URL) => string>} */
    const resolve = vi.fn(() => '/project/clasp.js');
    expect(resolveProjectClaspBin('/project', resolve)).toBe(
      '/project/clasp.js',
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(String(resolve.mock.calls[0]?.[0])).toBe(
      pathToFileURL(join('/project', 'package.json')).href,
    );
  });

  it('falls back to the clasp next to this package', () => {
    /** @type {import('vitest').Mock<(from?: string | URL) => string>} */
    const resolve = vi.fn((from) => {
      if (from) throw new Error('not in project');
      return '/package/clasp.js';
    });
    expect(resolveProjectClaspBin('/project', resolve)).toBe(
      '/package/clasp.js',
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("throws the fallback's error when both are missing", () => {
    const resolve = vi.fn((from) => {
      throw new Error(from ? 'project missing' : 'package missing');
    });
    expect(() => resolveProjectClaspBin('/project', resolve)).toThrow(
      'package missing',
    );
  });
});
