// @ts-check

/**
 * @param {any} manifest
 * @returns {string[]} Sorted, unique `oauthScopes`; a missing key counts as empty.
 */
function scopesOf(manifest) {
  const scopes = Array.isArray(manifest?.oauthScopes)
    ? manifest.oauthScopes.filter(
        (/** @type {unknown} */ scope) => typeof scope === 'string',
      )
    : [];
  return [...new Set(/** @type {string[]} */ (scopes))].sort();
}

/**
 * Compares the OAuth scopes of two manifests as sets.
 *
 * @param {any} local Manifest about to be pushed.
 * @param {any} deployed Manifest of the deployed version.
 * @returns {{ added: string[], removed: string[] }} Scopes only in `local`, and only in `deployed`.
 */
export function diffScopes(local, deployed) {
  const before = new Set(scopesOf(deployed));
  const after = new Set(scopesOf(local));
  return {
    added: [...after].filter((scope) => !before.has(scope)),
    removed: [...before].filter((scope) => !after.has(scope)),
  };
}
