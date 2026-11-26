# 37. Gitignore for `.clasp.json`

- Status: Accepted
- Date: 2026-11-26

## Context

`.clasp.json` holds a per-developer `scriptId`. `gasdev` regenerates it from `.clasp.example.json` plus `GAS_SCRIPT_ID` in the `setup` configuration step (also when it reuses an existing project) and on every `deploy`, so committing it only produces noise and conflicts. The README told users to ignore it by hand, and `check` did not enforce it.

## Decision

This extends the table in [ADR 0007](0007-gitignore-tooling-and-env.md).

| Path          | `gas` template | `node` template |
| ------------- | -------------- | --------------- |
| `.clasp.json` | yes            | no              |

- `.clasp.json` is an unconditional line in the `gas` preset only. A library loses nothing by ignoring it.
- Rejected: a type-aware ignore check (requiring the line only for `app` and `webapp`). It needs the project type threaded through the ignore check for no gain.

## Consequences

- `gasdev check` requires the line in gas projects. Consumers add it with `check --fix`; `init` writes it for new projects.
- A repository that already commits `.clasp.json` must run `git rm --cached .clasp.json`.
- This is a minor version bump, following the precedent of ADR 0007.
