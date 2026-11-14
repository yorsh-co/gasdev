# 2. Check --fix for ignore files

- Status: Accepted
- Amended by: [ADR 0031](0031-deploy-workflow-version.md)
- Date: 2026-11-03

## Context

Prettier and git cannot extend an ignore file from a package, so new template lines meant a manual edit in every consumer on each upgrade (see ADR 0001). `gas-dev-config check` was documented as never writing, so it could only report the missing lines.

## Decision

`gas-dev-config check --fix` writes to the project, narrowed as follows:

- Scope: it writes only `.gitignore` and `.prettierignore`. Dependabot, scripts, `loadOrder` and html drift stay report-only.
- Append only: it never reorders, rewrites or removes existing lines, and keeps lines that are not in the template. Missing entries go at the end of the file, in template order.
- Formatting: if the file does not end with a newline, one is added before the appended lines. If the file uses CRLF, appended lines use CRLF.
- Missing file: it is created with the template contents, written as-is.
- Output: each change is printed on stdout as `<file>: added <entry>` or `<file>: created`. The normal report follows, and the exit code reflects the drift that remains.

`--fix` validates `package.json` and `gasDevConfig` before writing, so an invalid config changes no files. It is valid only with `check`.

## Consequences

- `check` without `--fix` stays read-only and safe for CI.
- Picking up new template lines after an upgrade is one command: `npx gas-dev-config check --fix`. A second run makes no changes.
- Other drift needs a human, because those files are compared whole and can carry intentional local content.
