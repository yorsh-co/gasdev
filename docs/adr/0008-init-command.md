# 8. Init command

- Status: Accepted
- Amended by: [ADR 0030](0030-project-type.md)
- Date: 2026-11-06

## Context

Starting a project meant copying `.github/dependabot.yml` and the standard `package.json` scripts by hand from the README, then running `check --fix` for the ignore files. [ADR 0002](0002-check-fix-ignore-files.md) limits `check --fix` to appending lines to `.gitignore` and `.prettierignore`.

## Decision

`gas-dev-config init` is a separate command that scaffolds a project and never overwrites:

- Ignore files: it applies the same fix as `check --fix` (append missing template lines, create missing files).
- Dependabot: it creates `.github/dependabot.yml` from the template only when the file is absent.
- Scripts: it adds the required scripts that are missing, plus the `gasTest` ones when `gasTest` is configured, at the end of `scripts` in template order. It never changes an existing script. `package.json` is rewritten with `JSON.stringify(pkg, null, 2)` and a final newline, and only when a script was added.
- `present` scripts (`build`, `build:watch`, `typecheck` on `gas`) have no template value, so `init` cannot create them. `check` keeps reporting them.
- It validates `package.json` and `gasDevConfig` first, so an invalid config writes nothing. It then prints the normal check report, and the exit code reflects the drift that remains.
- `--fix` stays valid only with `check`; `init` takes no arguments.

Rejected: widening `check --fix` to create dependabot and scripts. That would require amending ADR 0002 and blur the read-mostly maintenance command with a scaffolding one.

## Consequences

- `init` is safe to rerun: a second run makes no changes.
- `present` scripts stay manual.
- `check --fix` stays the upgrade path for new template lines.
