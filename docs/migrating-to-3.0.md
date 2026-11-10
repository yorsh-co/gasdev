# Migrating to 3.0

3.0 folds `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` into one package named `gasdev` ([ADR 0018](adr/0018-fold-dev-tools.md), [ADR 0019](adr/0019-rename-to-gasdev.md)). Migrate once, from whichever packages you use.

> [!IMPORTANT]
> Every step is a manual edit. `gasdev check --fix` and `gasdev init` add missing ignore lines, files and scripts, but never change an existing script, key or config file. `gasdev check` reports what is left.

Work through the steps in order, then run the [final check](#10-check-the-migration).

## 1. Node.js

Node.js `^22.15.0` is now required (was `^22.13.0`); the full range is `^22.15.0 || ^24.0.0 || >=26.0.0` ([ADR 0021](adr/0021-node-22-15-floor.md)). If `engines.node` in your `package.json` allows an older 22.x, raise it to match.

## 2. Dependencies

Remove `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` from `devDependencies` and add:

```json
"gasdev": "github:yorsh-co/gasdev#semver:^3.0.0"
```

Before 3.0.0 is tagged, npm ranges skip prereleases; to test a beta, use `#semver:^3.0.0-beta.N`.

Add `@google/clasp` as a dev dependency where you run clasp (`gasdev gas-test run`, `setup`, `deploy`). It is an optional peer, so libraries that do not use it never install it.

Run `npm install`. Cache paths move to `node_modules/.cache/gasdev`, so delete the old `node_modules/.cache/gas-dev-config` and `node_modules/.cache/gas-dev-bundle` directories.

## 3. `package.json` keys

Rename whichever of these keys you have:

| Before          | After            |
| --------------- | ---------------- |
| `gasDevConfig`  | `gasdev`         |
| `gasDevBundle`  | `gasdev.bundle`  |
| `gasDevRelease` | `gasdev.release` |
| `gasDevCi`      | `gasdev.ci`      |

Inner shapes are unchanged. `gasdev check` verifies that each key is an object.

Code that reads these keys from `package.json` (for example `JSON.parse(readFileSync('package.json')).gasDevConfig`) must read the new paths too; it breaks at runtime, not at typecheck. List it with:

```sh
grep -rnE "gasDev(Config|Bundle|Release|Ci)" --exclude-dir={node_modules,.git} --exclude={package-lock.json,CHANGELOG.md} .
```

The old keys sit at the top level; the new ones nest inside the single `gasdev` object. For example:

```jsonc
// Before
"prettier": "gas-dev-config/prettier",
"gasDevConfig": {
  "loadOrder": ["gas-lock.types.ts", "gas-lock.constants.ts"]
},
"gasDevRelease": {
  "githubRelease": true
}

// After
"prettier": "gasdev/prettier",
"gasdev": {
  "loadOrder": ["gas-lock.types.ts", "gas-lock.constants.ts"],
  "release": {
    "githubRelease": true
  }
}
```

A `package.json` that still has an old key is rejected with `package.json: "<old>" is no longer supported; move it to "<new>" (see the README section "Migrating to 3.0").`

## 4. Scripts

| Before                                   | After                            |
| ---------------------------------------- | -------------------------------- |
| `gas-dev-config <command>`               | `gasdev <command>`               |
| `gas-dev-release`                        | `gasdev release`                 |
| `gas-dev-bundle`                         | `gasdev bundle`                  |
| `gas-dev-ci setup` / `gas-dev-ci deploy` | `gasdev setup` / `gasdev deploy` |

Edit every script that calls a `gas-dev-*` binary by hand. `gasdev init` only adds scripts that are missing, so it leaves these unchanged, and `gasdev check` reports each one as `scripts.<name> differs`. For a library:

```diff
-"release": "gas-dev-release",
+"release": "gasdev release",
-"check": "npm run format:check && npm run lint && npm run typecheck && npm run test && gas-dev-config check",
+"check": "npm run format:check && npm run lint && npm run typecheck && npm run test && gasdev check",
-"test:gas:build": "gas-dev-config gas-test build",
+"test:gas:build": "gasdev gas-test build",
-"test:gas": "gas-dev-config gas-test run"
+"test:gas": "gasdev gas-test run"
```

The expected value of each required script is listed under [What is checked](../README.md#what-is-checked) in the README.

## 5. Config files and imports

Config files and source code still reference the old packages, which `npm install` removed in [step 2](#2-dependencies). Until they are updated, `tsc` and `eslint` fail to resolve them. List them:

```sh
grep -rnE "gas-dev-(config|bundle|ci)" --exclude-dir={node_modules,.git} --exclude={package-lock.json,CHANGELOG.md} .
```

Then, in each config file and import it lists, replace the package name in the module specifier and keep the rest of the path. Docs and comments are handled in [step 10](#10-check-the-migration):

| Before                    | After             | Where                                                                   |
| ------------------------- | ----------------- | ----------------------------------------------------------------------- |
| `gas-dev-config/tsconfig` | `gasdev/tsconfig` | `extends` in every `tsconfig*.json`, including `gas-test/tsconfig.json` |
| `gas-dev-config/eslint`   | `gasdev/eslint`   | the import in `eslint.config.js`                                        |
| `gas-dev-config/test`     | `gasdev/test`     | the test-loader import in Vitest setup or harness files                 |
| `gas-dev-bundle`          | `gasdev/bundle`   | code that imports the bundler                                           |
| `gas-dev-ci`              | `gasdev/ci`       | code that imports the deploy API                                        |

For example:

```diff
 // tsconfig.json
-"extends": "gas-dev-config/tsconfig/gas.json",
+"extends": "gasdev/tsconfig/gas.json",

 // gas-test/tsconfig.json
-"extends": "gas-dev-config/tsconfig/gas-test.json",
+"extends": "gasdev/tsconfig/gas-test.json",

 // eslint.config.js
-import { gasEslint } from 'gas-dev-config/eslint';
+import { gasEslint } from 'gasdev/eslint';
```

The preset file name (`gas.json`, `test.json`, `gas-test.json`, `node.json` or `web.json`) stays the same. The `prettier` key is covered in [step 3](#3-packagejson-keys).

## 6. Generated files

Generated files carry the name of the command that wrote them, so regenerate them:

- Apps that bundle libraries: run `npx gasdev bundle`. The header now reads `// Generated by gasdev bundle`.
- Libraries with `gasdev.html`: run `npx gasdev html`. The header now reads `` // Generated by `gasdev html` ``.

## 7. Workflow

Point the caller at the new repository and exact tag:

```yaml
uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0
```

There is no moving major tag; bump the tag on each release.

The workflow runs `npx --no-install gasdev deploy`, so the web app needs `gasdev` and `@google/clasp` in its own `devDependencies` (see [step 2](#2-dependencies)).

## 8. Behaviour changes

- `gasdev gas-test run` no longer needs clasp on `PATH`; it resolves it from `node_modules`. `gasdev setup` and `gasdev deploy` resolve it from the project's `node_modules` first, then from the one next to gasdev ([ADR 0020](adr/0020-project-first-clasp.md)).
- `gasdev deploy` prints the clasp it runs (`Using clasp: <path>`), and its errors are prefixed with `gasdev:`, like the other commands.
- Contributors: the environment variable `GAS_DEV_CONFIG_NETWORK` is now `GASDEV_NETWORK`.

## 9. Ignore lines and scripts

Run `npx gasdev check --fix`. It appends the `.gitignore` and `.prettierignore` lines that gasdev 3 requires and you are missing, such as `.claude/plans/` and `.env`. It also adds missing required scripts, creates `.github/dependabot.yml` if absent, and adds a failing placeholder for a missing `build`, `build:watch` or `typecheck`, which `check` reports as a warning until you replace it. It does not change existing lines or scripts, so fix what it still reports by hand.

## 10. Check the migration

From the project root:

```sh
grep -rn "gas-dev" --exclude-dir={node_modules,.git} --exclude={package-lock.json,CHANGELOG.md} .
grep -rnE "gasDev(Config|Bundle|Release|Ci)" --exclude-dir={node_modules,.git} --exclude={package-lock.json,CHANGELOG.md} .
npm run check
```

Both `grep`s should print nothing. Comments and docs that still name the old tools count too. Rewrite config examples in docs to the nested shape from [step 3](#3-packagejson-keys), not by renaming the key. `npm run check` runs `gasdev check` and must pass. For a library with Apps Script tests, also run `npm run test:gas`.
