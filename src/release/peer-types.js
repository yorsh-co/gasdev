// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReleaseError } from './errors.js';

const VERSION_TAG = /^\s*\*\s*@version\s+(\S+)\s*$/m;

/**
 * Verifies that the package's canonical peer declarations name the version being released.
 *
 * Skipped when `pkg.name` is unset or `peer/<name>.peer.types.d.ts` does not exist.
 *
 * @param {{ name?: unknown, version?: unknown }} pkg The project's package.json.
 * @param {string} cwd Project root.
 * @returns {void}
 * @throws {ReleaseError} When the file has no `@version` tag or it differs from `pkg.version`.
 */
export function assertPeerTypesVersion(pkg, cwd) {
  if (typeof pkg.name !== 'string' || pkg.name === '') return;
  const file = `peer/${pkg.name}.peer.types.d.ts`;
  const path = join(cwd, file);
  if (!existsSync(path)) return;

  const declared = VERSION_TAG.exec(readFileSync(path, 'utf8'))?.[1];
  if (declared === undefined) {
    throw new ReleaseError(
      `${file} has no @version tag — add "@version ${pkg.version}" to its header.`,
    );
  }
  if (declared !== pkg.version) {
    throw new ReleaseError(
      `${file} declares @version ${declared} but package.json is ${pkg.version} — update the @version header in the release branch.`,
    );
  }
}
