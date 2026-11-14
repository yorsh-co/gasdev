# 34. Older same-major deploy ref is a warning

- Status: Accepted
- Date: 2026-11-14

## Context

Dependabot bumps only the npm package, so every gasdev release turned the consumer pull requests red: `gasdev check` failed on the `gas-deploy.yml@vX.Y.Z` ref left at the previous version ([ADR 0031](0031-deploy-workflow-version.md)).

## Decision

`gas-deploy.yml` runs the project's installed gasdev, so an older workflow file with a newer package in the same major is compatible under semver. `gasdev check` reports a `vX.Y.Z` ref that is older than the installed version and in the same major as a warning. Every other mismatch stays drift: a newer ref, a ref in a different major, or a non-semver ref, since the workflow may expect inputs the installed package lacks.

Prerelease refs are compared with `semver.lt`, and their major is taken from `semver.major`. The message text is unchanged. `check --fix` and `init` behave as before.

## Consequences

- Dependabot pull requests that bump gasdev within a major pass `check`, with a warning.
- A major bump still fails `check` until `check --fix` is run and the result committed.
- The ref is realigned whenever `check --fix` runs.
