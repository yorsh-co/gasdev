# 10. GitHub Release after the push

- Status: Accepted
- Date: 2026-11-03
- Ported from gas-dev-release ADR 0001

## Context

Profile badges can only show the latest version through `github/v/release`, which needs a GitHub Release. Releases were created by hand. The tool pushes one branch and one `<branch>/vX.Y.Z` tag per target, while git-flow creates a single semver tag `vX.Y.Z` on the source commit.

## Decision

With `gasDevConfig.release.githubRelease: true`, a successful release also creates a GitHub Release.

- Tag: the Release is for `vX.Y.Z`. There is one per version however many targets exist, and it is semver, so the badge shows plain `vX.Y.Z`. `<branch>/vX.Y.Z` would mean N Releases per version. The tool does not push `vX.Y.Z`; preflight requires it on the remote at the local commit, and `--verify-tag` keeps `gh` from creating it.
- Client: the `gh` CLI, not REST with a token. `gh` handles authentication (`gh auth login`, or `GH_TOKEN` in CI), and runs without a shell. It is needed only when the option is on. REST would need the tool to manage a token, and tests would need a fake HTTP server.
- Lookup in preflight: `gh release view` runs before anything is pushed. A missing or unauthenticated `gh` fails early, and `--dry-run` reports the real outcome. An existing Release, draft or published, is skipped so no duplicate is created.
- Failure: an error after the push is fatal with exit code 3, because the option was opted into and CI has to notice a missing Release. The notes are saved to `.worktrees/github-release-vX.Y.Z.md` and the exact retry command is printed. Nothing is rolled back.

## Consequences

- Exit code `1` still means nothing was pushed; `3` means pushed, Release missing.
- Without the option nothing changes: no `gh` call and no new dependency.
- The Release's source archives are of the source commit, not the dist build; consumers install from the dist branches.
- A failed Release is fixed by running the printed command, not by re-running the release.
