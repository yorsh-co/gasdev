// @ts-check
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { templateDefaults } from '../src/ci/manifest-defaults.js';
import { legacyKeyMessage } from '../src/legacy-keys.js';
import { readPeerTypesVersion } from '../src/release/peer-types.js';
import { HtmlError, compareModule } from './html.js';

const PRESETS = ['gas', 'node'];
const PROJECT_TYPES = ['library', 'app', 'webapp'];
const KNOWN_KEYS = [
  'preset',
  'type',
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
const GASDEV_PACKAGE = new URL('../package.json', import.meta.url);

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
 * @property {Record<string, string>} [library] Scripts required, with exactly this value, for `library` projects and projects without a type.
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
 * @property {string | undefined} [type] Project type (`library`, `app` or `webapp`); undefined when unset.
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
  const type = config['type'];
  if (
    type !== undefined &&
    (typeof type !== 'string' || !PROJECT_TYPES.includes(type))
  ) {
    throw new CheckError(
      `package.json: unknown type ${JSON.stringify(type)} (expected: ${PROJECT_TYPES.join(', ')})`,
    );
  }
  for (const key of ['type', 'loadOrder', 'peers', 'gasTest', 'html']) {
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
    type,
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
 * @param {string | undefined} type Project type, if set.
 * @returns {Drift[]}
 */
function checkScripts(pkg, preset, gasTest, type) {
  const file = 'package.json';
  const template = /** @type {ScriptsTemplate} */ (
    readJson(new URL(`${preset}/scripts.json`, TEMPLATES), 'scripts template')
  );
  const scripts = isRecord(pkg['scripts']) ? pkg['scripts'] : {};
  const isSelf = pkg['name'] === 'gasdev';
  /** @type {Drift[]} */
  const drift = [];
  const required = {
    ...template.required,
    ...((type === undefined || type === 'library') && template.library),
    ...(gasTest && template.gasTest),
  };
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
 * Reads gasdev's own `engines.node` range, the source of truth for projects.
 *
 * @returns {string}
 */
function gasdevNodeRange() {
  const pkg = readJson(GASDEV_PACKAGE, 'gasdev package.json');
  const engines = isRecord(pkg) ? pkg['engines'] : undefined;
  const range = isRecord(engines) ? engines['node'] : undefined;
  if (typeof range !== 'string') {
    throw new CheckError('gasdev package.json: engines.node is missing');
  }
  return range;
}

/**
 * Reads a preset's `package.json` template.
 *
 * @param {string} preset
 * @returns {Record<string, unknown>}
 */
function readPackageTemplate(preset) {
  const template = readJson(
    new URL(`${preset}/package.json`, TEMPLATES),
    'package.json template',
  );
  return isRecord(template) ? template : {};
}

/**
 * Lists the overrides a project is expected to carry: the template's
 * `overrides`, plus `claspOverrides` when `@google/clasp` is a dependency.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @param {string} preset
 * @returns {Record<string, unknown>}
 */
function expectedOverrides(pkg, preset) {
  const template = readPackageTemplate(preset);
  const clasp = ['dependencies', 'devDependencies'].some(
    (key) => isRecord(pkg[key]) && pkg[key]['@google/clasp'] !== undefined,
  );
  return {
    ...(isRecord(template['overrides']) ? template['overrides'] : {}),
    ...(clasp && isRecord(template['claspOverrides'])
      ? template['claspOverrides']
      : {}),
  };
}

/**
 * Requires `type`, `prettier`, `engines.node` and `overrides` to match gasdev's
 * conventions. Extra overrides are ignored.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @param {string} preset
 * @returns {Drift[]}
 */
function checkPackageFields(pkg, preset) {
  const file = 'package.json';
  const template = readPackageTemplate(preset);
  /** @type {Drift[]} */
  const drift = [];
  /** @type {[string, unknown][]} */
  const fields = [['type', template['type']]];
  if (pkg['name'] !== 'gasdev') fields.push(['prettier', template['prettier']]);
  for (const [key, wanted] of fields) {
    const found = pkg[key];
    if (found === undefined) {
      drift.push({
        file,
        message: `${key} is missing; expected: ${JSON.stringify(wanted)}`,
      });
    } else if (found !== wanted) {
      drift.push({
        file,
        message: `${key} differs; expected: ${JSON.stringify(wanted)}; found: ${JSON.stringify(found)}`,
      });
    }
  }
  const range = gasdevNodeRange();
  const engines = pkg['engines'];
  const found = isRecord(engines) ? engines['node'] : undefined;
  if (engines !== undefined && !isRecord(engines)) {
    drift.push({ file, message: 'engines must be an object' });
  } else if (found === undefined) {
    drift.push({
      file,
      message: `engines.node is missing; expected: ${JSON.stringify(range)}`,
    });
  } else if (
    typeof found !== 'string' ||
    semver.validRange(found) === null ||
    !semver.subset(found, range)
  ) {
    drift.push({
      file,
      message: `engines.node ${JSON.stringify(found)} is not within gasdev's ${JSON.stringify(range)}`,
    });
  }
  const overrides = pkg['overrides'];
  if (overrides !== undefined && !isRecord(overrides)) {
    drift.push({ file, message: 'overrides must be an object' });
    return drift;
  }
  for (const [name, wanted] of Object.entries(expectedOverrides(pkg, preset))) {
    const found = overrides?.[name];
    if (found === undefined) {
      drift.push({
        file,
        message: `overrides.${name} is missing; expected: ${JSON.stringify(wanted)}`,
      });
    } else if (found !== wanted) {
      drift.push({
        file,
        message: `overrides.${name} differs; expected: ${JSON.stringify(wanted)}; found: ${JSON.stringify(found)}`,
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

const DEPLOY_REF =
  /^(\s*uses:\s*['"]?yorsh-co\/gasdev\/\.github\/workflows\/gas-deploy\.yml@)([^\s'"]+)([^\n]*)$/;

/**
 * Extracts the version of a `vX.Y.Z` (or prerelease) ref.
 *
 * @param {string} ref Ref after `@`.
 * @returns {string | null} The version without `v`, or null for other refs.
 */
function refVersion(ref) {
  return ref.startsWith('v') ? semver.valid(ref.slice(1)) : null;
}

/**
 * Reads gasdev's own version.
 *
 * @returns {string}
 */
function gasdevVersion() {
  const pkg = readJson(
    new URL('../package.json', import.meta.url),
    'gasdev package.json',
  );
  return /** @type {string} */ (/** @type {any} */ (pkg).version);
}

/**
 * Lists the workflow files of a project and their `gas-deploy.yml` references.
 * Line endings are kept: lines are split on `\n`, so a `\r` stays in the
 * trailing part of the match.
 *
 * @param {string} cwd Project root.
 * @returns {{ file: string, path: string, lines: string[], refs: { index: number, match: RegExpMatchArray }[] }[]}
 */
function findDeployRefs(cwd) {
  const dir = join(cwd, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const lines = readFileSync(path, 'utf8').split('\n');
      const refs = lines.flatMap((line, index) => {
        const match = line.match(DEPLOY_REF);
        return match ? [{ index, match }] : [];
      });
      return { file: `.github/workflows/${name}`, path, lines, refs };
    })
    .filter(({ refs }) => refs.length > 0);
}

/**
 * Reports `gas-deploy.yml` references that are not pinned to the installed
 * gasdev version. Skipped in gasdev itself.
 *
 * @param {string} cwd Project root.
 * @param {Record<string, unknown>} pkg The project's package.json.
 * @returns {Drift[]}
 */
function checkDeployWorkflowRef(cwd, pkg) {
  if (pkg['name'] === 'gasdev') return [];
  const version = gasdevVersion();
  return findDeployRefs(cwd).flatMap(({ file, refs }) =>
    refs.flatMap(({ match }) => {
      const ref = match[2] ?? '';
      const refVer = refVersion(ref);
      if (!refVer) {
        return [
          {
            file,
            message: `uses gas-deploy.yml@${ref}; pin it to v${version}`,
          },
        ];
      }
      return refVer === version
        ? []
        : [
            {
              file,
              message: `uses gas-deploy.yml@${ref}; installed gasdev is ${version}`,
            },
          ];
    }),
  );
}

/**
 * Rewrites the `vX.Y.Z` of `gas-deploy.yml` references to the installed gasdev
 * version, touching only that text. Other refs (branches, SHAs) are left as
 * deliberate pins. Skipped in gasdev itself.
 *
 * @param {string} cwd Project root.
 * @param {Record<string, unknown>} pkg The project's package.json.
 * @returns {string[]} One message per updated reference.
 */
function fixDeployWorkflowRef(cwd, pkg) {
  if (pkg['name'] === 'gasdev') return [];
  const version = gasdevVersion();
  return findDeployRefs(cwd).flatMap(({ file, path, lines, refs }) => {
    const stale = refs.filter(
      ({ match }) =>
        refVersion(match[2] ?? '') !== null && match[2] !== `v${version}`,
    );
    if (stale.length === 0) return [];
    for (const { index, match } of stale) {
      lines[index] = `${match[1]}v${version}${match[3]}`;
    }
    writeFileSync(path, lines.join('\n'));
    return stale.map(
      () => `${file}: gas-deploy.yml ref updated to v${version}`,
    );
  });
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
  const { preset, loadOrder, gasTest, html, type } = resolveConfig(pkg);
  const drift = [
    ...checkIgnoreFile(cwd, preset, '.gitignore'),
    ...checkIgnoreFile(cwd, preset, '.prettierignore'),
    ...checkDependabot(cwd, preset),
    ...checkScripts(pkg, preset, gasTest, type),
    ...checkPackageFields(pkg, preset),
    ...checkPeerTypesVersion(cwd, pkg),
    ...checkDeployWorkflowRef(cwd, pkg),
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
 * Creates the tsconfig and ESLint files for a project type, each only when absent.
 *
 * @param {string} cwd
 * @param {string} type One of `library`, `app` or `webapp`.
 * @param {boolean} gasTest Whether `gasdev.gasTest` is configured.
 * @returns {string[]} One message per file created.
 */
function createTypeFiles(cwd, type, gasTest) {
  /** @type {[string, string][]} Target file and its template under `gas/files`. */
  const files = [
    ['tsconfig.json', 'tsconfig.json'],
    ['tsconfig.test.json', 'tsconfig.test.json'],
    [
      'eslint.config.js',
      type === 'webapp' ? 'eslint.webapp.config.js' : 'eslint.config.js',
    ],
  ];
  if (gasTest) files.push(['gas-test/tsconfig.json', 'gas-test/tsconfig.json']);
  if (type === 'webapp') {
    files.push(['tsconfig.frontend.json', 'tsconfig.frontend.json']);
  }
  const messages = [];
  for (const [file, template] of files) {
    const path = join(cwd, file);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      readFileSync(new URL(`gas/files/${template}`, TEMPLATES)),
    );
    messages.push(`${file}: created`);
  }
  return messages;
}

/**
 * Creates the clasp and manifest templates of a deployed project (`app` or
 * `webapp`), each only when absent.
 *
 * @param {string} cwd
 * @param {string} type One of `library`, `app` or `webapp`.
 * @returns {string[]} One message per file created.
 */
function createDeployTemplates(cwd, type) {
  if (type === 'library') return [];
  const messages = [];
  for (const [file, value] of Object.entries(templateDefaults(type))) {
    const path = join(cwd, file);
    if (existsSync(path)) continue;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    messages.push(
      file === 'appsscript.example.json'
        ? `${file}: created; set oauthScopes in ${file}`
        : `${file}: created`,
    );
  }
  return messages;
}

/**
 * Creates the CI deploy workflow of a deployed project (`app` or `webapp`)
 * when absent, pinned to gasdev's own version.
 *
 * @param {string} cwd
 * @param {string} type One of `library`, `app` or `webapp`.
 * @returns {string[]} One message per file created.
 */
function createDeployWorkflow(cwd, type) {
  const file = '.github/workflows/deploy.yml';
  const path = join(cwd, file);
  if (type === 'library' || existsSync(path)) return [];
  const pkg = readJson(GASDEV_PACKAGE, 'gasdev package.json');
  const version = isRecord(pkg) ? pkg['version'] : undefined;
  const template = readFileSync(
    new URL('gas/files/.github/workflows/deploy.yml', TEMPLATES),
    'utf8',
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    template.replaceAll('{{GASDEV_VERSION}}', String(version)),
  );
  return [
    `${file}: created; add the dev and live environments (see "CI deployment" in the README)`,
  ];
}

/**
 * Adds the required scripts missing from package.json, then a placeholder for
 * each missing script that must only be present, after the existing ones.
 * Existing scripts are never changed. Mutates `pkg`; the caller writes it.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @param {string} preset
 * @param {GasTestConfig | undefined} gasTest Configured `gasTest` settings, if any.
 * @param {string | undefined} type Project type, if set.
 * @returns {string[]} One message per added script.
 */
function addScripts(pkg, preset, gasTest, type) {
  const template = /** @type {ScriptsTemplate} */ (
    readJson(new URL(`${preset}/scripts.json`, TEMPLATES), 'scripts template')
  );
  const required = {
    ...template.required,
    ...((type === undefined || type === 'library') && template.library),
    ...(gasTest && template.gasTest),
  };
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
  return [
    ...missing.map(([name]) => `package.json: added scripts.${name}`),
    ...placeholders.map(
      ([name]) =>
        `package.json: added a placeholder scripts.${name}; replace it with the project's command`,
    ),
  ];
}

/**
 * Adds the `type`, `prettier`, `engines.node` and `overrides` entries missing
 * from package.json.
 * Existing values are never changed. Mutates `pkg`; the caller writes it.
 *
 * @param {Record<string, unknown>} pkg Parsed package.json.
 * @param {string} preset
 * @returns {string[]} One message per added field.
 */
function addPackageFields(pkg, preset) {
  const template = readPackageTemplate(preset);
  /** @type {string[]} */
  const messages = [];
  const keys = pkg['name'] === 'gasdev' ? ['type'] : ['type', 'prettier'];
  for (const key of keys) {
    if (pkg[key] !== undefined) continue;
    pkg[key] = template[key];
    messages.push(`package.json: added ${key}`);
  }
  const engines = isRecord(pkg['engines']) ? pkg['engines'] : {};
  if (engines['node'] === undefined) {
    pkg['engines'] = { ...engines, node: gasdevNodeRange() };
    messages.push('package.json: added engines.node');
  }
  const overrides = isRecord(pkg['overrides']) ? pkg['overrides'] : {};
  const added = Object.entries(expectedOverrides(pkg, preset)).filter(
    ([name]) => overrides[name] === undefined,
  );
  if (added.length > 0) {
    pkg['overrides'] = { ...overrides, ...Object.fromEntries(added) };
    for (const [name] of added) {
      messages.push(
        `package.json: added overrides.${name}; run npm install to apply it`,
      );
    }
  }
  return messages;
}

/**
 * Asks which kind of project this is.
 *
 * @param {(question: import('prompts').PromptObject) => Promise<Record<string, any>>} prompt A `prompts`-compatible function.
 * @returns {Promise<string>} One of `library`, `app` or `webapp`.
 * @throws {CheckError} When the prompt is cancelled.
 */
export async function chooseProjectType(prompt) {
  const { type } = await prompt({
    type: 'select',
    name: 'type',
    message: 'Project type',
    choices: [
      {
        title: 'library',
        description:
          'consumed by other Apps Script projects; released with gasdev release',
        value: 'library',
      },
      {
        title: 'app',
        description:
          'a deployed Apps Script project (Sheets, Forms, Gmail, triggers, webhooks)',
        value: 'app',
      },
      {
        title: 'webapp',
        description: 'an app that is also redeployed as a web app',
        value: 'webapp',
      },
    ],
  });
  if (type === undefined) {
    throw new CheckError('init cancelled');
  }
  return type;
}

/**
 * Scaffolds or repairs a project, for `init` and `check --fix`: applies the
 * ignore-file fixes, creates `.github/dependabot.yml` when absent, adds the
 * missing required scripts, adds placeholders for missing present-only ones and
 * updates the `gas-deploy.yml@vX.Y.Z` workflow ref to the installed version.
 * Existing files and scripts are never overwritten. The configuration is
 * validated first, as are `scripts`, `engines` and `overrides`, so an invalid one writes
 * nothing. package.json is written once, and only when it changed.
 *
 * @param {string} cwd Project root.
 * @param {{ type?: string | undefined, init?: boolean }} [options] `type`: project type
 *   chosen by the user; persisted as `gasdev.type` when the project has none.
 *   `init`: also create the files driven by the project type (not for `check --fix`).
 * @returns {string[]} One message per change.
 * @throws {CheckError} When package.json or the `gasdev` field is unusable or invalid.
 */
export function initProject(cwd, { type, init = false } = {}) {
  const pkg = readPackage(cwd);
  const { preset, gasTest, type: configuredType } = resolveConfig(pkg);
  if (pkg['scripts'] !== undefined && !isRecord(pkg['scripts'])) {
    throw new CheckError('package.json: scripts must be an object');
  }
  if (pkg['engines'] !== undefined && !isRecord(pkg['engines'])) {
    throw new CheckError('package.json: engines must be an object');
  }
  if (pkg['overrides'] !== undefined && !isRecord(pkg['overrides'])) {
    throw new CheckError('package.json: overrides must be an object');
  }
  if (
    type !== undefined &&
    configuredType === undefined &&
    (preset !== 'gas' || !PROJECT_TYPES.includes(type))
  ) {
    throw new CheckError(
      `package.json: cannot set "gasdev.type" to ${JSON.stringify(type)}`,
    );
  }
  const projectType = configuredType ?? type;
  const files = [
    ...fixIgnoreFile(cwd, preset, '.gitignore'),
    ...fixIgnoreFile(cwd, preset, '.prettierignore'),
    ...createDependabot(cwd, preset),
    ...fixDeployWorkflowRef(cwd, pkg),
  ];
  const pkgMessages = [
    ...addScripts(pkg, preset, gasTest, projectType),
    ...addPackageFields(pkg, preset),
  ];
  if (type !== undefined && configuredType === undefined) {
    pkg['gasdev'] = { ...(isRecord(pkg['gasdev']) ? pkg['gasdev'] : {}), type };
    pkgMessages.push(`package.json: set gasdev.type to "${type}"`);
  }
  if (pkgMessages.length > 0) {
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify(pkg, null, 2) + '\n',
    );
  }
  if (init && preset === 'gas' && projectType !== undefined) {
    files.push(...createTypeFiles(cwd, projectType, gasTest !== undefined));
    files.push(...createDeployTemplates(cwd, projectType));
    files.push(...createDeployWorkflow(cwd, projectType));
  }
  return [...files, ...pkgMessages];
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
