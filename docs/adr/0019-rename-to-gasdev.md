# 19. Rename to gasdev

- Status: Accepted
- Date: 2026-11-07

## Context

After folding `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` into one package, a single `gas-dev-config` entry point exposes `check`, `bundle`, `release`, `setup` and `deploy`. The `-config` suffix no longer describes it. A later rename would force consumers through a second breaking migration.

## Decision

Rename in the same major as the fold (3.0):

- Package, bin and repository: `gasdev` (`github.com/yorsh-co/gasdev`).
- `package.json` key: `gasdev`, with `gasdev.bundle`, `gasdev.release` and `gasdev.ci`.
- Imports: `gasdev/{eslint,prettier,tsconfig/*,test,gas-test,bundle,ci}`.
- Error prefix `gasdev:`, cache `node_modules/.cache/gasdev`, environment variable `GASDEV_NETWORK`.
- Reusable workflow: `yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0`.

ADRs 0001-0017 and past CHANGELOG entries keep the old name as history.

## Consequences

- The owner renames the GitHub repository before tagging 3.0.0.
- GitHub redirects the old URL, but consumers should move to the new one.
- Consumers migrate once, to 3.0, for both the fold and the rename.
