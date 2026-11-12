/** A library entry: a semver range, or a range with a custom repository. */
export type LibrarySpec = string | { version: string; repository?: string };

export interface ResolvedLibrary {
  name: string;
  /** Resolved version, without the `dist/v` prefix. */
  version: string;
  /** Full commit SHA of the `dist/v<version>` tag. */
  sha: string;
  repository: string;
}

export interface BundleOptions {
  /** Same shape as `gasdev.bundle.libraries`; may be empty when only `extraFiles` are bundled. */
  libraries: Record<string, LibrarySpec>;
  /** Project root; default `process.cwd()`. */
  cwd?: string;
  /** Default `<cwd>/node_modules/.cache/gasdev/bundle`. */
  cacheDir?: string;
  /** Absolute `.js` paths appended after the libraries, in order. */
  extraFiles?: string[];
  /** Receives warnings (peer range mismatches); default writes to stderr. */
  warn?: (message: string) => void;
}

export interface BundleResult {
  /** The bundle for `outFile`. */
  code: string;
  /** The concatenated declarations for `typesFile`. */
  types: string;
  /** Libraries in bundle order. */
  resolved: ResolvedLibrary[];
}

export interface BundleConfig {
  libraries: Record<string, { version: string; repository: string }>;
  outFile: string;
  typesFile?: string;
}

/** Resolves, fetches and concatenates gas-* libraries. Writes nothing outside the cache. */
export function bundle(options: BundleOptions): BundleResult;

/** Reads and validates `gasdev.bundle` from `<cwd>/package.json`. */
export function loadConfig(cwd: string): BundleConfig;

/** An expected failure; its message is shown to the user without a stack trace. */
export class BundleError extends Error {}
