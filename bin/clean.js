// @ts-check
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Raised when the directory to remove is not safely inside the project. */
export class CleanError extends Error {}

/**
 * @param {string} base
 * @param {string} path
 * @param {boolean} allowEqual Whether `path` may be `base` itself.
 * @returns {boolean} Whether `path` is inside `base`.
 */
function isInside(base, path, allowEqual) {
  const rel = relative(base, path);
  if (rel === '') return allowEqual;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Removes a directory inside the project, like `rimraf <dir>`. A missing
 * directory is not an error. Paths outside the project root, the root itself
 * and paths that reach outside through a symlinked ancestor are refused. The
 * containment check does not guard against concurrent filesystem changes
 * between the check and the removal.
 *
 * @param {string} cwd Project root.
 * @param {string} [dir] Directory to remove, relative to the root (default: dist).
 * @returns {number} Exit code 0.
 * @throws {CleanError} When the target is the root or outside it.
 */
export function runClean(cwd, dir = 'dist') {
  const root = resolve(cwd);
  const target = resolve(root, dir);
  if (relative(root, target) === '') {
    throw new CleanError('clean: refusing to remove the project root');
  }
  if (!isInside(root, target, false)) {
    throw new CleanError(`clean: ${dir} is outside the project root`);
  }
  let ancestor = dirname(target);
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    ancestor = dirname(ancestor);
  }
  /** @type {string} */
  let realRoot;
  /** @type {string} */
  let realAncestor;
  try {
    realRoot = realpathSync(root);
    realAncestor = realpathSync(ancestor);
  } catch (error) {
    throw new CleanError(`clean: ${/** @type {Error} */ (error).message}`);
  }
  if (!isInside(realRoot, realAncestor, true)) {
    throw new CleanError(`clean: ${dir} is outside the project root`);
  }
  rmSync(target, { recursive: true, force: true });
  return 0;
}
