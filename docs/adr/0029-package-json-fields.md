# 29. package.json fields

- Status: Accepted
- Amends: [ADR 0005](0005-audit-overrides.md), [ADR 0006](0006-node-engines.md)
- Date: 2026-11-13

## Context

The `type`, `prettier`, `engines.node` and `overrides` fields of `package.json` were copied by hand into every project. They drifted: engines ranges fell below what the toolchain requires, and audit overrides were added to some projects and not others. `gasdev check` verified none of them, and `gasdev init` added none.

## Decision

`check` verifies these fields and `init` and `check --fix` add the missing ones. An existing value is never rewritten (ADR 0008); a differing value is reported only.

- `type` must be `"module"` for both presets.
- `prettier` must be `"gasdev/prettier"`, except in gasdev itself, which keeps its inline config.
- `engines.node` is read from gasdev's own `package.json` at runtime. A project's range must be a subset of it (`semver.subset`); a missing or invalid range is drift. `init` adds gasdev's range only when `engines.node` is absent and keeps other `engines` keys.
- `overrides` come from `templates/<preset>/package.json`: `overrides` always, and `claspOverrides` when `@google/clasp` is in `dependencies` or `devDependencies`. Each expected key that is missing or differs is drift. Extra overrides are ignored. `init` adds missing keys and prints that `npm install` is needed to apply them.
- New keys are appended at the end of `package.json`, which is written once per run and only when it changed. A non-object `engines` or `overrides` stops `init` before any write.
- A test asserts that gasdev's own `overrides` equal the node template's merged overrides, so the template and ADR 0005 stay in sync.

## Consequences

- Removing an override from the template does not remove it from consumers, and `check` does not detect the stale entry.
- The `engines.node` range is now enforced as a subset of gasdev's, so raising gasdev's floor makes projects with a lower range fail `check` until they are updated.
- A project's own overrides are never touched.
