# 6. Node engines

- Status: Accepted
- Amended by: [ADR 0021](0021-node-22-15-floor.md)
- Date: 2026-11-04

## Context

The `engines.node` range declared by the gas-\* repositories had drifted below what their toolchain requires. The repositories declared `>=20.0.0` or `>=20.10.0`, but eslint 10 and `@eslint/js` need `^20.19.0 || ^22.13.0 || >=24`, and vitest 5 needs `^22.12.0 || ^24.0.0 || >=26.0.0`. minimatch 11 and rimraf 6.1.4 also exclude Node 21. As a result, `npm run check` could not run on Node 20.

Direct dependencies whose `engines.node` the declared range violated:

| Repo                                         | Declared    | Violations |
| -------------------------------------------- | ----------- | ---------- |
| gas-dev-config                               | `>=20.10.0` | 4          |
| gas-dev-bundle, gas-dev-release              | `>=20.10.0` | 2 each     |
| gas-config, gas-webapp                       | `>=20.0.0`  | 6 each     |
| gas-error, gas-lock, gas-logger, gas-sheetdb | `>=20.0.0`  | 5 each     |

Node 20 reached end of life on 2026-04-30.

## Decision

Every gas-\* repository declares the intersection of its direct `dependencies` and `devDependencies` `engines.node` ranges. All repositories use one uniform range, currently:

```json
"engines": {
  "node": "^22.13.0 || ^24.0.0 || >=26.0.0"
}
```

This drops Node 20 and the odd-numbered releases 21, 23 and 25.

The range is verified by the following check, run from the repository root. It exits non-zero and lists the offending packages when the declared range is not a subset of every direct dependency's `engines.node`:

```sh
node -e 'const s=require("semver"),p=require("./package.json"),d=p.engines.node;const bad=Object.keys({...p.dependencies,...p.devDependencies}).flatMap(k=>{try{const e=require("./node_modules/"+k+"/package.json").engines?.node;return e&&!s.subset(d,e)?[k+" ("+e+")"]:[]}catch{return[k+" (not installed)"]}});if(bad.length){console.error("engines "+d+" not within: "+bad.join(", "));process.exit(1)}console.log("OK "+d)'
```

The check needs `semver` resolvable from the repository root (a transitive dependency, not a declared one), so run it after `npm ci`.

Narrowing `engines` is a breaking change for the CLIs (gas-dev-config, gas-dev-bundle, gas-dev-release), because consumers on Node 20.19 or later lose support, so the next release of each must be a major version. It is not a breaking change for the Apps Script libraries, which run on V8 and use `engines` only for their development tooling.

## Consequences

- Re-run the engines check whenever eslint, vitest or typescript-eslint gets a major bump, and widen or narrow the range in every repository together.
- The `package-lock.json` root entry copies `engines`. Sync it with `npm install --package-lock-only` after any change.
- Engines are not enforced: there is no `engine-strict` and no `gas-dev-config check` rule, so the range can still drift unnoticed until the check is re-run.
