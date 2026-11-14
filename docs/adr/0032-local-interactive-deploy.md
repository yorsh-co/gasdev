# 32. Local interactive deploy

- Status: Accepted
- Date: 2026-11-13

## Context

`gasdev deploy` was CI-only: it read `CLASPRC_JSON`, `GAS_SCRIPT_ID`, `GAS_DEPLOYMENT_ID` and `GITHUB_SHA` from the environment and failed when one was missing. Deploying from a developer machine required exporting all of them by hand.

## Decision

`gasdev deploy` becomes dual-mode. When stdin and stdout are TTYs and `GITHUB_ACTIONS` is not `true`, it completes the missing inputs interactively. Otherwise nothing changes, and CI never blocks on stdin.

- Credentials come from `~/.clasprc.json`, the file `clasp login` writes, when `CLASPRC_JSON` is unset. They are never prompted for. The contents are passed as `CLASPRC_JSON`, so the existing redaction applies, and are never printed. An unreadable file fails with a normal `gasdev:` error.
- A missing `~/.clasprc.json` fails before any prompt, with a `clasp login` hint.
- The script ID, the deployment ID (empty means push only) and the version description (default: `git rev-parse HEAD`) are prompted, pre-filled from `.env`.
- Answers are not persisted and never copied into `process.env`.
- Cancelling exits 130, as `setup` does.

## Consequences

- A local deploy uses the developer's own clasp credentials, so it acts as that Google account.
- Scripts that run `gasdev deploy` from a terminal without the variables now prompt instead of failing. Non-TTY runs keep the previous errors.
- The prompt function is injected, so tests need no TTY.
