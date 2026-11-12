# 12. Rulesets preflight

- Status: Accepted
- Date: 2026-11-06
- Ported from gas-dev-release ADR 0003

## Context

On GitHub Free, branch and tag protection comes from per-repository rulesets. Without them, the dist branches and the release tags can be force-pushed, deleted or moved, so a release can land in refs that rewrite history silently. `gas-dev-config github` applies the gas-* rulesets, but nothing verified that they were in place before a release.

## Decision

With `gasDevConfig.release.githubRelease: true`, preflight refuses to release unless rulesets protect every target branch and the release tags.

- Minimum protection, not template equality: each target branch needs `deletion` and `non_fast_forward`; tags need an active tag ruleset on `~ALL`, with an empty `exclude`, containing `deletion`, `non_fast_forward` and `update`. Other tag patterns are not evaluated. Bypass actors are not inspected, because non-admin tokens cannot see them.
- Endpoints: `gh api repos/<repo>/rules/branches/<branch>` returns the active rules in effect, at repository and organization level, and works before the branch exists. Tags use `gh api repos/<repo>/rulesets` to find active tag rulesets, then `gh api repos/<repo>/rulesets/<id>` for each.
- Organization rules count as protection.
- No dependency on the `github` command and no copy of its templates.
- All gaps are collected into one error that points to `npx gas-dev-config github --fix`. `--dry-run` refuses the same way.

Rejected:

- Checking with `githubRelease` off: it would add a `gh` requirement to offline releases.
- Comparing against the full template: it duplicates gas-dev-config and fails on harmless drift.

## Consequences

- An unprotected repository exits `1` before anything is pushed.
- Each repository must run `npx gas-dev-config github --fix` once (admin rights).
- Each release makes a few extra `gh api` calls.
- Without the option nothing changes: no `gh` call.
