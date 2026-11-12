# 22. Report the clasp deploy runs

- Status: Accepted
- Amends: [ADR 0020](0020-project-first-clasp.md)
- Date: 2026-11-07

## Context

ADR 0020 resolves clasp project-first and falls back silently to the clasp next to this package. That fallback also covers a project clasp that is installed but broken (for example, no `bin` field), so a CI log gave no hint which clasp `deploy` actually ran.

## Decision

`gasdev deploy` prints `Using clasp: <path>` before pushing. Resolution is unchanged.

Failing on a broken project clasp was rejected: the case is theoretical, and failing would turn a recoverable fallback into a broken deploy.

## Consequences

- The CI log shows the clasp path `deploy` used.
- `setup` and `gas-test run` still fall back silently.
- The line is not semver-covered (ADR 0018 excludes messages and clasp output).
