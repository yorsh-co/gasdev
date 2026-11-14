# 31. Deploy workflow version check

- Status: Accepted; amended by [ADR 0034](0034-older-deploy-ref-warning.md)
- Date: 2026-11-13

## Context

The README requires the `gas-deploy.yml@vX.Y.Z` workflow tag and the `gasdev` version to match. Dependabot bumps the npm package only, and a `github-actions` ecosystem would bump the workflow ref in a separate PR, so the two drift apart.

## Decision

`gasdev check` compares each `gas-deploy.yml@` ref in `.github/workflows/*.yml` and `*.yaml` with the installed gasdev version. A ref that is not `vX.Y.Z` (a branch or SHA) is reported. `check --fix` and `init` rewrite the `vX.Y.Z` in place, keeping indentation, trailing comments and line endings.

This is a narrow exception to [ADR 0002](0002-check-fix-ignore-files.md)'s append-only fixes. The value is derived from the installed package, not authored by the project. Non-semver refs are deliberate pins and stay manual. gasdev itself is skipped.

## Consequences

- A Dependabot bump of gasdev across a major fails `check` in CI until `check --fix` is run and the result committed. Same-major bumps only warn, see [ADR 0034](0034-older-deploy-ref-warning.md).
- Upgrading gasdev followed by `check --fix` keeps the workflow and the npm package on one version.
