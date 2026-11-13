# 27. Peer declaration version in `gasdev check`

- Status: Accepted
- Date: 2026-11-13
- Amends ADR 0011

## Context

ADR 0011 checks the `@version` header of `peer/<name>.peer.types.d.ts` only in release preflight, which runs on the tagged commit. A stale header was therefore found after the tag was cut, and fixing it forced a hotfix on `main`.

## Decision

`gasdev check` also compares the header with `package.json`'s current `version` and reports a missing tag or a mismatch as drift that fails the check. `--fix` does not touch the file.

- The comparison uses the current version, not the next one. The header only differs when `version` was bumped without it, so the check does not fire during normal feature work. This removes ADR 0011's reason for rejecting a check rule.
- Release preflight keeps its own check with unchanged messages, for releases that skip `npm run check`.
- Both callers share one reader, so the tag pattern and skip rules cannot diverge.
- The check is not gated on the `gas` preset, like the release check; the file only exists in gas libraries.

## Consequences

- The mismatch is caught on the release branch, before it is finished.
- The new failure condition ships as a minor version, following ADR 0011.
