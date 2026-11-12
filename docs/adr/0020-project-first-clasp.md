# 20. Project-first clasp

- Status: Accepted
- Amended by: [ADR 0022](0022-report-deploy-clasp.md)
- Date: 2026-11-07

## Context

ADR 0018 left `gasdev setup` and `gasdev deploy` resolving clasp only relative to this package, while `gasdev gas-test run` resolved the project's `node_modules` first. The two diverge when clasp is hoisted or nested away from this package, and `deploy` could then run a different clasp than the one the project pinned.

## Decision

All clasp commands resolve project-first, then fall back to the clasp next to this package, through one resolver, `resolveProjectClaspBin(root)` in `src/clasp-bin.js`. `setup` and `deploy` resolve from the project root they already receive as `cwd`. Callers keep their own error types and hints.

## Consequences

- Trust is unchanged: the project's `node_modules` already runs project code in `check` and `build`.
- Credentials still reach clasp only through `-A` with the stripped environment (ADR 0017).
- `gas-test run`, `setup` and `deploy` use the same clasp in every install layout.
- ADR 0018's "Clasp resolution differs between commands" section is amended.
- Any failure to resolve the project's clasp (not installed, or installed but broken, e.g. no `bin` field) falls back silently to the clasp next to this package. `deploy` reports the resolved path (ADR 0022).
