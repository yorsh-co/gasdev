// @ts-check
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * @typedef {object} GasLoaderOptions
 * @property {string[]} files Source files in load order, resolved against `root`.
 *   Later files may depend on earlier ones.
 * @property {string[]} exports Names of the global declarations to return.
 * @property {string} [root] Directory the files are resolved against; defaults to `process.cwd()`.
 */

const KNOWN_OPTIONS = ['files', 'exports', 'root'];
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && v !== '')
  );
}

/**
 * Validates user options, throwing a `TypeError` that names the offending option.
 *
 * @param {unknown} options
 * @returns {asserts options is GasLoaderOptions}
 */
function validate(options) {
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError('createGasLoader: options must be an object');
  }
  const opts = /** @type {Record<string, unknown>} */ (options);
  for (const key of Object.keys(opts)) {
    if (!KNOWN_OPTIONS.includes(key)) {
      throw new TypeError(`createGasLoader: unknown option "${key}"`);
    }
  }
  if (!isNonEmptyStringArray(opts.files)) {
    throw new TypeError(
      'createGasLoader: option "files" must be a non-empty array of non-empty strings',
    );
  }
  if (!isNonEmptyStringArray(opts.exports)) {
    throw new TypeError(
      'createGasLoader: option "exports" must be a non-empty array of non-empty strings',
    );
  }
  const invalid = opts.exports.find((name) => !IDENTIFIER.test(name));
  if (invalid !== undefined) {
    throw new TypeError(
      `createGasLoader: option "exports" contains "${invalid}", which is not a valid identifier`,
    );
  }
  if (
    opts.root !== undefined &&
    (typeof opts.root !== 'string' || opts.root === '')
  ) {
    throw new TypeError(
      'createGasLoader: option "root" must be a non-empty string',
    );
  }
}

/**
 * Reads a source file, naming its resolved path when it cannot be read.
 *
 * @param {string} path Absolute path.
 * @returns {string}
 */
function readSource(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`createGasLoader: cannot read source file ${path}`, {
      cause,
    });
  }
}

/**
 * Creates a loader for Google Apps Script sources.
 *
 * Apps Script files are global-scope scripts without module syntax, so they
 * cannot be imported. The files are transpiled once, concatenated in order and
 * compiled into a single script; every call of the returned function evaluates
 * it in a fresh `node:vm` context, so state never leaks between loads.
 *
 * Pass `Error` (and other built-ins whose identity matters) in `globals` to
 * share the host realm's, so `instanceof` holds across the context boundary.
 *
 * @template {object} [T=Record<string, unknown>] Shape of the exported globals,
 *   supplied by the caller; it is not inferred from the sources.
 * @param {GasLoaderOptions} options
 * @returns {(globals?: Record<string, unknown>) => T}
 * @throws {TypeError} When an option is invalid.
 * @throws {Error} When a source file cannot be read.
 */
export function createGasLoader(options) {
  validate(options);
  const { files, exports: names, root = process.cwd() } = options;

  const body = files
    .map((file) => {
      const path = resolve(root, file);
      return ts.transpileModule(readSource(path), {
        compilerOptions: { target: ts.ScriptTarget.ES2021 },
        fileName: path,
      }).outputText;
    })
    .join('\n');
  const picks = names
    .map(
      (name) => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`,
    )
    .join(', ');
  const script = new vm.Script(`${body}\n({ ${picks} });`, {
    filename: `gas-loader:${files.join('+')}`,
  });

  return (globals = {}) => {
    const exported = /** @type {Record<string, unknown>} */ (
      script.runInContext(vm.createContext({ ...globals }))
    );
    for (const name of names) {
      if (exported[name] === undefined) {
        throw new Error(
          `createGasLoader: export "${name}" is not defined by the source files`,
        );
      }
    }
    return /** @type {T} */ (exported);
  };
}

/**
 * Lists the source files named by `gasdev.loadOrder` in package.json, as
 * `src/`-prefixed POSIX paths relative to `root`, ready for `createGasLoader`.
 * Path validation is left to `gasdev check`.
 *
 * @param {string} [root] Project directory; defaults to `process.cwd()`.
 * @returns {string[]}
 * @throws {Error} When package.json is unreadable or invalid, or `gasdev.loadOrder` is not a non-empty array of non-empty strings.
 */
export function loadOrderFiles(root = process.cwd()) {
  const path = join(root, 'package.json');
  /** @type {any} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`loadOrderFiles: cannot read ${path}`, { cause });
  }
  const loadOrder = pkg?.gasdev?.loadOrder;
  if (!isNonEmptyStringArray(loadOrder)) {
    throw new Error(
      `loadOrderFiles: "gasdev.loadOrder" in ${path} must be a non-empty array of non-empty strings`,
    );
  }
  return loadOrder.map((entry) => `src/${entry}`);
}
