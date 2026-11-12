// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolves the entry script of an installed `@google/clasp`. Its `exports` map does not expose
 * `package.json`, so the package root is found by walking up from the resolved entry point.
 *
 * @param {string | URL} [from] File path or URL to resolve from; defaults to this package.
 * @returns {string} Absolute path of the clasp bin script.
 * @throws {Error} When `@google/clasp` cannot be resolved.
 */
export function resolveClaspBin(from = import.meta.url) {
  try {
    const require = createRequire(from);
    let dir = dirname(require.resolve('@google/clasp'));
    for (;;) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === '@google/clasp') {
          const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.clasp;
          if (typeof bin !== 'string') break;
          return join(dir, bin);
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error(
    '@google/clasp is not installed. Install it with `npm install -D @google/clasp`.',
  );
}

/**
 * Locates clasp: the project's own install first, then the one next to this package.
 *
 * @param {string} root Project root.
 * @param {(from?: string | URL) => string} [resolve] Bin resolver.
 * @returns {string} Absolute path of the clasp bin script.
 * @throws {Error} The fallback resolver's error when clasp is installed in neither place.
 */
export function resolveProjectClaspBin(root, resolve = resolveClaspBin) {
  try {
    return resolve(pathToFileURL(join(root, 'package.json')));
  } catch {
    return resolve();
  }
}
