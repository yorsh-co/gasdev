# Migrating to 3.0

3.0 folds `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` into one package named `gasdev` ([ADR 0018](adr/0018-fold-dev-tools.md), [ADR 0019](adr/0019-rename-to-gasdev.md)). Migrate once, from whichever packages you use.

## Dependencies

Remove `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` from `devDependencies` and add:

```json
"gasdev": "github:yorsh-co/gasdev#semver:^3.0.0"
```

Add `@google/clasp` as a dev dependency where you run clasp (`gasdev gas-test run`, `setup`, `deploy`). It is an optional peer, so libraries that do not use it never install it.

## Scripts

| Before                                   | After                            |
| ---------------------------------------- | -------------------------------- |
| `gas-dev-config <command>`               | `gasdev <command>`               |
| `gas-dev-release`                        | `gasdev release`                 |
| `gas-dev-bundle`                         | `gasdev bundle`                  |
| `gas-dev-ci setup` / `gas-dev-ci deploy` | `gasdev setup` / `gasdev deploy` |

## `package.json` keys

| Before          | After            |
| --------------- | ---------------- |
| `gasDevConfig`  | `gasdev`         |
| `gasDevBundle`  | `gasdev.bundle`  |
| `gasDevRelease` | `gasdev.release` |
| `gasDevCi`      | `gasdev.ci`      |

Inner shapes are unchanged. `gasdev check` verifies that each key is an object.

A `package.json` that still has an old key is rejected with `package.json: "<old>" is no longer supported; move it to "<new>" (see the README section "Migrating to 3.0").`

## Imports and config references

- `gas-dev-config/*` becomes `gasdev/*` in `prettier`, the ESLint import and the tsconfig `extends` (for example `gasdev/tsconfig/gas.json`).
- `gas-dev-bundle` becomes `gasdev/bundle`.
- `gas-dev-ci` becomes `gasdev/ci`.

## Workflow

Point the caller at the new repository and exact tag:

```yaml
uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0
```

There is no moving major tag; bump the tag on each release.

## Other changes

- `gasdev gas-test run` no longer needs clasp on `PATH`; it resolves it from `node_modules`.
- Cache paths move to `node_modules/.cache/gasdev`. Delete the old `node_modules/.cache/gas-dev-config` and `gas-dev-bundle` directories.
- Contributors: the environment variable `GAS_DEV_CONFIG_NETWORK` is now `GASDEV_NETWORK`.
- Node.js `^22.15.0` is now required (was `^22.13.0`); see [ADR 0021](adr/0021-node-22-15-floor.md).
