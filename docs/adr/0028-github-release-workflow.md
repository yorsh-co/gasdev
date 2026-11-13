# 28. GitHub Release workflow

- Status: Accepted
- Date: 2026-11-13

## Context

gasdev's own GitHub Releases were created by hand after pushing the release tag. The step was easy to forget, and the notes were copied from `CHANGELOG.md` manually.

## Decision

Pushing a stable `vX.Y.Z` tag runs `.github/workflows/release.yml`, which calls `scripts/github-release.js` to create the Release with the matching CHANGELOG section as notes.

- The script reuses `changelogSection`, `findRelease` and `createRelease`, so `gasdev release` and gasdev's own releases share one parser and one `gh` wrapper.
- Only stable tags trigger the workflow, and the script repeats the check. Prerelease tags never got Releases.
- The run fails, creating nothing, when the tag differs from `package.json`'s `version` or CHANGELOG has no section for it. `npm run check` is not re-run: it already ran before the branch was finished.
- Re-running for a tag whose Release is published is a no-op. An existing draft fails the run without being touched, because someone is editing it by hand.
- The job alone has `contents: write`. The tag reaches the script through `$GITHUB_REF_NAME`, never through expression interpolation in `run:`.

## Consequences

- `git push origin main develop vX.Y.Z` is the whole release.
- Releases created with `GITHUB_TOKEN` do not trigger other workflows.
- The workflow can only be verified end to end by a real tag push, so the first run should be watched.
