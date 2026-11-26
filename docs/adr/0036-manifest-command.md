# 36. Manifest command

- Status: Accepted
- Date: 2026-11-26

## Context

`gasdev deploy` requires `<rootDir>/appsscript.json`, but no gasdev command writes it during a build. CI failed with `dist/appsscript.json not found` unless the project's own build copied the manifest. The build stays project-defined (ADR 0016), so gasdev needs a building block that projects can append to `build`.

## Decision

`gasdev manifest` writes `<rootDir>/appsscript.json` from `appsscript.example.json`.

- The output is the template verbatim, as 2-space JSON with a trailing newline. It creates `rootDir` if needed and overwrites any existing file. The output is deterministic, so CI and local builds match.
- It does not merge with an existing built manifest, because a merge would make CI output depend on leftover local state.
- `rootDir` comes from `.clasp.example.json` through the validation shared with `gasdev deploy` (`resolveRootDir` in `src/ci/clasp-config.js`): absent means `.`, and the path must be relative with no `..`. The file is required, as for deploy.
- A missing or empty `timeZone` in the template warns on stderr and still succeeds. The zone chosen by `gasdev setup` lives only in the built manifest, so a rebuild drops it.
- A missing or invalid template, or an invalid `rootDir`, exits 1 with `ManifestError`.
- `init` does not change the `build` placeholder. The README shows how to append `gasdev manifest`.

## Alternatives rejected

- `deploy` renders the manifest. This departs from ADR 0023, where `deploy` never writes project files, and leaves a local `clasp push` without a manifest.
- Documenting a `cp` command. It is not cross-platform and ignores `rootDir`.

## Consequences

- Projects add `gasdev manifest` to their `build` script by hand.
- Projects set `timeZone` in `appsscript.example.json` to keep one zone across builds.
