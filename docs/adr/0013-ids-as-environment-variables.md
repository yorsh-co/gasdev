# 13. IDs as environment variables

- Status: Accepted
- Date: 2026-11-06
- Ported from gas-dev-ci ADR 0002

## Context

The deployment needs `CLASPRC_JSON`, the script ID and the web app deployment ID. The original spec stored all three as secrets. GitHub drops any job output that contains a secret value, and the web app URL contains the deployment ID, so the `url` output would never reach the caller.

## Decision

Only `CLASPRC_JSON` is a secret. `GAS_SCRIPT_ID` and `GAS_DEPLOYMENT_ID` are environment variables (`vars`) of the GitHub environment.

- The two IDs identify the project but grant no access.
- The CLI validates both against `/^[A-Za-z0-9_-]+$/`, which also prevents injection into `GITHUB_OUTPUT`.
- Every string leaf of `CLASPRC_JSON` with 8 or more characters is masked with `::add-mask::`, one line at a time for multi-line values, because GitHub masks the whole secret but not its parts.

## Consequences

- The `url` output works.
- The IDs are visible to anyone who can read the repository's environment variables.
- gforms-scores-lookup ADR 0005, which says the environment holds all three as secrets, must be updated.
