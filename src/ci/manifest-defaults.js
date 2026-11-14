// @ts-check

/**
 * Default content of the clasp and manifest templates for a project type,
 * keyed by file name. Shared by `gasdev init` and `gasdev setup`.
 *
 * @param {string} [type] Project type (`library`, `app` or `webapp`).
 * @returns {Record<string, object>}
 */
export function templateDefaults(type) {
  return {
    '.clasp.example.json': { rootDir: 'dist' },
    'appsscript.example.json': {
      runtimeVersion: 'V8',
      exceptionLogging: 'STACKDRIVER',
      oauthScopes: [],
      ...(type === 'webapp'
        ? { webapp: { executeAs: 'USER_DEPLOYING', access: 'MYSELF' } }
        : {}),
    },
  };
}
