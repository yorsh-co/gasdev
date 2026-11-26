# 38. Prod environment name

- Status: Accepted
- Date: 2026-11-26

## Context

The production deploy target was called `live` in both CI flows: the GitHub environment, the Gitea `_LIVE` secrets and variables, and the `deploy-live` step. The rest of the tooling and documentation refers to the target as production, so the name was inconsistent.

## Decision

The production target is named `prod` in both flows:

- The GitHub environment is `prod`.
- The Gitea secrets and variables use the `_PROD` suffix.
- The Gitea workflow step is `deploy-prod`.

`gas-deploy.yml` takes `environment` as a free-form input and is unchanged.

## Consequences

- `init` writes `.github/workflows/deploy.yml` only when it is absent, so existing projects are not rewritten and keep working with `live` until they migrate.
- GitHub migration: rename the `live` environment to `prod`, or create `prod` with the same branch policy, secret and variables, then edit `deploy.yml` to use `'prod'`.
- Gitea migration: recreate the secrets and variables with the `_PROD` suffix and update the workflow.
- This is not a breaking change to gasdev itself.
