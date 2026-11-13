// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { legacyKeyMessage } from '../src/legacy-keys.js';
import { readPeerTypesVersion } from '../src/release/peer-types.js';
import { HtmlError, compareModule } from './html.js';

const PRESETS = ['gas', 'node'];
const KNOWN_KEYS = [
  'preset',
  'loadOrder',
  'peers',
  'gasTest',
  'html',
  'bundle',
  'release',
  'ci',
];
const GAS_TEST_KEYS = ['scopes', 'scriptId'];
const HTML_KEYS = ['entry', 'out', 'name'];
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_WORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);
const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';
const PEER_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TEMPLATES = new URL('../templates/', import.meta.url);

/** Local invocation used in place of the `gasdev` bin by this package itself. */
const SELF_BIN = 'node bin/gasdev.js';
/** Coverage-gated test step this package runs in place of `npm run test`. */
const SELF_TEST = 'npm run test:coverage';

/**
 * @typedef {object} Drift
 * @property {string} file Project file the drift belongs to.
 * @property {string} message What is missing, expected or different.
 * @property {boolean} [warning] Reported without failing the check.
 */

/**
 * @typedef {object} ScriptsTemplate
 * @property {Record<string, string>} required Scripts that must have exactly this value.
 * @property {string[]} present Scripts that must exist with any value.
 * @property {Record<string, string>} [gasTest] Scripts required, with exactly this value, when `gasTest` is configured.
 */

/**
 * @typedef {object} GasTestConfig
 * @property {string[]} scopes OAuth scopes the Apps Script test project requests.
 * @property {string} [scriptId] Apps Script project the tests run in.
 */

/**
 * @typedef {object} HtmlEntry
 * @property {string} entry HTML file to inline, relative to the project root.
 * @property {string} out Generated TypeScript file under `src/`, relative to the project root.
 * @property {string} name Identifier of the string constant the file declares.
 */

/**
 * @typedef {object} ResolvedConfig
 * @property {string} preset Preset name; `gas` when unset.
 * @property {string[] | undefined} loadOrder Source files under `src/` in load order.
 * @property {Record<string, string> | undefined} peers Optional sibling libraries and their version ranges.
 * @property {GasTestConfig | undefined} gasTest Settings for tests that run in Apps Script.
 * @property {HtmlEntry[] | undefined} [html] Pages inlined into generated TypeScript constants.
 */

/**
 * Value `init` and `check --fix` give a script that must only be present. It
 * fails when run, so a build cannot pass until the project supplies the command.
 *
 * @param {string} name Script name.
 * @returns {string}
 */
export function placeholderScript(name) {
  return `echo 'gasdev: replace the scripts.${name} placeholder in package.json' >&2 && exit 1`;
}

/** Raised for a configuration problem that prevents the check from running. */
export class CheckError extends Error {}

/**
 * Reads a text file, or returns `undefined` when it does not exist.
 *
 * @param {string | URL} path
 * @returns {string | undefined}
 */
function readOptional(path) {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf8');
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string | URL} path
 * @param {string} label Name used in error messages.
 * @returns {unknown}
 */
function readJson(path, label) {
  const text = readOptional(path);
  if (text === undefined) throw new CheckError(`${label} not found`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CheckError(
      `${label} is not valid JSON: ${/** @type {Error} */ (error).message}`,
    );
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates `gasdev.loadOrder`: a non-empty list of unique, relative POSIX
 * paths under `src/` to `.ts` files that are not declaration files.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function parseLoadOrder(value) {
  const key = 'package.json: "gasdev.loadOrder"';
  if (!Array.isArray(value) || value.length === 0) {
    throw new CheckError(`${key} must be a non-empty array of strings`);
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') {
      throw new CheckError(
        `${key} entry ${JSON.stringify(entry)} must be a non-empty string`,
      );
    }
    if (seen.has(entry)) {
      throw new CheckError(`${key} lists ${JSON.stringify(entry)} twice`);
    }
    seen.add(entry);
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) {
      throw new CheckError(
        `${key} entry ${JSON.stringify(entry)} must be relative to src/`,
      );
    }
    if (entry.includes('\\')) {
      throw new CheckError(
        `${key} entry ${JSON.stringify(entry)} must use "/" separators`,
      );
    }
    if (
      entry
        .split('/')
        .some((part) => part === '' || part === '.' || part === '..')
    ) {
      throw new CheckError(
        `${key} entry ${JSON.stringify(entry)} must not contain empty, "." or ".." segments`,
      );
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) {
      throw new CheckError(
        `${key} entry ${JSON.stringify(entry)} must be a .ts file other than .d.ts`,
      );
    }
  }
  return /** @type {string[]} */ (value);
}

/**
 * Validates `gasdev.peers`: package names mapped to non-empty version ranges.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function parsePeers(value) {
  const key = 'package.json: "gasdev.peers"';
  if (!isRecord(value)) throw new CheckError(`${key} must be an object`);
  for (const [name, range] of Object.entries(value)) {
    if (!PEER_NAME.test(name)) {
      throw new CheckError(
        `${key} has an invalid package name ${JSON.stringify(name)}`,
      );
    }
    if (typeof range !== 'string' || range.trim() === '') {
      throw new CheckError(
        `${key}[${JSON.stringify(name)}] must be a non-empty version range string`,
      );
    }
  }
  return /** @type {Record<string, string>} */ (value);
}

/**
 * Validates `gasdev.gasTest`: the OAuth scopes of the test project and
 * an optional script ID.
 *
 * @param {unknown} value
 * @returns {GasTestConfig}
 */
function parseGasTest(value) {
  const key = 'package.json: "gasdev.gasTest"';
  if (!isRecord(value)) throw new CheckError(`${key} must be an object`);
  const unknown = Object.keys(value).filter((k) => !GAS_TEST_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new CheckError(
      `package.json: unknown key(s): ${unknown.map((k) => `"gasdev.gasTest.${k}"`).join(', ')} (expected: ${GAS_TEST_KEYS.join(', ')})`,
    );
  }
  const { scopes, scriptId } = value;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new CheckError(`${key}.scopes must be a non-empty array of strings`);
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !scope.startsWith(SCOPE_PREFIX)) {
      throw new CheckError(
        `${key}.scopes entry ${JSON.stringify(scope)} must be a string starting with "${SCOPE_PREFIX}"`,
      );
    }
    if (seen.has(scope)) {
      throw new CheckError(
        `${key}.scopes lists ${JSON.stringify(scope)} twice`,
      );
    }
    seen.add(scope);
  }
  if (
    scriptId !== undefined &&
    (typeof scriptId !== 'string' || scriptId.trim() === '')
  ) {
    throw new CheckError(`${key}.scriptId must be a non-empty string`);
  }
  return {
    scopes: /** @type {string[]} */ (scopes),
    ...(scriptId !== undefined && {
      scriptId: /** @type {string} */ (scriptId),
    }),
  };
}

/**
 * Describes why a value is not a relative POSIX path, or returns `undefined`.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
function relativePathProblem(value) {
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return 'must be relative to the project root';
  }
  if (value.includes('\\')) return 'must use "/" separators';
  if (value.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    return 'must not contain empty, "." or ".." segments';
  }
  return undefined;
}

/**
 * Validates `gasdev.html`: a non-empty list of `{ entry, out, name }`
 * objects with unique `out` and `name` values.
 *
 * @param {unknown} value
 * @returns {HtmlEntry[]}
 */
function parseHtml(value) {
  const key = 'package.json: "gasdev.html"';
  if (!Array.isArray(value) || value.length === 0) {
    throw new CheckError(`${key} must be a non-empty array of objects`);
  }
  /** @type {Set<string>} */
  const outs = new Set();
  /** @type {Set<string>} */
  const names = new Set();
  value.forEach((item, index) => {
    const path = `${key}[${index}]`;
    if (!isRecord(item)) throw new CheckError(`${path} must be an object`);
    const unknown = Object.keys(item).filter((k) => !HTML_KEYS.includes(k));
    if (unknown.length > 0) {
      throw new CheckError(
        `package.json: unknown key(s): ${unknown.map((k) => `"gasdev.html[${index}].${k}"`).join(', ')} (expected: ${HTML_KEYS.join(', ')})`,
      );
    }
    for (const field of HTML_KEYS) {
      const v = item[field];
      if (typeof v !== 'string' || v === '') {
        throw new CheckError(
          `${path}.${field} ${JSON.stringify(v)} must be a non-empty string`,
        );
      }
    }
    const { entry, out, name } = /** @type {Record<string, string>} */ (item);
    for (const [field, v] of [
      ['entry', entry],
      ['out', out],
    ]) {
      const problem = relativePathProblem(/** @type {string} */ (v));
      if (problem) {
        throw new CheckError(
          `${path}.${field} ${JSON.stringify(v)} ${problem}`,
        );
      }
    }
    if (!entry?.endsWith('.html')) {
      throw new CheckError(
        `${path}.entry ${JSON.stringify(entry)} must be an .html file`,
      );
    }
    if (!out?.startsWith('src/')) {
      throw new CheckError(
        `${path}.out ${JSON.stringify(out)} must be under src/`,
      );
    }
    if (!out.endsWith('.ts') || out.endsWith('.d.ts')) {
      throw new CheckError(
        `${path}.out ${JSON.stringify(out)} must be a .ts file other than .d.ts`,
      );
    }
    if (!name || !IDENTIFIER.test(name) || RESERVED_WORDS.has(name)) {
      throw new CheckError(
        `${path}.name ${JSON.stringify(name)} must be a valid JavaScript identifier`,
      );
    }
    if (outs.has(out)) {
      throw new CheckError(`${key} lists out ${JSON.stringify(out)} twice`);
    }
    if (names.has(name)) {
      throw new CheckError(`${key} lists name ${JSON.stringify(name)} twice`);
    }
    outs.add(out);
    names.add(name);
  });
  return /** @type {HtmlEntry[]} */ (value);
}

/**
 * Resolves and validates the `gasdev` field of package.json.
 *
 * @param {Record<string, unknown>} pkg
 * @returns {ResolvedConfig}
 */
function resolveConfig(pkg) {
  const legacy = legacyKeyMessage(pkg);
  if (legacy) {
    throw new CheckError(legacy);
  }
  const config = pkg['gasdev'] ?? {};
  if (!isRecord(config)) {
    throw new CheckError('package.json: "gasdev" must be an object');
  }
  const unknown = Object.keys(config).filter((k) => !KNOWN_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new CheckError(
      `package.json: unknown "gasdev" key(s): ${unknown.join(', ')} (expected: ${KNOWN_KEYS.join(', ')})`,
    );
  }
  for (const key of ['bundle', 'release', 'ci']) {
    if (config[key] !== undefined && !isRecord(config[key])) {
      throw new CheckError(`package.json: "gasdev.${key}" must be an object`);
    }
  }
  const preset = config['preset'] ?? 'gas';
  if (typeof preset !== 'string' || !PRESETS.includes(preset)) {
    throw new CheckError(
      `package.json: unknown preset ${JSON.stringify(preset)} (expected: ${PRESETS.join(', ')})`,
    );
  }
  for (const key of ['loadOrder', 'peers', 'gasTest', 'html']) {
    if (config[key] !== undefined && preset !== 'gas') {
      throw new CheckError(
        `package.json: "gasdev.${key}" requires the gas preset`,
      );
    }
  }
  if (config['gasTest'] !== undefined && config['loadOrder'] === undefined) {
    throw new CheckError(
      'package.json: "gasdev.gasTest" requires "gasdev.loadOrder"',
    );
  }
  if (config['html'] !== undefined && config['loadOrder'] === undefined) {
    throw new CheckError(
      'package.json: "gasdev.html" requires "gasdev.loadOrder"',
    );
  }
  return {
    preset,
    loadOrder:
      config['loadOrder'] === undefined
        ? undefined
        : parseLoadOrder(config['loadOrder']),
    peers:
      config['peers'] === undefined ? undefined : parsePeers(config['peers']),
    gasTest:
      config['gasTest'] === undefined
        ? undefined
        : parseGasTest(config['gasTest']),
    html: config['html'] === undefined ? undefined : parseHtml(config['html']),
  };
}

/**
 * Lists the meaningful lines of an ignore file: trimmed, without blanks and comments.
 *
 * @param {string} text
 * @returns {string[]}
 */
function ignoreEntries(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Normalises line endings and trailing whitespace for whole-file comparison.
 *
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  return text.replace(/[ \t\r]+$/gm, '').replace(/\n+$/, '');
}

/**
 * Reads the template of an ignore file.
 *
 * @param {string} preset
 * @param {string} name Ignore file name.
 * @returns {string}
 */
function readIgnoreTemplate(preset, name) {
  return readFileSync(new URL(`${preset}/${name.slice(1)}`, TEMPLATES), 'utf8');
}

/**
 * Requires every template entry to appear in the project's ignore file.
 *
 * @param {string} cwd
 * @param {string} preset
 * @param {string} name Ignore file name.
 * @returns {Drift[]}
 */
function checkIgnoreFile(cwd, preset, name) {
  const actual = readOptional(join(cwd, name));
  if (actual === undefined) return [{ file: name, message: 'file is missing' }];
  const template = readIgnoreTemplate(preset, name);
  const present = new Set(ignoreEntries(actual));
  return ignoreEntries(template)
    .filter((entry) => !present.has(entry))
    .map((entry) => ({ file: name, message: `missing line: ${entry}` }));
}

/**
 * Appends the missing template entries to a project's ignore file, or creates
 * the file from the template. Existing content is left untouched.
 *
 * @param {string} cwd
 * @param {string} preset
 * @param {string} name Ignore file name.
 * @returns {string[]} One message per change.
 */
function fixIgnoreFile(cwd, preset, name) {
  const path = join(cwd, name);
  const template = readIgnoreTemplate(preset, name);
  const actual = readOptional(path);
  if (actual === undefined) {
    writeFileSync(path, template);
    return [`${name}: created`];
  }
  const present = new Set(ignoreEntries(actual));
  const missing = ignoreEntries(template).filter((e) => !present.has(e));
  if (missing.length === 0) return [];
  const eol = actual.includes('\r\n') ? '\r\n' : '\n';
  const lead = actual !== '' && !actual.endsWith('\n') ? eol : '';
  writeFileSync(path, actual + lead + missing.map((e) => e + eol).join(''));
  return missing.map((entry) => `${name}: added ${entry}`);
}

/**
 * Requires the Dependabot configuration to equal the template.
 *
 * @param {string} cwd
 * @param {string} preset
 * @returns {Drift[]}
 */
function checkDependabot(cwd, preset) {
  const file = '.github/dependabot.yml';
  const actual = readOptional(join(cwd, file));
  if (actual === undefined) return [{ file, message: 'file is missing' }];
  const template = readFileSync(
    new URL(`${preset}/${file}`, TEMPLATES),
    'utf8',
  );
  if (normalise(actual) === normalise(template)) return [];
  return [
    { file, message: `differs from the template templates/${preset}/${file}` },
  ];
}

/**
 * Checks the standard package.json scripts.
 *
 * @param {Record<string, unknown>} pkg
 * @param {string} preset
 * @param {GasTestConfig | undefined} gasTest Configured `gasTest` settings, if any.
 * @returns {Drift[]}
 */
function checkScripts(pkg, preset, gasTest) {
  const file = 'package.json';
  const template = /** @type {ScriptsTemplate} */ (
    readJson(new URL(`${preset}/scripts.json`, TEMPLATES), 'scripts template')
  );
  const scripts = isRecord(pkg['scripts']) ? pkg['scripts'] : {};
  const isSelf = pkg['name'] === 'gasdev';
  /** @type {Drift[]} */
  const drift = [];
  const required = { ...template.required, ...(gasTest && template.gasTest) };
  for (const [name, wanted] of Object.entries(required)) {
    // The `npm run test &&` rewrite matches the template's `check` wording literally. If that
    // changes, test/check.test.js "requires the coverage gate in this package itself" fails.
    const expected = isSelf
      ? wanted
          .replace('gasdev check', `${SELF_BIN} check`)
          .replace('npm run test &&', `${SELF_TEST} &&`)
      : wanted;
    const found = scripts[name];
    if (found === undefined) {
      drift.push({
        file,
        message: `scripts.${name} is missing; expected: ${expected}`,
      });
    } else if (found !== expected) {
      drift.push({
        file,
        message: `scripts.${name} differs; expected: ${expected}; found: ${JSON.stringify(found)}`,
      });
    }
  }
  if (isSelf && scripts['test:coverage'] === undefined) {
    drift.push({ file, message: 'scripts.test:coverage is missing' });
  }
  for (const name of template.present) {
    if (scripts[name] === undefined) {
      drift.push({ file, message: `scripts.${name} is missing` });
    } else if (scripts[name] === placeholderScript(name)) {
      drift.push({
        file,
        message: `scripts.${name} is a placeholder; replace it with the project's command`,
        warning: true,
      });
    }
  }
  return drift;
}

/**
 * Requires every `loadOrder` entry to exist under `src/`.
 *
 * @param {string} cwd
 * @param {string[]} loadOrder
 * @returns {Drift[]}
 */
function checkLoadOrder(cwd, loadOrder) {
  return loadOrder
    .filter((entry) => !existsSync(join(cwd, 'src', entry)))
    .map((entry) => ({
      file: 'package.json',
      message: `gasdev.loadOrder: src/${entry} does not exist`,
    }));
}

/**
 * Requires each `html` entry to exist, its output to be in `loadOrder`, and
 * the output on disk to equal a fresh build.
 *
 * @param {string} cwd
 * @param {HtmlEntry[]} html
 * @param {string[]} loadOrder
 * @returns {Drift[]}
 */
function checkHtml(cwd, html, loadOrder) {
  /** @type {Drift[]} */
  const drift = [];
  for (const config of html) {
    const { entry, out } = config;
    if (!loadOrder.includes(out.slice('src/'.length))) {
      drift.push({
        file: 'package.json',
        message: `gasdev.loadOrder: ${out.slice('src/'.length)} (the output of ${entry}) is missing`,
      });
    }
    if (!existsSync(join(cwd, entry))) {
      drift.push({
        file: 'package.json',
        message: `gasdev.html: ${entry} does not exist`,
      });
      continue;
    }
    try {
      const state = compareModule(cwd, config);
      if (state !== 'current') {
        drift.push({
          file: out,
          message: `${state === 'missing' ? 'file is missing' : 'is out of date'}: run gasdev html`,
        });
      }
    } catch (error) {
      if (!(error instanceof HtmlError)) throw error;
      drift.push({ file: entry, message: error.message });
    }
  }
  return drift;
}

/**
 * Compares the `@version` header of the package's peer declarations with its `version`.
 * Returns no drift when `version` is not a string.
 *
 * @param {string} cwd Project root.
 * @param {Record<string, unknown>} pkg The project's package.json.
 * @returns {Drift[]}
 */
function checkPeerTypesVersion(cwd, pkg) {
  if (typeof pkg.version !== 'string') return [];
  const peer = readPeerTypesVersion(pkg, cwd);
  if (!peer) return [];
  const { file, declared } = peer;
  if (declared === undefined) {
    return [
      {
        file,
        message: `has no @version tag; expected: @version ${pkg.version}`,
      },
    ];
  }
  if (declared !== pkg.version) {
    return [
      {
        file,
        message: `@version ${declared} differs from package.json version ${pkg.version}`,
      },
    ];
  }
  return [];
}

/**
 * Reads package.json from a project.
 *
 * @param {string} cwd Project root.
 * @returns {Record<string, unknown>}
 * @throws {CheckError} When package.json is missing, invalid or not an object.
 */
function readPackage(cwd) {
  const pkg = readJson(join(cwd, 'package.json'), 'package.json');
  if (!isRecord(pkg)) throw new CheckError('package.json must be an object');
  return pkg;
}

/**
 * Reads and validates the `gasdev` field of a project's package.json.
 *
 * @param {string} cwd Project root.
 * @returns {ResolvedConfig}
 * @throws {CheckError} When package.json or the `gasdev` field is unusable or invalid.
 */
export function loadConfig(cwd) {
  return resolveConfig(readPackage(cwd));
}

/**
 * Compares a project's non-extendable configuration with the preset templates
 * and validates its `gasdev.loadOrder` files. Never writes.
 *
 * @param {string} cwd Project root.
 * @returns {{ preset: string, drift: Drift[] }}
 * @throws {CheckError} When package.json or the `gasdev` field is unusable or invalid.
 */
export function checkProject(cwd) {
  const pkg = readPackage(cwd);
  const { preset, loadOrder, gasTest, html } = resolveConfig(pkg);
  const drift = [
    ...checkIgnoreFile(cwd, preset, '.gitignore'),
    ...checkIgnoreFile(cwd, preset, '.prettierignore'),
    ...checkDependabot(cwd, preset),
    ...checkScripts(pkg, preset, gasTest),
    ...checkPeerTypesVersion(cwd, pkg),
    ...(loadOrder ? checkLoadOrder(cwd, loadOrder) : []),
    ...(loadOrder && html ? checkHtml(cwd, html, loadOrder) : []),
  ];
  return { preset, drift };
}

/**
 * Creates `.github/dependabot.yml` from the template when it is absent.
 *
 * @param {string} cwd
 * @param {string} preset
 * @returns {string[]} One message per change.
 */
function createDependabot(cwd, preset) {
  const file = '.github/dependabot.yml';
  const path = join(cwd, file);
  if (existsSync(path)) return [];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(new URL(`${preset}/${file}`, TEMPLATES)));
  return [`${file}: created`];
}

/**
 * Adds the required scripts missing from package.json, then a placeholder for
 * each missing script that must only be present, after the existing ones.
 * Existing scripts are never changed.
 *
 * @param {string} cwd
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @param {string} preset
 * @param {GasTestConfig | undefined} gasTest Configured `gasTest` settings, if any.
 * @returns {string[]} One message per added script.
 */
function addScripts(cwd, pkg, preset, gasTest) {
  const template = /** @type {ScriptsTemplate} */ (
    readJson(new URL(`${preset}/scripts.json`, TEMPLATES), 'scripts template')
  );
  const required = { ...template.required, ...(gasTest && template.gasTest) };
  const scripts = isRecord(pkg['scripts']) ? pkg['scripts'] : {};
  const missing = Object.entries(required).filter(
    ([name]) => scripts[name] === undefined,
  );
  const placeholders = template.present
    .filter((name) => scripts[name] === undefined)
    .map((name) => [name, placeholderScript(name)]);
  if (missing.length === 0 && placeholders.length === 0) return [];
  pkg['scripts'] = {
    ...scripts,
    ...Object.fromEntries(missing),
    ...Object.fromEntries(placeholders),
  };
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return [
    ...missing.map(([name]) => `package.json: added scripts.${name}`),
    ...placeholders.map(
      ([name]) =>
        `package.json: added a placeholder scripts.${name}; replace it with the project's command`,
    ),
  ];
}

/**
 * Scaffolds or repairs a project, for `init` and `check --fix`: applies the
 * ignore-file fixes, creates `.github/dependabot.yml` when absent, adds the
 * missing required scripts and adds placeholders for missing present-only ones.
 * Existing files and scripts are never overwritten. The configuration is
 * validated first, as is `scripts`, so an invalid one writes nothing.
 *
 * @param {string} cwd Project root.
 * @returns {string[]} One message per change.
 * @throws {CheckError} When package.json or the `gasdev` field is unusable or invalid.
 */
export function initProject(cwd) {
  const pkg = readPackage(cwd);
  const { preset, gasTest } = resolveConfig(pkg);
  if (pkg['scripts'] !== undefined && !isRecord(pkg['scripts'])) {
    throw new CheckError('package.json: scripts must be an object');
  }
  return [
    ...fixIgnoreFile(cwd, preset, '.gitignore'),
    ...fixIgnoreFile(cwd, preset, '.prettierignore'),
    ...createDependabot(cwd, preset),
    ...addScripts(cwd, pkg, preset, gasTest),
  ];
}

/**
 * Formats drift as one line per entry, grouped by file, followed by a summary.
 * Warnings are listed but do not fail the check.
 *
 * @param {Drift[]} drift
 * @param {{ fixed?: boolean }} [options] `fixed`: the fixes were applied first,
 *   so every remaining issue needs a manual edit.
 * @returns {string[]}
 */
export function formatReport(drift, { fixed = false } = {}) {
  /** @type {string[]} */
  const lines = [];
  for (const file of new Set(drift.map((d) => d.file))) {
    lines.push(file);
    for (const d of drift.filter((x) => x.file === file)) {
      lines.push(`  ${d.warning ? 'warning: ' : ''}${d.message}`);
    }
  }
  const errors = drift.filter((d) => !d.warning);
  const warnings = drift.length - errors.length;
  if (errors.length === 0) {
    lines.push(
      warnings === 0
        ? '✓ Config check passed'
        : `✓ Config check passed with ${warnings} warning(s)`,
    );
    return lines;
  }
  const files = new Set(errors.map((d) => d.file)).size;
  lines.push(
    `✗ Config check failed: ${errors.length} issue(s) in ${files} file(s)` +
      (fixed ? ' that --fix cannot fix; edit them manually' : ''),
  );
  return lines;
}
