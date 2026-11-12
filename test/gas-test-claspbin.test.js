import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { GasTestError, INSTALL_HINT, claspBin } from '../bin/gas-test.js';

describe('claspBin', () => {
  it('prefers the project install', () => {
    /** @type {import('vitest').Mock<(from?: string | URL) => string>} */
    const resolve = vi.fn(() => '/project/clasp.js');
    expect(claspBin('/project', resolve)).toBe('/project/clasp.js');
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
    expect(claspBin('/project', resolve)).toBe('/package/clasp.js');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('throws the install hint when both are missing', () => {
    const resolve = vi.fn(() => {
      throw new Error('missing');
    });
    const call = () => claspBin('/project', resolve);
    expect(call).toThrow(GasTestError);
    expect(call).toThrow(INSTALL_HINT);
    expect(INSTALL_HINT).toBe(
      '@google/clasp is not installed. Install it with `npm install -D @google/clasp`, then run `npx clasp login`.',
    );
  });
});
