// @ts-check

const LEGACY_KEYS = {
  gasDevConfig: 'gasdev',
  gasDevBundle: 'gasdev.bundle',
  gasDevRelease: 'gasdev.release',
  gasDevCi: 'gasdev.ci',
};

/**
 * Finds a pre-3.0 top-level package.json config key.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @returns {string | null} A message naming the key, its replacement and the migration guide, or null.
 */
export function legacyKeyMessage(pkg) {
  for (const [legacy, replacement] of Object.entries(LEGACY_KEYS)) {
    if (legacy in pkg) {
      return `package.json: "${legacy}" is no longer supported; move it to "${replacement}" (see the README section "Migrating to 3.0").`;
    }
  }
  return null;
}
