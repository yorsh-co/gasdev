# Changelog

---

## [Unreleased]

---

## [3.0.0] - 2026-11-07

### Added

- `gasdev bundle`, `gasdev release`, `gasdev setup` and `gasdev deploy` subcommands, folding in gas-dev-bundle, gas-dev-release and gas-dev-ci; the `gasdev/bundle` and `gasdev/ci` exports; and a reusable `gas-deploy` workflow; see ADRs 0010-0019
- Legacy `gasDevConfig`, `gasDevBundle`, `gasDevRelease` and `gasDevCi` package.json keys fail with an error naming the replacement and pointing to "Migrating to 3.0"

### Changed

- **BREAKING:** the package is renamed to `gasdev` and the `gas-dev-config` binary to `gasdev`; see "Migrating to 3.0" in the README
- **BREAKING:** configuration lives under the `gasdev` package.json key, with `gasdev.bundle`, `gasdev.release` and `gasdev.ci` replacing the separate tool keys
- **BREAKING:** requires Node ^22.15.0, ^24.0.0 or >=26.0.0 (was ^22.13.0, ^24.0.0 or >=26.0.0); see ADR 0021
- `gasdev gas-test run` resolves clasp from `node_modules`
- A spawned test covers `gasdev gas-test run`'s install hint when `@google/clasp` cannot be resolved
- `@google/clasp` is a devDependency, with a `gaxios` override
- Dev-only: a package-wide v8 coverage gate (`npm run test:coverage`, ratchet thresholds) now runs in `npm run check`, and `gasdev check` expects that script when checking gasdev itself; consumer projects are unaffected
- gh plumbing, ruleset reads, and the `gh release` view/create calls are shared in `src/gh.js` by the release checks and `gasdev github`; `gasdev release` now reports a missing gh with the shared install hint
- `gasdev setup` and `gasdev deploy` resolve clasp from the project's `node_modules` first, falling back to the one next to gasdev, as `gas-test run` does; see ADR 0020
- The `gas-dev-*` tools table lists `gas-dev-ci`, which absorbs the `gas-dev-deploy` setup wizard, instead of `gas-dev-deploy`
- Dev-only: a comment in `bin/check.js` notes that the self-test rewrite depends on the scripts template's `check` wording
- Dev-only: a test covers `gasdev release` falling back to gh's exit status when `gh release create` fails without stderr
- **BREAKING:** `gasdev deploy` errors are prefixed with `gasdev:`, matching `setup` and the other commands
- README describes gasdev as one tool, with a Mermaid flow from release to deploy, and drops legacy and standalone-package wording
- README: table of contents, back-to-top links, and About / Getting started / Tool reference / Contributing grouping, plus a Quick start
- `gasdev deploy` prints the clasp it runs (`Using clasp: <path>`); see ADR 0022
- Dev-only: coverage includes spawned `bin/*` and helper processes (`autoAttachSubprocess`), with thresholds ratcheted to 78/69/73/78
- README is reorganised by task, with key terms, deduplicated config rules, unified exit code tables, and the 3.0 migration guide moved to `docs/migrating-to-3.0.md`

### Fixed

- The 3.0 migration guide lists every manual edit in order, including all tsconfig files, `eslint.config.js`, `engines.node` and generated files, and ends with a check
- The 3.0 migration guide lists the `gas-dev-config/test` to `gasdev/test` specifier in step 5 and adds a grep for camelCase leftovers to step 10
- The 3.0 migration guide notes prerelease ranges, adds a `gasdev check --fix` step, covers code that reads the old keys, and clarifies step 5's scope and the nested config shape in docs
- `gasdev github` reports non-JSON gh output as an error instead of crashing
- README lists `gasdev setup` and `gasdev deploy`, not only `gasdev gas-test run`, as needing `@google/clasp`
- README documents the `bundle`, `release` and `ci` keys under Config check and the legacy-key error under Migrating to 3.0
- Dev-only: clasp-bin tests build expected `package.json` file URLs portably, so they pass on Windows
- `gasdev --help` lists `bundle`, `release` and `ci` among the validated `gasdev` keys
- README corrections where statements contradicted the code: no nested `gasdev.release` examples, the ruleset check applies only with `githubRelease`, `npm install` and the preset come before `init`, semver range wording, the dist branch versus the git-flow release branch, and committing `appsscript.example.json`
- README setup steps name `eslint`, `prettier`, `typescript` and the optional `@google/clasp` as the npm peer dependencies to install with `gasdev`

### Removed

- The `gas-dev-bundle` dependency

---

## [2.2.0] - 2026-11-06

### Added

- `gas-dev-config github [--fix]` reports GitHub ruleset drift against the shared `templates/github/rulesets/` templates through `gh`; `--fix` creates missing and updates drifted rulesets and never deletes extras; see [ADR 0009](docs/adr/0009-github-rulesets.md)

---

## [2.1.0] - 2026-11-06

### Added

- `gas-dev-config init` scaffolds the ignore files, `.github/dependabot.yml` and the missing required scripts without overwriting anything; see [ADR 0008](docs/adr/0008-init-command.md)

### Changed

- Both gitignore presets now require `.claude/worktrees/`, `.claude/plans/`, `.claude/handoff/` and `.env`: `check` reports them until `check --fix` is run; see ADR 0007
- README lists `gas-dev-deploy` among the `gas-dev-*` tools

---

## [2.0.1] - 2026-11-04

### Changed

- Requires `gas-dev-bundle` `^2.0.0` (was `^1.1.0`), used by `gas-test build`

---

## [2.0.0] - 2026-11-04

### Added

- `npm run test:network` runs CLI tests of `peers sync [--check]` against GitHub; `npm test` skips them unless `GAS_DEV_CONFIG_NETWORK=1`

### Changed

- **Breaking:** requires Node ^22.13.0, ^24.0.0 or >=26.0.0 (was >=20.10.0)

### Fixed

- Override transitive `minimatch` to `^11.0.1` (GHSA-g3hv-75wg-m249), lifting `brace-expansion` to 5.0.12; see ADR 0005

---

## [1.10.0] - 2026-11-04

### Added

- `gas-dev-config peers sync [--check]` syncs `src/internal/<peer>.peer.types.d.ts` from the peer's highest satisfying `vX.Y.Z` tag, dropping the `@version` line: `--check` reports drift

### Changed

- `--check` is also valid with `peers sync`
- `semver` is now a runtime dependency

---

## [1.9.0] - 2026-11-04

### Added

- `.prettierignore` templates list `.claude/handoff`

### Changed

- `gas-dev-config check` requires `.claude/handoff` in a consumer's `.prettierignore`: consumers add it with `check --fix`

---

## [1.8.0] - 2026-11-03

### Added

- `check --fix` appends missing template lines to `.gitignore` and `.prettierignore`, creating them if absent

---

## [1.7.0] - 2026-11-03

### Added

- ESLint presets ignore `.claude/worktrees/`
- `.prettierignore` templates list `.claude/worktrees` and `.claude/plans`

### Changed

- `gas-dev-config check` requires both `.claude/worktrees` and `.claude/plans` in a consumer's `.prettierignore`: consumers must add both lines when upgrading

---

## [1.6.0] - 2026-10-31

### Added

- `gasDevConfig.html` (gas preset, requires `loadOrder`): `{ entry, out, name }` entries for the HTML build, validated by `gas-dev-config check`, which also reports a missing entry, an `out` absent from `loadOrder` and a stale or missing generated file as drift
- `gas-dev-config html [--check]`: inlines local `<link rel="stylesheet">` and `<script src>` (transpiling the `.ts` next to a referenced `.js`, without type-checking) into a page, removes `data-dev-only` elements, rejects code containing `</script` or `</style`, and writes the page as a string constant in a generated `.ts` file; `--check` writes nothing and exits `1` when a file is stale

---

## [1.5.0] - 2026-10-31

### Added

- `gas` ESLint preset forbids `async` functions and `await` (including `for await`) in `src/` and `gas-test/` Apps Script sources: Apps Script's push-time parser rejects both, so one async function broke `clasp push`. Browser (`web.files`), `test/` and `scripts/` files and the `node` preset are unaffected
- README: overview of the three gas-dev-\* tools, their roles and how the `gasDevConfig` → `gasLibrary` metadata connects them

---

## [1.4.1] - 2026-10-30

### Fixed

- `tsconfig/gas.json` targets ES2020 instead of ES2021, and `gas-test build` transpiles to ES2020: Apps Script's push-time parser rejects ES2021 syntax (`||=`, `&&=`, `??=`, numeric separators), so builds containing it could not be pushed. `lib` stays ES2021

---

## [1.4.0] - 2026-10-30

### Changed

- `gas-dev-config check` requires the `test:gas:build` and `test:gas` scripts, with the values of the Apps Script test commands, when `gasDevConfig.gasTest` is configured

---

## [1.3.0] - 2026-10-28

### Added

- `gasDevConfig.gasTest` (gas preset, requires `loadOrder`): OAuth `scopes` and an optional `scriptId` for Apps Script tests, validated by `gas-dev-config check`
- Apps Script test runtime, `gas-dev-config/gas-test/runtime.js`: `test`, `info`, `assert` and the `runGasTests(spreadsheetId?)` entry point, with a lazily resolved spreadsheet (argument, `GAS_TEST_SPREADSHEET_ID` script property or active spreadsheet), a per-run sheet prefix, cleanup of its own and stale test sheets, execution-log output and base64-encoded results
- `tsconfig/gas-test.json` for type-checking `gas-test/*.ts` against `src/` and the runtime types
- ESLint `gas` preset: lints `gas-test/**/*.ts` as Apps Script global scripts when `gas-test/tsconfig.json` exists
- `gas-dev-config gas-test build [--out <file>]`: one self-contained script of the peers (fetched by `gas-dev-bundle`), the library in load order, the runtime and the tests, for pasting into the Apps Script editor
- `gas-dev-config gas-test run [--keep]`: pushes the build to a dedicated Apps Script project with clasp, runs `runGasTests` and reports each result; exits 1 on any failure
- `gas-dev-bundle` dependency; `@google/clasp` as an optional peer dependency

---

## [1.2.0] - 2026-10-28

### Added

- `gasDevConfig.loadOrder` (gas preset): source files under `src/` in load order, validated by `gas-dev-config check` (non-empty, unique, relative `.ts` paths that are not `.d.ts`); entries missing on disk are reported as drift
- `gasDevConfig.peers` (gas preset): optional sibling libraries mapped to version ranges, validated by `gas-dev-config check`
- `loadOrderFiles(root?)`, exported from `gas-dev-config/test`: returns the configured load order as `src/`-prefixed paths for `createGasLoader`

---

## [1.1.0] - 2026-10-27

### Added

- Test loader `createGasLoader({ files, exports, root })`, exported as `gas-dev-config/test`: transpiles Apps Script sources once and evaluates them in a fresh `node:vm` context per call, returning the requested globals; with option validation, clear errors for missing files and exports, and hand-written types (generic over the exports shape)
- Tests for the loader, including a TypeScript consumer type-check

---

## [1.0.0] - 2026-10-27

### Added

- Project scaffold: package manifest, Prettier, ESLint (flat config), TypeScript `checkJs` type-checking, Vitest and Dependabot for npm
- Shared Prettier config, exported as `gas-dev-config/prettier` (`singleQuote`; all other options are Prettier 3 defaults)
- Shared TypeScript configs, exported as `gas-dev-config/tsconfig/{gas,web,test,node}.json`, reproducing the options used across the gas-* projects
- Package `exports` map for the Prettier and TypeScript configs
- Tests that resolve the Prettier config from a `package.json` specifier and compile fixture projects extending each TypeScript config
- ESLint flat-config factory `gasEslint(options, ...extra)`, exported as `gas-dev-config/eslint`: `gas` preset (TypeScript GAS sources, Node ESM tests when `tsconfig.test.json` exists, `scripts/`, `peer/` and `dist/` ignored), `web` option for browser sources, `node` preset for plain JavaScript tooling, extra `ignores` and trailing configs, with option validation
- `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals` as dependencies; `eslint`, `prettier` and `typescript` as peer dependencies
- Tests resolving the factory's config per preset through the ESLint API and CLI, including an equivalence check against the gas-error configuration
- `gas-dev-config check` CLI (`bin` entry) that reports drift of `.gitignore`, `.prettierignore`, `.github/dependabot.yml` and the standard `package.json` scripts against per-preset templates (`gas`, `node`, selected by `"gasDevConfig": { "preset" }`, default `gas`); read-only, exits 1 on drift and 2 on invalid usage
- Tests for the check command covering each kind of drift, presets, option validation and CLI usage
- README: requirements, installation, Prettier, TypeScript, ESLint and config check usage, Dependabot and a migration guide for gas-* projects
