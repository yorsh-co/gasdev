import Module from 'node:module';

/**
 * Preloaded with `--import` to make `@google/clasp` unresolvable to `require.resolve`, which is how
 * `src/clasp-bin.js` locates it, so the missing-clasp path can be exercised in a spawned process.
 */
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === '@google/clasp' || request.startsWith('@google/clasp/')) {
    throw Object.assign(new Error(`Cannot find module '${request}'`), {
      code: 'MODULE_NOT_FOUND',
    });
  }
  return resolveFilename.call(this, request, ...rest);
};
