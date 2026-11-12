# 24. Localhost dev server for HtmlService pages

- Status: Accepted
- Date: 2026-11-12

## Context

Iterating on an HtmlService page needed a build, a clasp push and a browser refresh for every change. `inlinePage()` already produces the exact page Apps Script serves, and `data-dev-only` elements are the established hook for a mock `google.script.run`. Only a server, a watcher and a reload channel were missing.

## Decision

`gasdev dev` serves every `gasdev.html` entry on `127.0.0.1` and reloads the browser when a file under an entry's directory changes.

- The server returns the page built by `inlinePage`, not static files. One code path serves production and dev, with no static-file routing, no path-traversal surface and no on-the-fly `.ts` route.
- `data-dev-only` elements are kept in dev. They are the existing convention for a mock `google.script.run`; gasdev ships no mock of its own.
- Server-side code is not run locally. Apps Script services have no local equivalent. Bridging `google.script.run` to `createGasLoader` with user mocks is a possible follow-up.
- No new dependencies: `node:http`, recursive `fs.watch` (supported on Linux since Node 20; the engines floor is 22.15) and Server-Sent Events for reload.
- The server binds to `127.0.0.1` only, with no `--host` option, and rejects requests with an unexpected `Host` header.
- Reload is a full page reload, not HMR, because the page is a single inlined document.
- `dev` writes no `out` file; `gasdev html` remains the only writer.

A static file server with a `.ts` route and a bundler-based server (Vite) were rejected: they add routing, a second build path or a dependency.

## Consequences

- Editing an `.html`, `.css`, `.ts` or `.js` file refreshes the tab within about a second, and a build error is shown in the tab instead of stopping the server.
- Pages run without Apps Script only when they mock `google.script.run` in a `data-dev-only` element.
- `.ts` sources are transpiled but not type-checked; the project runs `tsc` itself.
- An entry at the project root makes the recursive watch cover `node_modules` and `.git`.
