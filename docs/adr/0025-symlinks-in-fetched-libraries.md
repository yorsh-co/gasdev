# 25. Symbolic links in fetched libraries

- Status: Accepted
- Date: 2026-11-12

## Context

`gasdev bundle` clones each library's `dist/vX.Y.Z` tag into the cache with a plain `git clone`, which checks committed symbolic links out as real links on Linux and macOS. A security scan found that the dist tag, which the library's publisher controls, could use them to:

- pull local files (a project `.env`, `/proc/self/environ`) into the generated bundle through a linked `gasLibrary.loadOrder` file or `.d.ts` file;
- overwrite a local file by committing `.gasdev-bundle.json` as a link, which the cache metadata write followed.

## Decision

- `readLibrary` and `listDeclarations` (`src/bundle/library.js`) reject any `loadOrder` file or `.d.ts` file whose path below the library directory passes through a symbolic link, wherever the link points. The check runs on every bundle, so cache entries fetched earlier are covered. `gasdev release` copies regular files, so dist tags it builds contain no links.
- `fetchLibrary` (`src/bundle/fetch.js`) removes any committed `.gasdev-bundle.json` before writing its own, and writes with the exclusive flag.

Accepted risks:

- S8: `readLibrary` reads the dist tag's `package.json` through a symbolic link. Its contents never reach the bundle, but a parse failure is reported with V8's `JSON.parse` message, which quotes the first 10 characters of the file (for example `"API_KEY=ab"`). A link to a local file can therefore print that much of it to stderr, which matters only where an untrusted party can read the logs, such as public CI. A fix would apply the `hasSymlink` check to `package.json`, or drop the parse message from the error.
- S9: `listDeclarations` lists the library with a recursive `readdirSync`, which follows directory links before the `hasSymlink` check runs. A dist tag with link loops (for example `up -> ..` and `self -> .`) or a link to `/` makes `gasdev bundle` hang or walk the whole filesystem; on Node 26.12.1 two loop links ran past 60 s. The bundle then fails with an error and nothing is read into the output, so the impact is availability only. A fix would walk the tree with `withFileTypes` and skip links instead of descending.

Both require a library whose dist tag the attacker controls, and the developer can recover by removing the library from `gasdev.bundle.libraries`.

## Consequences

- A fetched library cannot read local files into the bundle or write outside its cache entry.
- A dist tag that commits links on a `loadOrder` or `.d.ts` path, even links inside the library, fails to bundle.
- S8 and S9 stay open until their impact justifies a fix; revisit them if bundles run in public CI against third-party libraries.
