# 18. Fold the dev tools into one package

- Status: Accepted
- Date: 2026-11-07
- Supersedes: gas-dev-ci ADR 0001 (in part), 0006, 0007 (in part) and 0009
- Names follow [ADR 0019](0019-rename-to-gasdev.md).

## Context

`gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` share users with this package, and the tools had drifted. In particular, `gas-test run` called clasp from `PATH`, while `gas-dev-ci` ran the bundled binary through `resolveClaspBin`. Four packages meant four dependency lines, four version ranges and two clasp invocation styles for one project (gas-dev-ci ADR 0007 planned this fold).

## Decision

- **Flat subcommands.** `gasdev bundle`, `release`, `setup` and `deploy`. The dispatcher hands the arguments after the subcommand to the tool before its own strict argument parsing, so each tool keeps its flags, usage text and exit codes. There are no legacy bins.
- **Configuration under the package key.** `gasDevBundle`, `gasDevRelease` and `gasDevCi` become `gasdev.bundle`, `gasdev.release` and `gasdev.ci`. Inner shapes are unchanged. `gasdev check` only verifies that each key is an object; the command's own loader validates the contents.
- **Layout.** `src/bundle/`, `src/release/` and `src/ci/` (with `src/ci/setup/`), tests in matching `test/` directories. Public declarations live beside the code: `src/bundle/types.d.ts` and `src/ci/types.d.ts`.
- **Exports.** `gasdev/bundle` (`bundle`, `loadConfig`, `BundleError`) and `gasdev/ci` (`DeployError` and the step types). Release has no programmatic API and none is added.
- **clasp.** `@google/clasp` stays an optional peer, so libraries never install `googleapis`. It is also a devDependency of this package for the tests. Every command that runs clasp (`gas-test run`, `setup`, `deploy`) goes through `resolveClaspBin`; none relies on `PATH`.
- **Reusable workflow.** `.github/workflows/gas-deploy.yml` lives in this repository and runs `npx --no-install gasdev deploy`. Callers pin an exact tag (`yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0`). There is no moving major tag, which supersedes gas-dev-ci ADR 0009; the tags ruleset is unchanged.
- **Semver-covered surface**, carried from gas-dev-ci ADR 0007 and renamed. Changes to these require a major release:
  - The `setup` and `deploy` commands, their flags and exit codes (0 success, 1 failure, 2 invalid usage, 130 cancelled prompt).
  - The environment variables `CLASPRC_JSON`, `GAS_SCRIPT_ID` and `GAS_DEPLOYMENT_ID`.
  - The reusable workflow's path, inputs, secret and `url` output.
  - The `gasdev.ci` key in `package.json` (`title`, `steps`).
  - The `DeployError` export with its declarations, and the `./package.json` export.
  - Not covered: clasp's output and the internal modules under `src/`.

## Clasp resolution differs between commands

Amended by ADR 0020.

The commands do not resolve clasp from the same place:

- `gasdev gas-test run` resolves from the project's `node_modules` first, then from this package.
- `gasdev setup` and `gasdev deploy` (`src/ci/clasp.js`) resolve only relative to this package.

In a normal install the two agree, because clasp is an optional peer that the project installs next to `gasdev`. They differ when clasp is nested under another location or hoisted away from this package. Deploy was left unchanged to keep the folded code identical to its tested source; aligning it to project-first is a possible follow-up.

## Alternatives considered

- Keep four packages: rejected. The drift and the repeated install and migration cost are what this removes.
- Separate branches per tool: rejected. Each fold edits the same dispatcher, `package.json`, key list and README.

## Consequences

- One dependency line and one version range per project.
- Consumers migrate once, to 3.0; the README has a migration section.
- The source repositories are archived after the release.
- Deploy's clasp lookup is package-relative, so a clasp that only the project can see is not found by `deploy`.
