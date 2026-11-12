# 15. Manual web app deployment

- Status: Accepted
- Date: 2026-11-06
- Ported from gas-dev-ci ADR 0004
- Superseded in part: clasp is an optional peer resolved from the project (`resolveClaspBin`), not a binary on `PATH`.

## Context

An Apps Script web app needs a deployment, and the first deployment of a manifest's scopes needs the owner's OAuth consent. The setup wizard has to produce the web app URL, deployment ID and version for `.env`.

## Decision

The user creates the web app deployment in the Apps Script editor; the tool guides it and reads the result.

- Manual deployment: deploying from the editor triggers the OAuth consent for the manifest's scopes without a Google Cloud OAuth client. `clasp deploy` does not trigger consent, and `clasp run` needs a GCP project and an OAuth client configured for the script. Both would add setup that the wizard exists to avoid.
- Reading the result: after the user confirms, the tool runs `clasp --json list-deployments` and never parses human-readable output. It ignores the HEAD deployment (no `versionNumber`), picks the highest version, and derives `https://script.google.com/macros/s/<deploymentId>/exec`.
- Confirmation: the user confirms the derived URL. If they decline, they choose from the other versioned deployments. There is no free-text URL prompt.
- When no versioned deployment exists, the user can retry or abort.

## Consequences

- One manual step remains, with printed instructions and the editor opened for the user.
- The URL is derived from clasp's JSON, so a change in clasp's text output cannot break the tool; a change in the `list-deployments` JSON shape would, and is covered by the tests with a fake clasp.
- Web app deployments created by other means are accepted as long as they have a version.
