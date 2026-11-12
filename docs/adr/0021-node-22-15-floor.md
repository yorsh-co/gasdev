# 21. Node 22.15 floor

- Status: Accepted
- Date: 2026-11-07

## Context

The `gas-test` missing-clasp test relies on `module.registerHooks`, the only hook API that covers `require.resolve`. It exists from Node 22.15. ADR 0006 set a uniform range of `^22.13.0 || ^24.0.0 || >=26.0.0` across the gas-\* repositories, which includes Node versions without it.

## Decision

`engines.node` becomes `^22.15.0 || ^24.0.0 || >=26.0.0`. This amends ADR 0006's uniform range for this repository.

## Consequences

- Breaking for 3.0: Node 22.13 and 22.14 are no longer supported.
- The other gas-\* repos align when they adopt gasdev 3.
- Re-run ADR 0006's engines check; the new range must stay within every direct dependency's `engines.node`.
- The missing-clasp test no longer skips on any supported Node version.
