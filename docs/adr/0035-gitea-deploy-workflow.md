# 35. Gitea deploy workflow

- Status: Accepted
- Amended by [ADR 0038](0038-prod-environment-name.md) (`_LIVE` renamed to `_PROD`).
- Date: 2026-11-24

## Context

Projects hosted on Gitea need the same CD flow as the GitHub one: a push to `develop` deploys to the dev Apps Script project and a push to `main` deploys to the live one. The GitHub flow relies on a reusable workflow (`gas-deploy.yml`) called from the project, with branch-restricted environments holding `CLASPRC_JSON`, `GAS_SCRIPT_ID` and `GAS_DEPLOYMENT_ID`. Gitea Actions supports reusable workflows from github.com, `environment:` and `secrets: inherit` only partially, and has no branch-restricted environments.

## Decision

Projects opt in with `gasdev.ci.platform: "gitea"`. The accepted values are `"github"` (the default) and `"gitea"`. When the key is absent or `"github"`, `init` output, the template and the tests are unchanged.

- Inline template, not a reusable workflow. `init` scaffolds `.gitea/workflows/deploy.yml` with the steps of `gas-deploy.yml` inlined: checkout, setup-node, `npm ci`, `check`, `build` and `npx --no-install gasdev deploy`. `gasdev` comes from the lockfile, so there is no workflow ref to drift and `checkDeployWorkflowRef` is untouched.
- Only `init` reads `platform`, to choose which workflow to scaffold. `check` and `setup` validate it. `check --fix` does not create deploy workflows, and still does not.
- Gitea has no branch-restricted environments, so the targets are told apart by a name suffix: secrets `CLASPRC_JSON_DEV` and `CLASPRC_JSON_LIVE`, variables `GAS_SCRIPT_ID_DEV`/`_LIVE` and `GAS_DEPLOYMENT_ID_DEV`/`_LIVE`.
- One deploy step per branch, gated by `if: github.ref_name == 'develop'` and `if: github.ref_name == 'main'`, each with its own literal `env`. The template never uses `cond && a || b`: an empty `GAS_DEPLOYMENT_ID_LIVE` (a push-only project) is falsy, so the expression would fall through to the DEV value and redeploy the wrong deployment.
- No runtime change to `src/ci`. act_runner sets `GITHUB_OUTPUT`, `GITHUB_SHA` and `RUNNER_TEMP` and supports `::add-mask::`. Both deploy steps also set `GITHUB_ACTIONS: 'true'` explicitly. `deploy.js` masks the `CLASPRC_JSON` fragments and `cli.js` skips local prompts only when that variable is `'true'`, so masking cannot depend on runner behaviour. Gitea does not render `GITHUB_STEP_SUMMARY`; that is harmless. The `vars` context needs Gitea 1.20 or later.
- No `concurrency:` block, because not every Gitea version supports it.
- Action SHAs match `gas-deploy.yml`. Instances with `DEFAULT_ACTIONS_URL=self` need full `https://github.com/...` URLs.
- Coexistence: GitHub ignores `.gitea/`. Gitea prefers `.gitea/workflows` over `.github/workflows` when both exist, so a repository mirrored to both hosts can keep both files.
- `.github/dependabot.yml` is still created and checked whatever the platform. Gitea ignores the file, and gating it on platform would change existing behaviour. This stays out of scope.

## Consequences

- Security: every workflow run with access to the repository secrets can read `CLASPRC_JSON_LIVE`, not only runs on `main`. On GitHub the environment's deployment branch policy releases the live credentials only to `main`. Mitigations, documented in the README: protected branches, a restricted set of writers, and a separate Google account for live.
- Pushes in quick succession can deploy concurrently, because there is no concurrency guard.
- `init` never overwrites the file and `check` never inspects it, so a Gitea project keeps the steps it was scaffolded with. To re-scaffold, delete the file and rerun `init`.
- The job summary is not shown on Gitea.
- Not verified on a live Gitea instance; only a real run proves runner compatibility.
- Gitea projects get an unused `.github/dependabot.yml`.
