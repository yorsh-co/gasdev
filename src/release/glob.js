// @ts-check

/**
 * Compiles a glob into a matcher for `/`-separated relative paths.
 *
 * Supports `*` (any characters except `/`), `?` (one character except `/`) and
 * `**` (any characters including `/`; `**` followed by `/` also matches zero
 * directories). A pattern without `/` matches the file name at any depth.
 *
 * @param {string} pattern
 * @returns {(path: string) => boolean}
 */
export function globMatcher(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = /** @type {string} */ (pattern[i]);
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${source}$`);
  const basenameOnly = !pattern.includes('/');
  return (path) =>
    regex.test(basenameOnly ? (path.split('/').pop() ?? path) : path);
}

/**
 * Tells whether a relative path matches any of the globs.
 *
 * A pattern ending in `/` matches directories only (the slash is not part of
 * the glob), so `web/` skips a directory but not a file named `web`.
 *
 * @param {string} path `/`-separated path relative to the copied directory.
 * @param {string[]} patterns
 * @param {boolean} [isDirectory] Whether the path is a directory.
 * @returns {boolean}
 */
export function matchesAny(path, patterns, isDirectory = false) {
  return patterns.some((pattern) => {
    if (!pattern.endsWith('/')) return globMatcher(pattern)(path);
    return isDirectory && globMatcher(pattern.slice(0, -1))(path);
  });
}
