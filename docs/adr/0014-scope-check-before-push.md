# 14. Scope check before push

- Status: Accepted
- Date: 2026-11-06
- Ported from gas-dev-ci ADR 0003

## Context

The HEAD deployment drives triggers, menus and test deployments. Pushing new OAuth scopes the owner has not consented to can break them, and `clasp deploy` cannot trigger the consent (ADR 0015).

## Decision

When `GAS_DEPLOYMENT_ID` is set, the CLI compares the `oauthScopes` of the built `<rootDir>/appsscript.json` with those of the version the deployment points at, before pushing.

- The scopes are compared as sorted unique sets; a missing key counts as `[]`.
- If they differ, the CLI exits 1 before any change, listing the added and removed scopes and pointing to the README section on scope changes.
- Only the explicit `oauthScopes` are compared: a project relying on automatic scope detection (no `oauthScopes` key) always passes, so web-app projects should declare `oauthScopes` explicitly.
- The owner then authorizes the scopes manually and re-runs the workflow.

## Consequences

- A scope change never reaches HEAD without consent.
- Deployments without `GAS_DEPLOYMENT_ID` (libraries, bound scripts) are not checked.
- A scope change needs one manual step per environment.
