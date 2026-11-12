# 5. Audit overrides

- Status: Accepted
- Date: 2026-11-04

## Context

`npm audit` reports findings in the gas-\* libraries that have no fix reachable through ordinary dependency updates.

- **minimatch < 11.0.1** (moderate, GHSA-g3hv-75wg-m249): eslint 10.x, `@eslint/config-array` and `@typescript-eslint/typescript-estree` 8.x pin `minimatch ^10`, and no upstream release widens the range. The same chain pulls in **brace-expansion 4.0.0–5.0.11** (high, DoS), which minimatch 11 resolves by requiring `brace-expansion ^5.0.12`.
- **glob 3.0.0–14.0.1** (moderate): `@google/clasp` pulls in `googleapis-common` 8.0.3, which pins `gaxios` 7.1.3 exactly. That version depends on `rimraf` 5 and so on `glob` 10. `gaxios` 7.3.1 dropped `rimraf`.
- **zod < 4.6.6** (high, memory exhaustion): `@google/clasp` 3.4.1, the latest release, depends on `zod ^3.25.76`. The fix exists only in zod 4.

npm `overrides` apply only in the root project. They are ignored when the package is installed as a dependency, so gas-dev-config cannot fix its consumers' audits by carrying them. Each consumer needs its own block.

## Decision

Each consumer that installs `@google/clasp` declares the following in `package.json`, directly after `devDependencies`. Consumers without clasp declare `minimatch` only. gas-dev-config itself installs clasp as a devDependency for its deploy tests and declares both:

```json
"overrides": {
  "minimatch": "^11.0.1",
  "gaxios": "^7.3.1"
}
```

- Each repository's `npm run check` (lint, typecheck, tests) is the compatibility gate for forcing minimatch 11 under eslint and typescript-eslint.
- zod is not overridden. clasp is a dev-time CLI that validates its own configuration and MCP inputs. Those inputs come from the local developer or their agent on a development machine, not from remote or untrusted users, so the memory-exhaustion path is unlikely to be reachable in practice. This is accepted risk.
- Where a direct `rimraf ^6` devDependency still resolves 6.1.3, which pulls in `glob` 13 (GHSA-3g3m-2fjr-6pw4), run `npm update rimraf`. It moves the lockfile to rimraf 6.1.4, which requires `glob ^14.0.3`, without changing `package.json` and without an override.
- `npm audit fix --force` is never used. It proposes downgrades such as eslint 4 and clasp 2.5.0.

## Consequences

- Remove the `minimatch` override once eslint, `@eslint/config-array` and `@typescript-eslint/typescript-estree` accept minimatch 11.0.1 or later.
- Remove the `gaxios` override once `googleapis-common` stops pinning gaxios 7.1.3.
- Revisit the zod risk when clasp moves to zod 4.
- The expected residual audit in consumers that install clasp is `@google/clasp` and `zod`, plus `gas-dev-config` as their parent. gas-dev-config itself installs clasp and shows the same residual. Consumers without clasp audit clean.
- Every consumer carries its own override block and must be updated when an override is removed.
