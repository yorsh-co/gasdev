# 11. Peer declaration version check

- Status: Accepted
- Date: 2026-11-04
- Ported from gas-dev-release ADR 0002

## Context

Each gas-* library ships canonical type declarations in `peer/<name>.peer.types.d.ts`, whose `@version` header names the package version they describe. The header is maintained by hand and drifted from `package.json` in five repositories, so consumers vendoring the file could not tell which release it matched.

## Decision

Release preflight compares the `@version` header with `package.json`'s `version`.

- Scope: the check reads `peer/<pkg.name>.peer.types.d.ts`. It is skipped when the file is absent or `name` is unset, so projects without peer declarations are unaffected.
- Failure: a header that differs from `version`, or a file without an `@version` tag, raises a `ReleaseError`. A missing tag fails because it is the same drift, only undetectable.
- Position: it runs right after the check that `vX.Y.Z` points at `HEAD`, before any target check, and before anything is modified or pushed.

## Alternatives

- A `gas-dev-config check` rule: suggested earlier, but it lives in a different repository and runs on a different cadence. It would flag the header during development, when it is legitimately behind the next version.
- Auto-stamping the header at release time: it would write to the tagged commit, so the tag would no longer match the released source. Rejected.

## Consequences

- The header must be bumped in the release branch next to `chore: bump version number`.
- The check runs on the tagged commit, so a miss discovered late forces a new patch release.
- The new failure condition ships as a minor version (1.3.0), following gas-dev-config's precedent for new required checks.
