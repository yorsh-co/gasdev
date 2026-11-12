# 16. Project-defined steps

- Status: Accepted
- Date: 2026-11-06
- Ported from gas-dev-ci ADR 0005
- Superseded in part: the configuration key is `gasDevConfig.ci` and the setup wizard is `gas-dev-config setup`.

## Context

Projects need setup work after the deployment that the wizard cannot know about, such as collecting OAuth client credentials, storing them in `.env` and printing the Script Property to set. These steps are interactive and project-specific.

## Decision

A hybrid design: configuration is declarative in `package.json`, like the sibling tools, and the behavior lives in a JS module.

- `gasDevConfig.ci.steps` is a project-relative path to an ES module. Its default export is an array of `{ title, run(ctx) }`.
- The steps run once, after the deployment and before the summary. The module is loaded before login, so a broken module fails before anything touches Apps Script.
- `ctx` exposes the deployment, `.env` access, prompts, logging and `openScript()`. Types ship in `types.d.ts`, and a step throws `DeployError` to fail cleanly.
- The path check requires a relative `.js` or `.mjs` path without `..` segments that exists. It does not resolve symlinks. This is accepted because the module is project code that runs with the user's privileges anyway.

Alternatives considered:

- JS-only configuration (a `gas-dev-ci.config.js`): breaks the `package.json` convention of the sibling tools and makes the common case, no custom steps, need a file.
- Declarative-only steps: a schema cannot express interactive flows such as conditional prompts, validation and opening the editor.

## Consequences

- Project code runs with the user's privileges; `steps` must point at trusted code.
- There is a single hook point, after the deployment. Steps that must run earlier are not supported.
- Steps can write secrets to `.env`, which is why the tool refuses to run unless `.env` is git-ignored.
