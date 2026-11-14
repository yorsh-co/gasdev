# 30. Project type

- Status: Accepted
- Amends: [ADR 0008](0008-init-command.md)
- Supersedes in part: [ADR 0023](0023-setup-creates-clasp-templates.md)
- Date: 2026-11-13

## Context

`init` could not tell libraries, deployed apps and web apps apart. Manifests, the deploy workflow and the tsconfig and ESLint files were copied by hand from the README or sibling repos, and the OAuth scopes were hard to find because `appsscript.example.json` was only created by `gasdev setup`.

## Decision

`package.json` gets an optional `gasdev.type` (gas preset only): `library`, `app` or `webapp`. `init` prompts for it when unset and both stdin and stdout are TTYs, then persists it. Without a TTY it prints a note and skips the type-driven files. `check` validates the value.

`init` (not `check --fix`) creates these files only when absent:

- All types: `tsconfig.json`, `tsconfig.test.json` and `eslint.config.js` (the web app variant for `webapp`); `gas-test/tsconfig.json` when `gasTest` is configured.
- `webapp`: also `tsconfig.frontend.json`.
- `app` and `webapp`: `.clasp.example.json`, `appsscript.example.json` (a `webapp` manifest gets a least-privileged `webapp` block) and `.github/workflows/deploy.yml`, a caller of `gas-deploy.yml` pinned to gasdev's own version, with `permissions: contents: read` and no expression interpolation in `run:`.

Personal dev copies still use the local `.clasp.json` from `gasdev setup`.

Rejected:

- A third `gasdev.scopes` list beside `oauthScopes` and `gasTest.scopes`: it would drift. Creating the manifest where scopes live fixes discoverability.
- A CI-side `gasdev release` for apps: deployment already goes through `gas-deploy.yml`.

## Consequences

- Type-driven files are project-owned after creation; `check` does not diff them.
- A library with a UI is not scaffolded and stays manual.
- Projects without `gasdev.type` keep validating and get no type-driven files.
