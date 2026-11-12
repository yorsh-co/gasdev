# 17. Security model

- Status: Accepted
- Date: 2026-11-07
- Ported from gas-dev-ci ADR 0008

## Context

`deploy` handles the clasp OAuth credentials in CI. An audit found that they were written to `~/.clasprc.json` and never removed (they persisted on self-hosted runners and overwrote a developer's own credentials on a local run), and that clasp inherited the raw `CLASPRC_JSON` and the `clasp_config_*` overrides from the environment.

## Decision

Trust boundaries:

- The caller workflow and its environment variables are trusted, including `check` and `build` commands and the IDs passed in.
- The secret is present only in the deploy step.

Controls:

- Masking: with `GITHUB_ACTIONS` set, every string leaf of the credentials is masked with `::add-mask::`.
- Redaction: string leaves of 8 or more characters are removed from clasp output before it reaches an error message.
- Temporary credentials file: `deploy` writes the credentials (mode 0600) to a `mkdtemp` directory (mode 0700), passes it to clasp with `-A <file>`, and removes the directory in `finally`. It never writes to `~`, so an existing `~/.clasprc.json` is untouched. Under GitHub Actions the directory is created in `RUNNER_TEMP`, which the runner empties at the end of every job even when the step is killed; otherwise it is created in the OS temp dir.
- Stripped child environment: clasp does not receive `CLASPRC_JSON`, `clasp_config_auth`, `clasp_config_project` or `clasp_config_ignore`, matched case-insensitively.
- ID validation: script and deployment IDs are checked before use.
- `.env`: written with mode 0600 and must be git-ignored.

Accepted risks:

- S6: zod < 4.6.6 (GHSA-mrhx-c7xc-m3w5) through `@google/clasp` 3.4.1, with no fix in clasp 3. Accepted per ADR 0005: the inputs it parses are not untrusted.
- S7: `npm ci`, `check` and `build` run project and dependency code in the same job as the deploy step, so a compromised dependency can tamper with `node_modules` that the deploy step then runs with the secret. This is inherent to a single-job design; splitting the job would defeat the reusable workflow's simplicity.
- Only an interrupted local run (for example Ctrl+C) can leave the credentials file behind, in the OS temp dir and readable only by the developer. No signal handlers are installed: every clasp call is synchronous, so a JS handler could not run before `deploy` returns, and handlers would change the exit codes in ADR 0007.

This replaces the earlier behaviour of storing the credentials in `~/.clasprc.json`.

## Consequences

- No credentials remain on the runner after the deploy step, and local runs do not touch the developer's own login.
- clasp must keep supporting the global `-A` option.
