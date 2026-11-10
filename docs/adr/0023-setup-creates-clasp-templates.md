# 23. Setup creates the clasp and manifest templates

- Status: Accepted
- Date: 2026-11-10

## Context

`gasdev setup` requires `.clasp.example.json` and `appsscript.example.json`, but no command created them, so `setup` failed on every project freshly scaffolded with `gasdev init`. The gas preset also covers libraries that never deploy, and `gasdev.ci` is optional, so `init` cannot tell whether a project is a web app.

## Decision

`gasdev setup` creates whichever template is missing, with defaults, after one confirm prompt. If the user declines, setup fails and points to the README. `init` does not create them. `deploy` is unchanged and never writes them.

Writing the files from `init` was rejected: libraries would get files they never use.

## Consequences

- A freshly scaffolded web app project runs `setup` without hand-written files.
- `deploy` still fails in CI when either file is missing.
- Libraries get no unused files.
- Existing files are never overwritten, and nothing is written outside a project (no `package.json`).
