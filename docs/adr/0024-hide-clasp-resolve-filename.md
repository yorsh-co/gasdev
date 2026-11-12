# 24. Hide clasp through Module.\_resolveFilename

- Status: Accepted
- Amends: [ADR 0021](0021-node-22-15-floor.md) (Context)
- Date: 2026-11-11

## Context

ADR 0021 assumed `module.registerHooks` covers `require.resolve` from Node 22.15. It does not: the hook is not applied to `require.resolve` on any Node 22 release (verified on 22.15.0 and 22.23.4). `src/clasp-bin.js` resolves clasp with `createRequire(...).resolve`, so on Node 22 the missing-clasp test resolved the repository's own clasp and failed.

## Decision

The test fixture `test/fixtures/hide-clasp.mjs` wraps `Module._resolveFilename`, which covers `createRequire(...).resolve` on Node 22, 24 and 26. Nothing in `src/` or `bin/` imports `@google/clasp` through ESM, so no ESM hook is needed. `engines.node` stays `^22.15.0 || ^24.0.0 || >=26.0.0`.

## Consequences

- The missing-clasp test runs on every supported Node version.
- The 22.15 floor no longer has a technical reason and may be relaxed in a later minor.
- `Module._resolveFilename` is internal API, used only in a test fixture.
