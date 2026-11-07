<a id="readme-top"></a>

# gasdev

## Local development toolkit for Google Apps Script: shared TypeScript, ESLint and Prettier config, testing, builds, releases and CI deployment.

<details>
<summary>Table of contents</summary>

- [About gasdev](#about-gasdev)
  - [Features](#features)
  - [The gasdev tools](#gasdev-tools)
- [Getting started](#getting-started)
  - [Requirements](#requirements)
  - [Install](#install)
  - [Quick start](#quick-start)
- [Tool reference](#tool-reference)
  - [Prettier](#prettier)
  - [TypeScript](#typescript)
  - [ESLint](#eslint)
  - [Test loader](#test-loader)
  - [Apps Script tests](#apps-script-tests)
  - [HTML build](#html-build)
  - [Bundle](#bundle)
  - [Release](#release)
  - [Deploy a web app](#deploy-a-web-app)
  - [Config check](#config-check)
  - [Dependabot](#dependabot)
  - [GitHub rulesets](#github-rulesets)
- [Migrating an existing project](#migrating-an-existing-project)
- [Migrating to 3.0](#migrating-to-30)
  - [Dependencies](#dependencies)
  - [Scripts](#scripts)
  - [`package.json` keys](#packagejson-keys)
  - [Imports and config references](#imports-and-config-references)
  - [Workflow](#workflow-1)
  - [Other changes](#other-changes)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

</details>

## About gasdev

> [!NOTE]
> `gasdev` is development tooling. It is installed as a dev dependency and is never pushed to Apps Script.

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

### Features

- One Prettier config, five TypeScript presets and one ESLint flat-config factory, so a tooling change is made once and rolled out by bumping a version
- Uses each tool's own extension mechanism (shared Prettier config, tsconfig `extends`, exported ESLint factory) instead of copying files
- ESLint `gas` preset for Apps Script TypeScript, with a `web` option for browser sources and a `node` preset for plain JavaScript tooling
- `gasdev check` reports drift of the files that cannot be extended: `.gitignore`, `.prettierignore`, `.github/dependabot.yml` and the standard `package.json` scripts
- The check is read-only unless you pass `--fix`, which only appends missing template lines to `.gitignore` and `.prettierignore`
- `gasdev init` scaffolds a new project: ignore files, `.github/dependabot.yml` and the missing required scripts, without overwriting anything
- `gasdev/test` loads Apps Script sources, which are global-scope scripts without exports, into a fresh `node:vm` context for Vitest suites
- `gasdev gas-test` builds a library's tests into one script that runs in real Apps Script, from the editor or through clasp
- `gasdev html` inlines a page edited as `.html`, `.css` and TypeScript into one generated `.ts` string constant, so an HtmlService UI ships as a single Apps Script source file
- `gasdev peers sync` writes the peer libraries' type declarations into `src/internal/` from their tagged releases, so they never drift from hand copies
- `gasdev bundle` bundles gas-\* libraries from their `dist/vX.Y.Z` tags into one global script file, in load order, for an Apps Script project that uses several libraries
- `gasdev release` publishes a library's build to one or more dist branches with `<branch>/vX.Y.Z` tags in a single atomic push, after preflight checks, with a `--dry-run` preview
- `gasdev github` reports drift of the repository's GitHub rulesets from the shipped templates and, with `--fix`, creates or updates them
- `gasdev setup` and `gasdev deploy` take an Apps Script web app from a guided first-time setup to clasp-based CI deployment, with a reusable GitHub Actions workflow
- Plain ESM JavaScript, no build step

<a id="gasdev-tools"></a>

### The gasdev tools

Development tools for Apps Script libraries and projects. None of them is ever pushed to Apps Script.

| Tool                    | Installed by                             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gasdev` (this package) | Library authors and Apps Script projects | Prettier, TypeScript and ESLint presets; `check` for config drift; the `gasdev` key (`loadOrder`, `peers`, `gasTest`, `html`, `bundle`, `release`, `ci`); the Vitest loader; Apps Script tests (`gas-test build`/`run`); the HTML build (`html`); bundling gas-\* libraries (`bundle`); peer type sync (`peers sync`); publishing the build to the `dist` branch with tags (`release`); GitHub rulesets (`github`); guided web-app setup (`setup`) and CI deployment (`deploy`, reusable workflow) |

It is a dev dependency installed from GitHub with a `#semver:` range. A library uses it for presets and `release`; a project consuming several libraries uses `gasdev bundle` (a single library can be added with `git subtree` instead); a project that deploys a web app uses `gasdev setup` and `gasdev deploy`.

The tools are connected by one piece of metadata, declared once in the library:

```text
library package.json     dist/vX.Y.Z package.json     consumer project
"gasdev": {              "gasLibrary": {              src/lib/gas-libraries.js
  "loadOrder": [...],  ──►  "loadOrder": [...],  ──►    (libraries and their files
  "peers": {...}            "peers": {...}               in load order)
}                        }
validated by             written by                   written by
gasdev check             gasdev release               gasdev bundle
```

`gasdev gas-test build` uses the same bundler as `gasdev bundle` to bundle a library's peers ahead of the library under test.

A library release therefore runs: `npm run check` (presets, tests and `gasdev check`), `npm run test:gas` on the release branch (Apps Script tests, manual), then `npm run build:release` (build, then `gasdev release`).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting started

### Requirements

- Node.js ^22.15.0, ^24.0.0 or >=26.0.0
- Peer dependencies, which stay direct dev dependencies of your project so their binaries are linked:
  - `eslint` `^10.7.0`
  - `prettier` `^3.9.6`
  - `typescript` `^5.9.3`
  - `@google/clasp` `^3.4.1`, optional: needed by `gasdev gas-test run`, `gasdev setup` and `gasdev deploy`
- `@types/google-apps-script`, and `@types/node` for projects with tests, as your own dev dependencies

> [!IMPORTANT]
> The presets reference `types` such as `google-apps-script` and `node`. TypeScript resolves them from your project's `node_modules/@types`, not from this package, so they must be installed by the consumer. Relying on hoisting would be fragile.

### Install

Add it to your project's `package.json` as a dev dependency, pinned to a release tag, together with the peer dependencies:

```json
{
  "devDependencies": {
    "gasdev": "github:yorsh-co/gasdev#semver:^3.0.0",
    "eslint": "^10.7.0",
    "prettier": "^3.9.6",
    "typescript": "^5.9.3",
    "@types/google-apps-script": "^2.0.13",
    "@types/node": "^22.20.5"
  }
}
```

`@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals` are dependencies of `gasdev`. Remove them from your own `devDependencies`.

### Quick start

For a new project:

1. Add `gasdev` and the peer dependencies as dev dependencies (see [Install](#install)).
2. Run `npx gasdev init` to create the ignore files, `.github/dependabot.yml` and the missing required scripts.
3. Add the config `init` does not create: [Prettier](#prettier), [TypeScript](#typescript) and [ESLint](#eslint). Add the `build`, `build:watch` and `typecheck` scripts, which `init` only expects to exist, and `rimraf` as a dev dependency for the `clean` script.
4. Run `npm install`, then `npm run check`.

For an existing project, follow [Migrating an existing project](#migrating-an-existing-project).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Tool reference

Reference for each gasdev tool, in the order of a typical project.

### Prettier

Point the `prettier` key of your `package.json` at the shared config:

```json
{
  "prettier": "gasdev/prettier"
}
```

The config is `{ "singleQuote": true }`; every other option is a Prettier 3 default.

Delete `.prettierrc.json`. A `prettier` key in `package.json` takes precedence over `.prettierrc.json`, so a leftover file was already being ignored.

### TypeScript

Extend one of the presets from `gasdev/tsconfig/`:

| Preset          | Use for                         | Sets                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gas.json`      | Apps Script backend sources     | `target` `ES2020`, `lib` `ES2021`, `types` `["google-apps-script"]`, `declaration`, `noEmitOnError`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedSideEffectImports`, `skipLibCheck`, `forceConsistentCasingInFileNames` |
| `web.json`      | Browser client sources          | Extends `gas.json`; `lib` `ES2021`, `DOM`, `DOM.Iterable`; `types` `[]` (no GAS types)                                                                                                                                                                                                                 |
| `test.json`     | Vitest suites                   | Extends `gas.json`; `module` `ESNext`, `moduleResolution` `bundler`, `noEmit`, `declaration` off, `types` `["node", "google-apps-script"]`                                                                                                                                                             |
| `gas-test.json` | Apps Script tests (`gas-test/`) | Extends `gas.json`; `noEmit`, `declaration` off, `types` `["google-apps-script", "gasdev/gas-test/runtime"]`                                                                                                                                                                                           |
| `node.json`     | Plain JavaScript Node tooling   | `target` `ES2022`, `module` and `moduleResolution` `nodenext`, `types` `["node"]`, `allowJs`, `checkJs`, `noEmit`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck`                                                                                                  |

`gas.json` targets ES2020 because Apps Script checks syntax on push with a parser that rejects ES2021 syntax such as `||=`, `??=` and `1_000`. BigInt literals (`1n`) are rejected too and are not downleveled, so avoid them. `lib` stays ES2021, which the V8 runtime provides. `web.json` inherits the target.

Path options (`rootDir`, `outDir`, `include`, `exclude`) stay in your own files: TypeScript resolves them relative to the file that declares them, so they cannot live in the shared preset.

A library, `tsconfig.json`:

```json
{
  "extends": "gasdev/tsconfig/gas.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Its tests, `tsconfig.test.json`:

```json
{
  "extends": "gasdev/tsconfig/test.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

A gas-webapp, `tsconfig.json` for the backend and `tsconfig.frontend.json` for the browser client:

```json
{
  "extends": "gasdev/tsconfig/gas.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/web/**/*"]
}
```

```json
{
  "extends": "gasdev/tsconfig/web.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/web/**/*.ts", "src/shared/**/*.ts"]
}
```

### ESLint

`gasdev/eslint` exports `gasEslint(options, ...extra)`, which returns a flat config array:

```js
// eslint.config.js
import { gasEslint } from 'gasdev/eslint';

export default gasEslint();
```

#### Options

All options are optional. Unknown options and invalid values throw a `TypeError` naming the option.

| Option         | Default             | Description                                                                                      |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `preset`       | `'gas'`             | `'gas'` for Apps Script TypeScript projects, `'node'` for plain JavaScript Node tooling          |
| `ignores`      | `[]`                | Extra ignore globs, added to the preset's                                                        |
| `web`          | none                | Browser sources, linted apart from the GAS files: `{ files, tsconfig }`. Not supported by `node` |
| `web.files`    | required with `web` | Non-empty array of globs of browser (DOM) sources                                                |
| `web.tsconfig` | required with `web` | tsconfig used for type-aware linting of those files                                              |
| `cwd`          | `process.cwd()`     | Project root, used to detect `tsconfig.test.json` and `gas-test/tsconfig.json`                   |

Any further arguments are flat configs applied after the preset and before Prettier, for one-off rules.

#### What the `gas` preset lints

- `@eslint/js` and `typescript-eslint` recommended rules
- `src/**/*.ts` as Apps Script files: `sourceType: 'script'` (the files share one global scope), type-aware linting with `./tsconfig.json`, unused-variable rules off
- With `web`: `web.files` are excluded from the Apps Script block and linted as browser scripts (browser globals, `web.tsconfig`, unused-variable rules off)
- `test/**/*.ts` as Node ES modules with `./tsconfig.test.json`, only when `tsconfig.test.json` exists in `cwd`
- `async` functions and `await` (including `for await`) are errors in `src/` and `gas-test/` Apps Script files, via `no-restricted-syntax`: Apps Script rejects both on push. A `no-restricted-syntax` entry in an extra config for the same files replaces this one, so repeat the selectors (`:function[async=true]`, `AwaitExpression`, `ForOfStatement[await=true]`) there. Web, `test/` and `scripts/` files are unaffected
- `gas-test/**/*.ts` as Apps Script files (`sourceType: 'script'`, the `test`, `info`, `assert` and `runGasTests` globals, type-aware linting with `./gas-test/tsconfig.json`, unused-variable rules off), only when `gas-test/tsconfig.json` exists in `cwd`; they are not Node test modules
- `scripts/**/*.js` as Node ES modules
- `dist/`, `.worktrees/`, `.claude/worktrees/` and `peer/` ignored; `peer/` holds ambient declarations that are outside the tsconfig `include`
- `eslint-config-prettier` last, so formatting rules never conflict with Prettier

The `node` preset lints `**/*.js` as Node ES modules with `@eslint/js` recommended rules, ignores `.worktrees/`, `.claude/worktrees/` and `node_modules/`, and also ends with `eslint-config-prettier`.

#### Examples

A library:

```js
import { gasEslint } from 'gasdev/eslint';

export default gasEslint();
```

A gas-webapp with a browser client:

```js
import { gasEslint } from 'gasdev/eslint';

export default gasEslint({
  web: {
    files: ['src/web/**/*.ts'],
    tsconfig: './tsconfig.frontend.json',
  },
});
```

Node tooling (a CLI or a build script):

```js
import { gasEslint } from 'gasdev/eslint';

export default gasEslint({ preset: 'node' });
```

A one-off rule, passed as an extra flat config:

```js
import { gasEslint } from 'gasdev/eslint';

export default gasEslint(
  { ignores: ['generated/**'] },
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
);
```

### Test loader

Apps Script sources share one global scope and have no `import` or `export`, so a test cannot import them. `createGasLoader` from `gasdev/test` transpiles the files once, concatenates them in load order and compiles a single `node:vm` script. Each call of the returned function evaluates it in a fresh context built from the globals you pass, so no state leaks between tests.

```ts
// test/harness.ts
import { createGasLoader } from 'gasdev/test';

const load = createGasLoader({
  files: ['src/gas-logger.types.ts', 'src/gas-logger.class.ts'],
  exports: ['GasLogger'],
});

const { GasLogger } = load({ console, SpreadsheetApp, Logger });
```

| Option    | Default         | Description                                                                 |
| --------- | --------------- | --------------------------------------------------------------------------- |
| `files`   | required        | Non-empty array of source files in load order; later files see earlier ones |
| `exports` | required        | Non-empty array of global names (classes, functions, constants) to return   |
| `root`    | `process.cwd()` | Directory the `files` are resolved against                                  |

- Unknown options and invalid values throw a `TypeError` naming the option.
- A source file that cannot be read throws at creation, naming its resolved path.
- An `exports` name that the sources do not define throws when loading, naming it.
- Files are read and transpiled once, at creation; `load` only runs the compiled script.

#### Load order from `package.json`

Keep the load order in one place: `gasdev.loadOrder` in `package.json` (see [Config check](#config-check)). `loadOrderFiles(root?)` returns it as `src/`-prefixed POSIX paths relative to `root` (default `process.cwd()`), ready for `files`:

```ts
import { createGasLoader, loadOrderFiles } from 'gasdev/test';

const ROOT = process.cwd();

const load = createGasLoader({
  files: loadOrderFiles(ROOT),
  exports: ['GasSheetDb'],
  root: ROOT,
});
```

- It throws an `Error` prefixed `loadOrderFiles:` when `package.json` cannot be read or parsed (naming its path, with the original error as `cause`), or when `gasdev.loadOrder` is missing or not a non-empty array of non-empty strings.
- It does not validate the paths; `gasdev check` does.

#### Sharing `Error`

A vm context has its own built-ins, so an error thrown by the sources is not `instanceof Error` in the test realm. Pass the host `Error` to share it:

```ts
const { GasError } = load({ Session, console, Error });

expect(new GasError('boom')).toBeInstanceOf(Error);
```

#### Typing the result

The exports are not inferred from the sources. Supply their shape as the type argument; without it the result is `Record<string, unknown>`.

```ts
import { createGasLoader } from 'gasdev/test';

interface GasLoggerInstance {
  info(msg: string, meta?: Record<string, unknown>): void;
}

interface GasLoggerExports {
  GasLogger: new (options?: { level?: string }) => GasLoggerInstance;
}

const load = createGasLoader<GasLoggerExports>({
  files: ['src/gas-logger.types.ts', 'src/gas-logger.class.ts'],
  exports: ['GasLogger'],
});

export function loadGasLogger(globals: Record<string, unknown> = {}) {
  return load({ console, ...globals }).GasLogger;
}
```

The types ship as `test-loader/types.d.ts`, so consumers with `moduleResolution: bundler` (such as `gasdev/tsconfig/test.json`) need no `allowJs`.

### Apps Script tests

Unit tests with fakes cannot show how Sheets, `LockService` or `PropertiesService` really behave. `gasdev gas-test` builds one self-contained script from the library's optional peers, the library, a small test runtime and your tests, so it can run in Apps Script.

#### Layout

```
src/                      library, in gasdev.loadOrder
gas-test/
  tsconfig.json
  sheets.ts               tests: global-scope TypeScript, no import/export
```

`gas-test/*.ts` (declaration files excluded) are transpiled in name order after the runtime. `gas-test/tsconfig.json` type-checks them against `src/` and the runtime's types:

```json
{
  "extends": "gasdev/tsconfig/gas-test.json",
  "include": ["../src/**/*.ts", "*.ts"]
}
```

The runtime's global declarations (`test`, `info`, `assert`, `runGasTests`, `GasTestContext`) come in through the preset's `types` entry `gasdev/gas-test/runtime`, which TypeScript resolves from `node_modules`; no `/// <reference>` is needed. Add the check to `typecheck`, for example `tsc --noEmit && tsc -p gas-test/tsconfig.json --noEmit`. The `gas` ESLint preset lints `gas-test/` once `gas-test/tsconfig.json` exists.

#### Configuration

`gasdev.gasTest` requires `loadOrder`:

```json
{
  "gasdev": {
    "loadOrder": ["gas-lock.types.ts", "gas-lock.class.ts"],
    "gasTest": {
      "scopes": ["https://www.googleapis.com/auth/spreadsheets"],
      "scriptId": "1AbC..."
    }
  }
}
```

- `scopes` is required: a non-empty array of unique strings, each starting with `https://www.googleapis.com/auth/`. They become the project's `oauthScopes`.
- `scriptId` is optional; the `GAS_TEST_SCRIPT_ID` environment variable overrides it.
- Unknown keys are rejected, naming their path.

#### Writing tests

```ts
// gas-test/sheets.ts
test('writes a row', ({ prefix, spreadsheet }) => {
  const sheet = spreadsheet.insertSheet(`${prefix}rows`);
  sheet.appendRow(['a', 1]);
  assert(sheet.getLastRow() === 1, 'expected one row');
});

info('locale', ({ spreadsheet }) => spreadsheet.getSpreadsheetLocale());
```

| Global                       | Description                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `test(name, fn)`             | Registers a test; it fails when `fn` throws                                                                        |
| `info(name, fn)`             | Records context-dependent behaviour: the returned string (or thrown message) is reported as `INFO` and never fails |
| `assert(condition, message)` | Throws `Error(message)` when the condition is falsy                                                                |
| `runGasTests(spreadsheetId)` | Entry point: runs the tests in registration order                                                                  |

Each `fn` receives `{ prefix, spreadsheet }`. `prefix` is `__gt_<epochMs>_`; name every sheet a test creates with it. `spreadsheet` is resolved on first access, so tests that never read it (for example for `gas-lock`) need no spreadsheet. Resolution order:

1. the `spreadsheetId` argument of `runGasTests` (with `clasp run`, the `GAS_TEST_SPREADSHEET_ID` environment variable)
2. the `GAS_TEST_SPREADSHEET_ID` script property; this needs the `https://www.googleapis.com/auth/script.storage` scope in `gasTest.scopes`
3. `SpreadsheetApp.getActiveSpreadsheet()`

If none applies, the test that reads `spreadsheet` fails with an error naming all three. On first access, sheets named `__gt_<epochMs>_...` older than one hour (left by a run killed by the execution limit) are deleted; after the run, every sheet with the run's prefix is deleted. A cleanup error is reported as `INFO`.

The runtime logs `PASS`, `FAIL` and `INFO` lines and a summary (`<p> passed, <f> failed, <i> info in <s> s`) to the execution log, and returns the results as `@@GAS_TEST@@<base64 JSON>@@END@@`.

#### Commands

With `gasTest` configured, `gasdev check` requires these scripts with exactly these values. `typecheck` is a suggested addition and is only required to exist:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit && tsc -p gas-test/tsconfig.json --noEmit && echo '✓ TypeScript passed'",
    "test:gas:build": "gasdev gas-test build",
    "test:gas": "gasdev gas-test run"
  }
}
```

- `gasdev gas-test build [--out <file>]` transpiles (without type-checking) the `loadOrder` files and `gas-test/*.ts`, bundles the `peers` with the [`bundle`](#bundle) module and writes the script to `--out`, by default `node_modules/.cache/gasdev/gas-test.js`. The first line is a unique build stamp, because `clasp push --force` skips the push when every local file matches the remote.
- `gasdev gas-test run [--keep]` builds, pushes the script to the test project with clasp, runs `runGasTests` and prints one line per result and the summary. It exits `1` when a test fails or no results come back. With `--keep`, the temporary project directory is kept and its path printed. `GAS_TEST_SPREADSHEET_ID` is passed to `runGasTests`.

> [!WARNING]
> The test project must be dedicated to this purpose: `run` replaces its whole contents, including `appsscript.json`.

#### One-off setup

1. Create a dedicated Apps Script project and link it to a standard Google Cloud project (project settings), which `clasp run` requires.
2. Install clasp: `npm install -D @google/clasp`. `gas-test run` runs the clasp from the project's `node_modules`, not from `PATH`.
3. Authorize the scopes: `npx clasp login --extra-scopes <comma-separated gasTest.scopes>`.
4. Set `GAS_TEST_SCRIPT_ID` (or `gasTest.scriptId`) and, optionally, `GAS_TEST_SPREADSHEET_ID`.

#### Running from the editor

Run `npm run test:gas:build`, paste the generated file into the Apps Script editor, select `runGasTests` and run it. The execution log shows the results.

#### Limits

- Apps Script stops an execution after 6 minutes; the run's sheets are then removed by the next run's stale-sheet sweep.
- Runs share the project's script properties and spreadsheet, so do not run two at once.

### HTML build

A library that ships an HtmlService UI edits it as `.html`, `.css` and TypeScript files, but Apps Script needs it as source files that `gasdev bundle` (`.js` only), git subtree, the Vitest loader and `gasdev release` already handle. `gasdev html` inlines the page and writes it as a `.ts` file that declares the whole page as one string constant, listed in `loadOrder` like any other source.

#### Configuration

`gasdev.html` requires `loadOrder` and the `gas` preset:

```json
{
  "gasdev": {
    "loadOrder": ["generated/gas-config.ui.html.ts", "gas-config.ui.ts"],
    "html": [
      {
        "entry": "src/web/gas-config.ui.html",
        "out": "src/generated/gas-config.ui.html.ts",
        "name": "_GAS_CONFIG_UI_HTML"
      }
    ]
  }
}
```

| Key     | Value                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry` | Relative POSIX path to an `.html` file (no leading `/`, no backslashes, no `.` or `..` segments). Reported as drift when it does not exist  |
| `out`   | Relative POSIX path under `src/` ending in `.ts` but not `.d.ts`. Its path relative to `src/` must be in `loadOrder`, otherwise it is drift |
| `name`  | A valid JavaScript identifier for the constant                                                                                              |

The array is non-empty, `out` and `name` are unique across entries, and unknown keys are errors naming their path.

#### Rules

For each entry, the HTML is read and:

1. `<link rel="stylesheet" href="...">` with a local `href` becomes `<style>` holding the file's contents. Only `media` is kept from its attributes.
2. `<script src="..."></script>` with a local `src` becomes `<script>` holding the code, with its other attributes kept. If the `src` names a `.js` file and a `.ts` file with the same path and base name exists, the `.ts` is transpiled with the project's TypeScript (`transpileModule`, target ES2020, no module system: browser code is a classic global script) and not type-checked; run `tsc` for that, for example with `tsconfig/web.json`. Otherwise the `.js` is inlined as is. A missing file is an error naming its path, so `--check` needs no prior compile step.
3. References resolve relative to the directory of the entry. Absolute URLs (`http:`, `https:`, any other scheme such as `data:`) and protocol-relative `//` references are left untouched; a root-relative one (`/x.js`) is an error.
4. Any element with a `data-dev-only` attribute is removed with its content, for example a mock server script.
5. Inlined code containing `</script` (case-insensitive) in a script, or `</style` in a stylesheet, is an error naming the source file, because the browser would end the element there. `<?` is allowed: the page must be served with `HtmlService.createHtmlOutput()`, not as a template, so no inlined code is evaluated as a scriptlet.

Tags are found with a small scanner rather than an HTML parser. It handles attributes in any order, single, double and unquoted values, self-closing `<link />`, any tag case and multiline tags, and does not touch anything inside HTML comments, inline `<script>` and `<style>` elements or elements without a local reference.

#### Limitations

- `url(...)` references in inlined CSS are not rewritten, so use absolute URLs or `data:` URIs.
- Attribute entities are not decoded.
- Root-relative references (`/x.js`) are errors, as is a direct `<script src="x.ts">`: reference `x.js` and the `.ts` source is transpiled.
- A `<script src>` body is dropped.

#### The generated file

```ts
// Generated by `gasdev html` from src/web/gas-config.ui.html. Do not edit.
// prettier-ignore
const _GAS_CONFIG_UI_HTML: string = "<!doctype html>...";
```

The page is escaped with `JSON.stringify`, so the output is byte-stable: LF line endings and a trailing newline. `// prettier-ignore` keeps Prettier from rewriting the quotes. Directories are created as needed.

#### Commands

```
gasdev html [--check]
```

- `gasdev html` writes every `out` and prints `✓ Generated <out>`.
- `--check` writes nothing: it rebuilds in memory and compares with the file on disk. For each stale or missing file it prints `<out> is out of date: run gasdev html` to stderr and exits `1`; otherwise it prints `✓ HTML build is up to date`.
- A build error, or `html` not configured, exits `1`.
- `gasdev check` runs the same comparison when `html` is configured and reports it as drift.

#### Workflow

1. Make `build:frontend` run `gasdev html` after the frontend compile, for example `tsc -p tsconfig.frontend.json && gasdev html`.
2. Commit the generated file: tests, Apps Script tests and type-checking load it from `loadOrder`.
3. `npm run check` fails with drift when it is stale, because `gasdev check` is part of it. No script of the project is required by this feature.

<a id="bundle"></a>

### Bundle

`gasdev bundle` bundles gas-\* libraries from their `dist/vX.Y.Z` tags into one global script file, in an Apps Script project that uses several libraries.

- Resolves each library to the highest `dist/vX.Y.Z` tag that satisfies a semver range, so upgrades are a version bump instead of a `git subtree pull`
- Orders libraries by their declared load order, with peers before the libraries that use them
- Reproducible output: no timestamps, and a header recording each library's version and full commit SHA
- Validates the bundle with `node --check` before writing anything; optional concatenated `.d.ts` file for the libraries' global declarations
- Libraries must be released with `gasdev release` and `gasdev.loadOrder`, so each tag carries `gasLibrary` metadata; git must reach the libraries' repositories

#### Configuration

Configure the libraries in the project's `package.json`, then run `gasdev bundle` in the project root:

```json
{
  "gasdev": {
    "bundle": {
      "libraries": {
        "gas-sheetdb": "^2.1.0",
        "gas-lock": {
          "version": "^1.2.0",
          "repository": "https://github.com/me/gas-lock.git"
        }
      },
      "outFile": "src/lib/gas-libraries.js",
      "typesFile": "types/gas-libraries.d.ts"
    }
  }
}
```

| Key         | Type   | Default                | Description                                                                    |
| ----------- | ------ | ---------------------- | ------------------------------------------------------------------------------ |
| `libraries` | object | required               | Non-empty map of library name to a semver range, or `{ version, repository? }` |
| `outFile`   | string | `src/gas-libraries.js` | Bundle path, relative to the project root; no `..`; must end in `.js`          |
| `typesFile` | string | none                   | Declarations path, relative to the project root; no `..`; must end in `.d.ts`  |

Library names match `/^[a-z0-9][a-z0-9._-]*$/`. `version` must be a valid semver range. `repository` is a non-empty Git URL or path and defaults to `https://github.com/yorsh-co/<name>.git`. Unknown keys are rejected with their path, e.g. `gasdev.bundle.libraries.gas-lock.repositry is not a known option.`

`gasdev bundle` takes only `-h`/`--help` and `--version`. It prints one line per bundled library (name, version, short SHA, docs link), the written paths and a reminder about load order. Exit code `0` means the bundle was written, `1` a failure (`gasdev: <message>`) and `2` invalid usage.

> [!IMPORTANT]
> Apps Script loads files in `filePushOrder` or, by default, alphabetically. `outFile` must load before any project code that uses the library globals at top level.

#### How versions are resolved

For each library the tool runs `git ls-remote --tags --refs <repository> 'refs/tags/dist/v*'`, parses the `dist/vX.Y.Z` tags (tags that are not valid semver are ignored) and picks `semver.maxSatisfying` for the range. If nothing matches, the error names the library, the range and the available versions. The chosen tag is fetched with a shallow clone and its commit SHA is recorded in the bundle header. Prereleases are only considered when the range itself names one.

#### Load order and peers

Each library's `package.json` on its dist tag declares how it loads:

```json
{
  "name": "gas-sheetdb",
  "version": "2.1.0",
  "gasLibrary": {
    "loadOrder": ["gas-sheetdb.errors.js", "sub/x.js"],
    "peers": { "gas-lock": "^1.1.0" }
  }
}
```

- `loadOrder` is required: a non-empty list of relative `.js` paths that exist in the tag. The package `name` must equal the configured name.
- `peers` are optional libraries used when present. A configured peer whose resolved version does not satisfy the range prints a warning to stderr and the bundle is still written.
- Libraries are ordered topologically by peers; ties keep the config order. A cycle is an error naming the libraries involved.

Every file is emitted under a `// ---- <library>/<path> ----` marker with its `"use strict";` lines removed, because directives mid-file have no effect in a concatenated script. A single `'use strict';` follows the header instead.

```js
// Generated by gasdev bundle — do not edit. Run `npx gasdev bundle` to update.
// gas-lock 1.2.0 (<full sha>)
//   https://github.com/yorsh-co/gas-lock/tree/dist/v1.2.0

'use strict';

// ---- gas-lock/gas-lock.constants.js ----
```

With `typesFile` set, every `.d.ts` file in each library is concatenated under the same header and per-file markers. Include the file in your `tsconfig.json` so the globals are declared in your project.

#### Cache

Fetched libraries are cached in `<project>/node_modules/.cache/gasdev/bundle/<name>@<version>/`. A fetch clones into a temporary sibling directory, records the commit SHA in `.gasdev-bundle.json`, removes `.git` and renames the directory into place, so an interrupted fetch never looks cached. A complete entry fetched from the same repository is reused; delete the directory to force a fresh fetch. Version resolution always queries the remote.

#### Programmatic API

```js
import { bundle, loadConfig } from 'gasdev/bundle';

const { code, types, resolved } = bundle({
  libraries: { 'gas-lock': '^1.2.0' },
  cwd: process.cwd(),
  extraFiles: ['/abs/path/dist/my-lib.js'],
});
```

`libraries` has the shape of `gasdev.bundle.libraries`; `cwd` defaults to `process.cwd()`; `cacheDir` to `<cwd>/node_modules/.cache/gasdev/bundle`; `extraFiles` are absolute `.js` paths appended after the libraries; `warn` receives peer warnings (default: stderr). `bundle()` returns `{ code, types, resolved }` and writes nothing outside the cache; `loadConfig(cwd)` returns the validated `gasdev.bundle`. Failures throw `BundleError`.

Do not vendor a library with `git subtree` and bundle it too: its globals would be declared twice.

### Release

`gasdev release` publishes the build of a gas-\* library to its dist branch(es) with tags, so consumers can `git subtree` the compiled output without any TypeScript or ESLint tooling.

- Zero configuration for single-target libraries; multi-target projects (for example a backend branch plus a web client branch) are configuration, not a fork
- Multi-target releases are all-or-nothing: every branch and tag is pushed in a single atomic `git push`
- Targets without changes are skipped with a notice and get no commit or tag
- Consistent `v`-prefixed tags: version tags `vX.Y.Z`, release tags `<branch>/vX.Y.Z`
- Preflight checks before anything is touched: clean working tree, `vX.Y.Z` at `HEAD`, peer declarations' `@version` matching `package.json`, build present, release tags absent locally and on the remote
- Never ships `*.types.js` (by default) and removes stale or hidden files already on the release branch
- Generates a trimmed `package.json` for the release branch
- `--dry-run` shows the staged diff per target and restores the worktrees; `--target` releases a subset
- Strict configuration validation: unknown keys fail with the offending key path

Requirements: git with `git worktree` support; a git-flow-style version tag `vX.Y.Z` (matching `version` in `package.json`) pointing at `HEAD`; the build output (default `dist/`) already built, with at least one `.js` file; a remote (default `origin`) that receives the release branches and tags, which must be the canonical (GitHub) remote; and [GitHub CLI](https://cli.github.com) (`gh`), only when `githubRelease` is on.

The version tag is created by git-flow. Configure it once per clone so `git flow release finish` creates `vX.Y.Z`:

```bash
git config gitflow.prefix.versiontag v
```

Add a `release` script (the `gas` preset requires it, see [What is checked](#what-is-checked)):

```json
{
  "scripts": {
    "release": "gasdev release",
    "build:release": "npm run build:format && npm run release"
  }
}
```

#### Release usage

```text
gasdev release [--dry-run] [--target <branch>]...
```

| Option              | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `--dry-run`         | Run all checks, stage the release and show the diff per target; commit, tag and push nothing |
| `--target <branch>` | Release only the given target. Repeatable; default: all configured targets                   |
| `-h`, `--help`      | Show usage                                                                                   |
| `--version`         | Show the version                                                                             |

Exit codes: `0` on success, `1` when the release is refused or fails, `2` on invalid usage (an unknown option or a positional argument), `3` when the release was pushed but the GitHub Release failed (see [Failure recovery](#release-failure-recovery)).

```bash
npm run release -- --dry-run               # preview every target
npm run release -- --target dist-web       # release one branch of a multi-target project
npm run release -- --dry-run --target dist
npm run release                            # release
```

##### What a release does

Run it from the released commit, after `git flow release finish` and the build:

1. **Preflight**, before anything is modified: the working tree is clean (the tool's own `.worktrees/` is ignored), `vX.Y.Z` exists and points at `HEAD`, the `@version` header of `peer/<name>.peer.types.d.ts` (when that file exists) equals `package.json`'s `version`, every target's build directory contains a `.js` file, every `files` and `include` source exists, and `<branch>/vX.Y.Z` exists neither locally nor on the remote. With `githubRelease` on, it also requires a GitHub remote, `vX.Y.Z` on the remote at the same commit, and a working authenticated `gh`. It also requires rulesets that protect every target branch (`deletion`, `non_fast_forward`) and all tags (`deletion`, `non_fast_forward`, `update` on `~ALL`). Bump the `@version` header in the release branch together with the version, because the check runs on the tagged commit.
2. **Sync**: for each target, fetches `<remote>/<branch>` if it exists and prepares a worktree at `.worktrees/<branch>` (reusing it, checking out the local branch, tracking the remote branch, or creating an orphan branch for a first release). The local branch is fast-forwarded to the remote; if it has commits the remote lacks, the release is refused.
3. **Stage**: clears the worktree, copies the build minus `exclude` and `hide`, the `include` trees, the `files` and the generated `package.json`, then runs `git add -A`.
4. **Guard**: fails with "Nothing to release" when no target has staged changes. Targets without changes are skipped and get no tag.
5. **Commit and tag** each changed target: commit `merge: vX.Y.Z`, tag `<branch>/vX.Y.Z`.
6. **Push** all changed branches and tags once, atomically (`git push --atomic`).
7. **GitHub Release** (opt-in, `githubRelease`): creates a GitHub Release for `vX.Y.Z` after the push, unless one (or a draft) already exists.

##### Tags

| Tag               | Created by       | Points at                        |
| ----------------- | ---------------- | -------------------------------- |
| `vX.Y.Z`          | git-flow         | the released commit on `main`    |
| `<branch>/vX.Y.Z` | `gasdev release` | the release commit on `<branch>` |

For the default target the release tag is `dist/vX.Y.Z`.

##### Dry run

`--dry-run` performs the preflight, the sync and the staging exactly as a real run, prints `git diff --cached --stat` for each changed target (or the "No changes — skipped" notice), and then restores each worktree: `git reset --hard` and `git clean -fdx` for an existing branch; for a first release, the empty worktree is removed and no local branch is left behind.

A dry run never commits, tags or pushes. Like a real run it fetches the remote branch and fast-forwards the local release branch to it, so those local ref updates remain. It exits `1` with "Nothing to release" in the same situations as a real run, so CI can detect it.

With `githubRelease` on, the dry run also reports the GitHub Release outcome: would be created, already exists (skipped), or a draft exists (skipped).

The dry run also refuses repositories whose rulesets do not protect the target branches and tags.

#### Release configuration

Configuration is optional and lives under the `release` key of `gasdev` in your `package.json`. Without it, a single `dist` target with the defaults below is used.

```jsonc
"gasdev.release": {
  "remote": "origin",
  "targets": [ { "branch": "dist" } ]
}
```

| Key             | Default                  | Description                                                                                                     |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `remote`        | `"origin"`               | Remote that receives the branches and tags                                                                      |
| `targets`       | `[{ "branch": "dist" }]` | Non-empty list of release targets; branches must be unique                                                      |
| `githubRelease` | `false`                  | After the push, create a GitHub Release for `vX.Y.Z` (requires `gh`, authenticated, and `vX.Y.Z` on the remote) |

##### GitHub Release

The tool does not push `vX.Y.Z`; push it yourself (`git push <remote> vX.Y.Z`) before releasing. The remote must be a `github.com` repository; an SSH host alias for github.com (such as `github:owner/repo.git` with a `Host github` entry in `~/.ssh/config`) is resolved with `ssh -G`.

- **Notes**: the `## [X.Y.Z]` section of `CHANGELOG.md` (`[vX.Y.Z]` is also accepted). If there is none, the tag annotation is used, and otherwise the title `vX.Y.Z`.
- **Auth**: `gh auth login` locally, or `GH_TOKEN`/`GITHUB_TOKEN` in CI.
- **Existing releases**: if a Release for `vX.Y.Z` exists, it is left untouched. A draft counts as existing, so publish or delete it yourself.
- **Rulesets**: every target branch needs `deletion` and `non_fast_forward`, and an active tag ruleset on `~ALL` (no exclusions) needs `deletion`, `non_fast_forward` and `update`. Organization rulesets count. Run `npx gasdev github --fix` (needs admin rights) to apply them.

##### Target fields

Each target is merged over these defaults. Paths are relative to the project root unless noted.

| Field         | Default                                       | Description                                                                                              |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `branch`      | required                                      | Release branch; also the tag prefix (`<branch>/vX.Y.Z`)                                                  |
| `from`        | `"dist"`                                      | Build directory copied to the branch root                                                                |
| `hide`        | `["*.types.js"]`                              | Globs of files that are never shipped; removed if already on the branch                                  |
| `exclude`     | `[]`                                          | Globs of `from` subpaths skipped entirely, e.g. `"web/"`                                                 |
| `include`     | `[]`                                          | Extra build trees: `{ "from", "to", "hide" }`, copied from `from` to `to` (relative to the branch root)  |
| `files`       | `["README.md", "LICENSE.md", "CHANGELOG.md"]` | Project files copied into the branch; `"src:dest"` renames. Replaces the default list                    |
| `packageJson` | `true`                                        | Write the trimmed `package.json` (name, version, description, license, author, repository, `gasLibrary`) |

Unknown keys in `gasdev.release`, in a target or in an `include` entry are rejected, naming the key path (for example `gasdev.release.targets[1].pakageJson is not a known option`).

##### Library metadata

Libraries declare their load order, and optionally their peer libraries, in the `gasdev` key of `package.json` (next to `release`), which `gasdev check` validates:

```jsonc
"gasdev": {
  "loadOrder": ["gas-sheetdb.types.ts", "gas-sheetdb.errors.ts", "internal/x.ts"],
  "peers": { "gas-lock": "^1.1.0" }
}
```

When `loadOrder` is set, every target with `packageJson: true` gets a `gasLibrary` block after the other fields of its release `package.json`:

```jsonc
"gasLibrary": {
  "loadOrder": ["gas-sheetdb.errors.js", "internal/x.js"],
  "peers": { "gas-lock": "^1.1.0" }
}
```

- Each `x.ts` entry becomes `x.js`, relative to the target's `from` directory.
- Entries the target does not ship (matched by `hide` or `exclude`, including through an excluded directory) are dropped, which is why `gas-sheetdb.types.js` is absent above.
- A built `.js` file that does not exist is a preflight error; so is a load order where every entry is dropped.
- `peers` is copied as is and omitted when not configured. Without `loadOrder`, no `gasLibrary` block is written.
- A dry run lists the shipped files per target.

##### Glob semantics

`hide` and `exclude` patterns are gitignore-like and match `/`-separated paths relative to the copied directory:

- `*` matches any characters except `/`; `?` matches one character except `/`
- `**` matches any characters including `/`; `**/` also matches zero directories
- A pattern without `/` matches the file name at any depth (`*.types.js` matches `a/b/x.types.js`)
- A pattern with `/` is matched against the whole relative path (`shared/*.js`)
- A trailing `/` matches directories only (`web/` skips a `web` directory, not a file named `web`)

`hide` matches files only; `exclude` matches files and directories.

##### Example: gas-webapp

A backend branch and a web client branch, released together:

```json
{
  "gasdev.release": {
    "targets": [
      {
        "branch": "dist",
        "hide": ["**/types/*.js", "shared/*.js"],
        "exclude": ["web/"]
      },
      {
        "branch": "dist-web",
        "from": "dist/web",
        "hide": ["**/types/*.js"],
        "include": [
          { "from": "dist/shared", "to": "shared", "hide": ["*.js"] }
        ],
        "files": ["src/web/README.md:README.md", "LICENSE.md", "CHANGELOG.md"],
        "packageJson": false
      }
    ]
  }
}
```

This publishes `dist` (the backend, without `web/`) and `dist-web` (the client, plus the shared type declarations and its own README), tagged `dist/vX.Y.Z` and `dist-web/vX.Y.Z`.

#### Release failure recovery

Run `--dry-run` first; it surfaces most problems without touching any ref.

If the final push is rejected, nothing reached the remote, but the local release commits and tags are kept. The error message lists the commands, to run from the project root, to either:

- retry the push: `git push --atomic <remote> <branches and tags>`
- discard the local release: delete the tags with `git tag -d`, then reset each existing branch with `git -C .worktrees/<branch> reset --hard <remote>/<branch>`, or, for a branch that was never published, remove it with `git worktree remove --force .worktrees/<branch> && git branch -D <branch>`

Because the push is atomic, a multi-target release is never left half-published.

If `githubRelease` is on and the push succeeded but the GitHub Release could not be created, the tool exits `3`. The push is kept and nothing is rolled back. The notes are written to `.worktrees/github-release-vX.Y.Z.md`, and the error message prints the exact command to retry from the project root:

```bash
gh release create vX.Y.Z -R owner/repo --verify-tag --title vX.Y.Z --notes-file .worktrees/github-release-vX.Y.Z.md
```

Exit codes:

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| `0`  | Released                                                                |
| `1`  | The release was refused or failed; nothing was pushed                   |
| `2`  | Invalid usage                                                           |
| `3`  | Released and pushed, but the GitHub Release was not created (see above) |

### Deploy a web app

Setup and CI deployment for Google Apps Script projects: a guided `gasdev setup` wizard, a reusable GitHub Actions workflow and a `gasdev deploy` CLI that push with clasp and redeploy web apps. Both commands use the same clasp, resolved from the project's `node_modules`.

#### Requirements and install

- A project with `npm run check` and `npm run build` scripts (or custom commands, see [Workflow inputs](#workflow-inputs-and-outputs)) and a built `<rootDir>/appsscript.json`
- A GitHub environment per target, with the secret and variables below
- The Apps Script API enabled at https://script.google.com/home/usersettings
- `@google/clasp` as a dev dependency: `npm install -D @google/clasp`

The workflow runs the CLI with `npx --no-install`, so a missing dependency fails instead of fetching an unrelated package. Add a script for the wizard:

```json
{ "scripts": { "deploy:setup": "gasdev setup" } }
```

The workflow is referenced by an exact tag (`@v3.0.0`) and the CLI by a semver range (`#semver:^3.0.0`). They are fetched separately: the workflow definition by GitHub when the job starts, the CLI by `npm ci` from your lockfile. Keep them on the same version.

#### Setup

Steps 1-4 are done once per repository, steps 5-8 once per environment (`dev`, `live`), and steps 9-10 once.

##### 1. Enable the Apps Script API

Enable the [Apps Script API](https://script.google.com/home/usersettings) for the Google account that owns the scripts, ideally a dedicated account.

##### 2. Install the CLI

See [Requirements and install](#requirements-and-install).

##### 3. Commit `.clasp.example.json`

Commit `.clasp.example.json` at the project root. It is the base of `.clasp.json`, without `scriptId`. The optional `rootDir` (relative, no `..`) is where the build writes `appsscript.json`:

```json
{ "rootDir": "dist" }
```

Add `.clasp.json` to `.gitignore`: the CLI overwrites it from the template plus `GAS_SCRIPT_ID`.

##### 4. Provide `check` and `build`

Define `npm run check` and `npm run build` scripts, or override them with the [workflow inputs](#workflow-inputs-and-outputs). The build must produce `<rootDir>/appsscript.json`. Web apps declare `oauthScopes` explicitly; see [Scope changes](#scope-changes).

##### 5. Create the Apps Script project and web app deployment

For web apps, run `npm run deploy:setup` (the [setup wizard](#setup-wizard)) and read `GAS_SCRIPT_ID` and `GAS_DEPLOYMENT_ID` from `.env`. Manually: copy the Script ID from Project Settings, then Deploy > New deployment > Web app, and copy the deployment ID (versioned, not HEAD). CI never creates the first deployment, because it requires an interactive consent prompt; this applies to both `npm run deploy:setup` and the editor path. `deploy:setup` writes the IDs to `.env` and has no per-environment option, so record them before running it again for the next environment.

Libraries and bound scripts need only the script ID; see [Project types](#project-types). Use a separate script per environment.

##### 6. Create the GitHub environment restricted to its branch

Example for `dev` and `develop`; repeat for `live` and `main`. The deployment branch policy releases `CLASPRC_JSON` only to runs on that branch:

```sh
gh api -X PUT repos/{owner}/{repo}/environments/dev \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/{owner}/{repo}/environments/dev/deployment-branch-policies \
  -f name=develop
```

Alternatively, in the UI: Settings > Environments > New environment > Deployment branches and tags > Selected branches.

##### 7. Set the variables

```sh
gh variable set GAS_SCRIPT_ID --env dev --body <script-id>
gh variable set GAS_DEPLOYMENT_ID --env dev --body <deployment-id>
```

`GAS_DEPLOYMENT_ID` is for web apps only. These are variables, not secrets; see [Environments](#environments).

##### 8. Store `CLASPRC_JSON`

Run `npx clasp login` (or `npm run deploy:setup`, which logs in) on a trusted machine, ideally with a dedicated Google account that owns the scripts. Then store the credentials in the environment; repeat for `live`:

```sh
gh secret set CLASPRC_JSON --env dev < ~/.clasprc.json
```

See [Token expiry, revocation and rotation](#token-expiry-revocation-and-rotation).

##### 9. Add the caller workflow

Add the workflow from [Usage](#usage) at `.github/workflows/deploy.yml`.

##### 10. Verify the first run

Push to `develop`, then merge to `main` and confirm the `live` run. The job summary and the `url` output show the web app URL; a push-only project shows no URL. On a scope-change failure, follow [Scope changes](#scope-changes). On `invalid_grant`, follow [token rotation](#token-expiry-revocation-and-rotation).

#### Setup wizard

Run it from the project root:

```sh
npm run deploy:setup
```

The wizard runs these steps in order:

1. **Authentication:** continue as the logged-in clasp user, or log in with another account.
2. **Apps Script project:** reuse the project in `.clasp.json`, or create a new one.
3. **Configuration:** write `.clasp.json` and the manifest, asking for the time zone.
4. **Push:** `clasp push --force`.
5. **Deployment:** open the script editor, wait while you deploy the web app, then read the deployment and confirm its URL.
6. **Summary:** script ID, web app URL, deployment ID and version.

Exit codes: `0` success, `1` failed deployment, `2` invalid usage, `130` cancelled.

##### Configuration

Two templates are required at the project root:

- `.clasp.example.json`: the base of `.clasp.json`. Its optional `rootDir` (default `.`) is where the manifest is written.
- `appsscript.example.json`: the base of the manifest.

Options live in `package.json` under `gasdev.ci`:

| Key     | Type   | Default                 | Description                        |
| ------- | ------ | ----------------------- | ---------------------------------- |
| `title` | string | `package.json` `"name"` | Title of a new Apps Script project |
| `steps` | string | none                    | Module with project-defined steps  |

Unknown keys are rejected.

##### Custom steps

Set `gasdev.ci.steps` to a project-relative path to an ES module (`.js` or `.mjs`, no `..` segments). Its default export is an array of steps, run in order after the deployment and before the summary:

```json
{ "gasdev": { "ci": { "steps": "scripts/deploy-steps.js" } } }
```

The module is loaded before login, so a broken module fails before anything touches Apps Script. Each step is `{ title, run(ctx) }`, where `title` is a non-empty string and `run` is a function that may be async. Throw `DeployError` (exported by `gasdev/ci`) to fail cleanly; any other error is reported as `Step "<title>" failed: <message>`. An error thrown from a prompt question's `validate`, `format` or `onSubmit` callback is reported by `prompts` as a cancel (`Cancelled.`, exit 130), so validate inputs in `run` when the message matters.

`ctx` has:

| Property             | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `cwd`                | Project root                                                                       |
| `pkg`                | Parsed `package.json`                                                              |
| `deployment`         | `{ scriptId, webappUrl, deploymentId, version }`                                   |
| `env.read()`         | Parsed `.env`, empty when the file does not exist                                  |
| `env.update(values)` | Sets keys in `.env` in place, keeping comments; values must not contain newlines   |
| `prompt(questions)`  | [`prompts`](https://github.com/terkelg/prompts) questions; resolves to the answers |
| `log`                | `info`, `success`, `warn`, `error`, `raw` and `section`                            |
| `openScript()`       | Opens the script in the Apps Script editor                                         |

Types ship with the package. Steps run with your user privileges, so only point `steps` at code you trust. See [ADR 0016](docs/adr/0016-project-defined-steps.md).

###### Example: Calendly OAuth credentials

A step that asks for a Calendly OAuth client ID and secret, stores them in `.env`, prints the Script Property to save and opens the editor:

```js
// scripts/deploy-steps.js
import { DeployError } from 'gasdev/ci';

/** @type {import('gasdev/ci').DeployStep[]} */
export default [
  {
    title: 'Calendly OAuth setup',
    async run(ctx) {
      const stored = ctx.env.read();
      let clientId = stored.CALENDLY_CLIENT_ID;
      let clientSecret = stored.CALENDLY_CLIENT_SECRET;

      let provide = true;
      if (clientId && clientSecret) {
        ctx.log.warn('Existing Calendly OAuth credentials detected');
        ({ provide } = await ctx.prompt({
          type: 'confirm',
          name: 'provide',
          message: 'Provide new credentials?',
          initial: true,
        }));
      }

      if (provide) {
        ({ clientId, clientSecret } = await ctx.prompt([
          { type: 'text', name: 'clientId', message: 'OAuth Client ID' },
          {
            type: 'password',
            name: 'clientSecret',
            message: 'OAuth Client Secret',
          },
        ]));
        if (!clientId || !clientSecret) {
          throw new DeployError('Client ID and secret are required');
        }
        ctx.env.update({
          CALENDLY_CLIENT_ID: clientId,
          CALENDLY_CLIENT_SECRET: clientSecret,
        });
      }

      const credentials = {
        clientId,
        clientSecret,
        redirectUri: ctx.deployment.webappUrl,
      };
      ctx.log.info('Save this JSON as a Script Property:');
      ctx.log.raw(JSON.stringify(credentials, null, 2));

      ctx.openScript();
      await ctx.prompt({
        type: 'text',
        name: 'done',
        message: 'After saving the Script Property, press ENTER to continue',
      });
    },
  },
];
```

##### Files written

- `.clasp.json`: the template plus `scriptId`. It is always regenerated, never merged with an older file.
- `<rootDir>/appsscript.json`: the existing manifest, then the template, with the chosen `timeZone`. The default time zone is the template's, then the existing manifest's, then the system's, then `Etc/UTC`.
- `.env`: updated in place with the variables below, and created with mode `0600`.

##### Environment variables

| Variable            | Value                                          |
| ------------------- | ---------------------------------------------- |
| `GAS_SCRIPT_ID`     | Apps Script project ID                         |
| `GAS_WEBAPP_URL`    | `https://script.google.com/macros/s/<id>/exec` |
| `GAS_DEPLOYMENT_ID` | Deployment ID of the web app                   |
| `GAS_VERSION`       | Deployed version number                        |

##### Why deployment is manual

Deploying from the Apps Script editor triggers the OAuth consent prompt for the manifest's scopes without a Google Cloud OAuth client, which `clasp deploy` followed by `clasp run` would need. See [ADR 0015](docs/adr/0015-manual-web-app-deployment.md).

#### Usage

```yaml
on:
  push:
    branches: [develop, main]
jobs:
  deploy:
    uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0
    with:
      environment: ${{ github.ref_name == 'main' && 'live' || 'dev' }}
    secrets: inherit
```

`develop` deploys to the `dev` environment and `main` to `live`. `secrets: inherit` is enough: the secret is resolved from the environment the job runs in.

##### Environments

| Environment | Branch    | Secret         | Variables                            |
| ----------- | --------- | -------------- | ------------------------------------ |
| `dev`       | `develop` | `CLASPRC_JSON` | `GAS_SCRIPT_ID`, `GAS_DEPLOYMENT_ID` |
| `live`      | `main`    | `CLASPRC_JSON` | `GAS_SCRIPT_ID`, `GAS_DEPLOYMENT_ID` |

The IDs are variables, not secrets, on purpose: GitHub drops job outputs that contain a secret value, and the web app URL contains the deployment ID. They identify the project but grant no access. Both may contain only letters, digits, `_` and `-`.

##### Project types

| Project               | `GAS_DEPLOYMENT_ID` | Result                                   |
| --------------------- | ------------------- | ---------------------------------------- |
| Web app               | set                 | Scope check, push, new version, redeploy |
| Library, bound script | not set             | Push only                                |

`GAS_DEPLOYMENT_ID` must be a versioned web app deployment, not the HEAD deployment.

##### Workflow inputs and outputs

| Input          | Default         | Description                                      |
| -------------- | --------------- | ------------------------------------------------ |
| `environment`  | required        | GitHub environment with the secret and variables |
| `node-version` | `22`            | Node.js version                                  |
| `check`        | `npm run check` | Lint, type check and tests                       |
| `build`        | `npm run build` | Builds the project into its `rootDir`            |

| Output | Description                                                         |
| ------ | ------------------------------------------------------------------- |
| `url`  | Web app URL of the redeployed version; empty for a push-only deploy |

The `check` and `build` steps run project code and never see `CLASPRC_JSON`.

#### Token expiry, revocation and rotation

A refresh token stops working when the user revokes access, after 6 months without use, on some password changes, and when the per-client token limit evicts old tokens. The symptom is `clasp push` failing with `invalid_grant`.

To rotate: run `npx clasp login`, update the secret in every environment, then revoke the old grant in the Google Account's security settings.

#### Scope changes

If the OAuth scopes in the built `appsscript.json` differ from those of the deployed version, the workflow fails before pushing and lists the added and removed scopes. To fix it:

1. Build locally and run `clasp push`.
2. In the Apps Script editor, go to Deploy > Manage deployments, edit the web app deployment, choose New version and authorize.
3. Re-run the workflow.

The check compares only the explicit `oauthScopes` in `appsscript.json`. A project that relies on automatic scope detection (no `oauthScopes` key) always passes the check, so web-app projects should declare `oauthScopes` explicitly.

#### Deploy CLI reference

```sh
gasdev setup
gasdev deploy
```

`setup` takes no arguments; see [Setup wizard](#setup-wizard). The rest of this section covers `deploy`.

| Variable              | Required             | Description                                                                                                                        |
| --------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CLASPRC_JSON`        | yes                  | Contents of `~/.clasprc.json`. Written to a private temporary file (mode 600), removed afterwards (in `RUNNER_TEMP` under Actions) |
| `GAS_SCRIPT_ID`       | yes                  | Script ID, written to `.clasp.json` (overwritten if present)                                                                       |
| `GAS_DEPLOYMENT_ID`   | no                   | Web app deployment to redeploy                                                                                                     |
| `GITHUB_SHA`          | with a deployment ID | Description of the new version and deployment                                                                                      |
| `GITHUB_OUTPUT`       | no                   | File that receives the `url` output                                                                                                |
| `GITHUB_STEP_SUMMARY` | no                   | File that receives the job summary                                                                                                 |

`.clasp.json` is rendered from `.clasp.example.json` plus the script ID (`rootDir` must be absent or a relative path without `..`). Under `GITHUB_ACTIONS=true` every string of `CLASPRC_JSON` with 8 or more characters is masked in the logs.

| Exit code | Meaning                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| 0         | Deployed, or help or version printed                                          |
| 1         | Deployment failed: invalid inputs, scope change, missing build or clasp error |
| 2         | Invalid usage                                                                 |

### Config check

Prettier, TypeScript and ESLint are shared through their own extension mechanisms. Four things have none, so `gasdev check` compares them with templates and reports the drift:

```
gasdev check [--fix]
gasdev init
```

It reads the project in the current directory and writes nothing unless `--fix` is given. A passing run prints `✓ Config check passed`; otherwise the drift is listed per file on stderr, followed by `✗ Config check failed: N issue(s) in M file(s)`.

`--fix` appends the template lines missing from `.gitignore` and `.prettierignore`, and creates either file from the template if it does not exist. Existing lines, comments and line endings (LF or CRLF) are kept; missing entries go at the end in template order. Each change is printed on stdout as `<file>: added <entry>` or `<file>: created`. Other drift (dependabot, scripts, `loadOrder`, html) stays report-only, and the exit code reflects the drift remaining afterwards. After upgrading `gasdev`, run `npx gasdev check --fix` to pick up new template lines.

`init` scaffolds a new project. It applies the same ignore-file fix as `--fix`, creates `.github/dependabot.yml` from the template when the file is absent, and adds the required scripts that are missing (plus the `gasTest` ones when `gasTest` is configured) at the end of `scripts`, in template order. It never overwrites or changes an existing file or script, and a project that is already complete is left untouched. Scripts that only have to be present (`build`, `build:watch` and `typecheck` on `gas`) have no template value, so they stay manual and `check` keeps reporting them. `package.json` and `gasdev` are validated first, so an invalid config writes nothing. Each change is printed on stdout as `<file>: created`, `<file>: added <entry>` or `package.json: added scripts.<name>`, followed by the normal check report; the exit code reflects the drift remaining afterwards.

| Option         | Description                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `--fix`        | `check` only: append missing template lines to `.gitignore` and `.prettierignore` (creating them) |
| `-h`, `--help` | Show usage                                                                                        |
| `--version`    | Show the version                                                                                  |

`gasdev html [--check]` is described in [HTML build](#html-build).

Exit codes: `0` when the project matches, `1` on drift or an unusable `package.json`, `2` on invalid usage (a missing or unknown command, an unknown option).

#### Presets

The preset is read from `package.json` and defaults to `gas`. Set it to `node` for plain JavaScript tooling:

```json
{
  "gasdev": {
    "preset": "node"
  }
}
```

`loadOrder`, `peers`, `gasTest` and `html` are also read from `gasdev`, for the `gas` preset only. `bundle`, `release` and `ci` are accepted with either preset and are only checked to be objects; see [Bundle](#bundle), [Release configuration](#release-configuration) and the [setup wizard](#setup-wizard). Any other key or preset value is an error.

```json
{
  "gasdev": {
    "loadOrder": ["gas-sheet-db.types.ts", "gas-sheet-db.class.ts"],
    "peers": { "gas-logger": "^1.2.0" }
  }
}
```

- `loadOrder` is the single source of truth for the order in which the global-scope files under `src/` load. Use it in tests with [`loadOrderFiles`](#load-order-from-packagejson).
  - A non-empty array of unique, non-empty strings.
  - Each entry is a relative POSIX path under `src/` (no leading `/`, no backslashes, no `.` or `..` segments) ending in `.ts` but not `.d.ts`.
  - A listed file that does not exist is reported as drift: `gasdev.loadOrder: src/<entry> does not exist`.
- `peers` lists sibling libraries that are used when present, mapped to version ranges.
  - An object whose keys are package names matching `/^[a-z0-9][a-z0-9._-]*$/`.
  - Each value is a non-empty string; ranges are not parsed.
- `gasTest` configures [Apps Script tests](#apps-script-tests).
  - An object with the keys `scopes` and `scriptId`; any other key is an error naming its path.
  - `scopes` is a non-empty array of unique strings starting with `https://www.googleapis.com/auth/`; `scriptId` is an optional non-empty string.
  - It requires `loadOrder`.
- `html` configures the [HTML build](#html-build).
  - A non-empty array of objects with the keys `entry`, `out` and `name`; any other key is an error naming its path.
  - `out` and `name` are unique. Missing entry files, stale or missing generated files, and an `out` absent from `loadOrder` are reported as drift.
  - It requires `loadOrder`.
- Any of these keys with the `node` preset is an error.

#### Peer types

`gasdev peers sync [--check]` keeps `src/internal/<peer>.peer.types.d.ts` in step with the libraries listed in `gasdev.peers`.

- For each peer it lists the `vX.Y.Z` tags of `https://github.com/yorsh-co/<peer>.git`, picks the highest one that satisfies the range, and reads `peer/<peer>.peer.types.d.ts` at that tag. Other tags, such as `dist/vX.Y.Z`, are ignored.
- The file is written to `src/internal/` byte for byte, except that the ` * @version` line is removed. A peer patch release that leaves the declarations unchanged therefore produces no diff.
- Every peer is resolved and fetched before anything is written. A missing `peers` key, an invalid range, a range without a matching tag, a tag without the peer file or an unreachable repository is an error (exit 1).
- `--check` writes nothing and exits 1 if any file is missing or differs.
- It needs network access and `git`, so it is not part of `npm run check`. Add the scripts to the library:

```json
{
  "scripts": {
    "peers:sync": "gasdev peers sync",
    "peers:check": "gasdev peers sync --check"
  }
}
```

#### What is checked

| File                     | Rule                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`             | Every line of the template is present. Extra lines, blanks and comments are allowed                                                                                       |
| `.prettierignore`        | Every line of the template is present. Extra lines, blanks and comments are allowed                                                                                       |
| `.github/dependabot.yml` | Equals the template (ignoring trailing whitespace and final newlines)                                                                                                     |
| `package.json` `scripts` | Required scripts have exactly the template value; present scripts must exist with any value. With `gasTest` configured, `test:gas:build` and `test:gas` are also required |

Required lines per preset:

| File              | `gas`                                                                                                       | `node`                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.gitignore`      | `node_modules/`, `dist/`, `.worktrees/`, `.claude/worktrees/`, `.claude/plans/`, `.claude/handoff/`, `.env` | `node_modules/`, `.worktrees/`, `.claude/worktrees/`, `.claude/plans/`, `.claude/handoff/`, `.env` |
| `.prettierignore` | `node_modules`, `.worktrees`, `.claude/worktrees`, `.claude/plans`, `.claude/handoff`                       | `node_modules`, `.worktrees`, `.claude/worktrees`, `.claude/plans`, `.claude/handoff`              |

Required scripts, exact values, for the `gas` preset. They assume `rimraf` is a dev dependency of the project:

| Script          | Value                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| `clean`         | `rimraf dist`                                                                               |
| `release`       | `gasdev release`                                                                            |
| `build:format`  | `npm run check && npm run build && npm run format:dist`                                     |
| `build:release` | `npm run build:format && npm run release`                                                   |
| `lint`          | `eslint . && echo '✓ Lint passed'`                                                          |
| `lint:fix`      | `eslint . --fix`                                                                            |
| `format`        | `prettier . --write`                                                                        |
| `format:dist`   | `prettier ./dist --write --ignore-path .prettierignore`                                     |
| `format:check`  | `prettier . --check`                                                                        |
| `check`         | `npm run format:check && npm run lint && npm run typecheck && npm run test && gasdev check` |
| `test`          | `vitest run`                                                                                |
| `test:watch`    | `vitest`                                                                                    |

The `gas` preset also requires `build`, `build:watch` and `typecheck` to exist, with any value. With `gasTest` configured it also requires `test:gas:build` (`gasdev gas-test build`) and `test:gas` (`gasdev gas-test run`).

For the `node` preset the required scripts are `typecheck` (`tsc --noEmit && echo '✓ TypeScript passed'`), `lint`, `lint:fix`, `format`, `format:check`, `check`, `test` and `test:watch`, with the same values as above. No script is merely required to be present.

Add the check to your `check` script, as in the values above, so `npm run check` fails on drift.

### Dependabot

Keep dependencies current with one weekly grouped pull request for development dependencies. This is the `.github/dependabot.yml` that `gasdev check` enforces, for both presets:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    target-branch: develop
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        dependency-type: development
        patterns:
          - '*'
```

### GitHub rulesets

`gasdev github` keeps the repository rulesets the same in every gas-\* repo. Two rulesets, `branches` and `tags`, come from templates shipped with this package:

- `branches`: the default branch, `develop`, `dist` and `dist-web` cannot be deleted or force-pushed.
- `tags`: tags cannot be deleted or moved, but can be created, so `vX.Y.Z` and `<branch>/vX.Y.Z` tags still work.

Requirements: [GitHub CLI](https://cli.github.com) installed and authenticated (`gh auth login`), and admin rights on the repository for `--fix`.

```sh
npx gasdev github         # report drift against the templates
npx gasdev github --fix   # create missing rulesets and update drifted ones
```

Exit codes: `0` in sync (or fixed), `1` drift or failure, `2` usage error. Rulesets that are not in the template are reported but never changed or deleted. The command is not part of `check`, which stays offline. See [ADR 0009](docs/adr/0009-github-rulesets.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Migrating an existing project

1. Add `gasdev` and the peer dependencies to `devDependencies` (see [Install](#install)).
2. Set `"prettier": "gasdev/prettier"` in `package.json` and delete `.prettierrc.json`.
3. Replace the options of `tsconfig.json` and `tsconfig.test.json` with an `extends` of the matching preset, keeping `rootDir`, `outDir` and `include` local (see [TypeScript](#typescript)).
4. Replace `eslint.config.js` with `gasEslint(...)` (see [ESLint](#eslint)).
5. Remove `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals` from `devDependencies`.
6. Run `npx gasdev init` to add `.github/dependabot.yml`, the ignore lines and the missing required scripts.
7. For plain JavaScript tooling, add `"gasdev": { "preset": "node" }` to `package.json`.
8. Add `gasdev check` to the `check` script (if `init` added it, this is already done) and align the scripts `init` did not change with what the check reports.
9. Run `npm install`.
10. Run `npm run check`. It must pass with no source changes: `prettier --check`, `eslint` and `tsc` are clean.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Migrating to 3.0

3.0 folds `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` into one package named `gasdev` ([ADR 0018](docs/adr/0018-fold-dev-tools.md), [ADR 0019](docs/adr/0019-rename-to-gasdev.md)). Migrate once, from whichever packages you use.

### Dependencies

Remove `gas-dev-config`, `gas-dev-bundle`, `gas-dev-release` and `gas-dev-ci` from `devDependencies` and add:

```json
"gasdev": "github:yorsh-co/gasdev#semver:^3.0.0"
```

Add `@google/clasp` as a dev dependency where you run clasp (`gasdev gas-test run`, `setup`, `deploy`). It is an optional peer, so libraries that do not use it never install it.

### Scripts

| Before                                   | After                            |
| ---------------------------------------- | -------------------------------- |
| `gas-dev-config <command>`               | `gasdev <command>`               |
| `gas-dev-release`                        | `gasdev release`                 |
| `gas-dev-bundle`                         | `gasdev bundle`                  |
| `gas-dev-ci setup` / `gas-dev-ci deploy` | `gasdev setup` / `gasdev deploy` |

### `package.json` keys

| Before          | After            |
| --------------- | ---------------- |
| `gasDevConfig`  | `gasdev`         |
| `gasDevBundle`  | `gasdev.bundle`  |
| `gasDevRelease` | `gasdev.release` |
| `gasDevCi`      | `gasdev.ci`      |

Inner shapes are unchanged. `gasdev check` verifies that each key is an object.

### Imports and config references

- `gas-dev-config/*` becomes `gasdev/*` in `prettier`, the ESLint import and the tsconfig `extends` (for example `gasdev/tsconfig/gas.json`).
- `gas-dev-bundle` becomes `gasdev/bundle`.
- `gas-dev-ci` becomes `gasdev/ci`.

### Workflow

Point the caller at the new repository and exact tag:

```yaml
uses: yorsh-co/gasdev/.github/workflows/gas-deploy.yml@v3.0.0
```

There is no moving major tag; bump the tag on each release.

### Other changes

- `gasdev gas-test run` no longer needs clasp on `PATH`; it resolves it from `node_modules`.
- Cache paths move to `node_modules/.cache/gasdev`. Delete the old `node_modules/.cache/gas-dev-config` and `gas-dev-bundle` directories.
- Contributors: the environment variable `GAS_DEV_CONFIG_NETWORK` is now `GASDEV_NETWORK`.
- Node.js `^22.15.0` is now required (was `^22.13.0`); see [ADR 0021](docs/adr/0021-node-22-15-floor.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Run `npm run check` before opening a pull request. It runs the format check, lint, typecheck, coverage-gated tests and `gasdev check`.

- `npm run test:network` runs the network tests (`GASDEV_NETWORK=1`).
- `npm run lint:workflows` validates the workflows and needs `action-validator`.
- Decisions are recorded in `docs/adr/`.
- Commits follow Conventional Commits.
- Update `CHANGELOG.md` with every user-facing change.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

MIT

See the `LICENSE` file for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Support

Issues and feature requests are welcome via GitHub Issues.

Maintained by [yorsh-co](https://github.com/yorsh-co).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

> [!TIP]
> Found `gasdev` useful?
> Find more Google Apps Script libraries at [github.com/yorsh-co](https://github.com/yorsh-co).
