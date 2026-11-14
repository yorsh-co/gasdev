# 33. Clean command

- Status: Accepted
- Amends: [ADR 0005](0005-audit-overrides.md)
- Date: 2026-11-13

## Context

The `gas` template's `clean` script was `rimraf dist`, which made `rimraf` a dev dependency of every project and pulled `glob` and `minimatch` audit findings into each one (ADR 0005). A `node -e` one-liner avoids the dependency, but its quoting breaks in Windows `cmd`.

## Decision

`gasdev clean [<dir>]` replaces `rimraf dist`. The template's `clean` script is `gasdev clean`.

- It removes `<dir>` (default `dist`) with `fs.rmSync(path, { recursive: true, force: true })`. A missing directory succeeds silently, and nothing is printed on success.
- The target must be inside the project root. The root itself, a path outside it and an absolute path on another drive are refused (`CleanError`, exit 1).
- A symlink that leads out of the project is refused: the real path of the deepest existing ancestor of the target must be inside the real path of the root. The target itself may be a symlink, in which case only the link is removed.
- `check` reports a `clean` script still set to `rimraf dist` as a warning, not drift, so no project newly fails `check`. Any other differing value stays an error.
- `check --fix` and `init` do not rewrite an existing `clean` script (ADR 0008).

## Consequences

- Projects migrate by hand: change `"clean"` to `"gasdev clean"`, then run `npm uninstall rimraf`.
- The warning can be dropped in a later major release.
- The `rimraf` and `glob` notes in ADR 0005 no longer apply to projects built from the template.
