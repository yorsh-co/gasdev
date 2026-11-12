// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { GhError, gh as runGh, listRulesets, readRuleset } from '../src/gh.js';

/**
 * @typedef {Record<string, any> & { name: string }} Ruleset
 */

/** Ruleset fields that are compared with the template. */
const COMPARED_FIELDS = /** @type {const} */ ([
  'target',
  'enforcement',
  'conditions',
  'rules',
  'bypass_actors',
]);

const TEMPLATES_DIR = new URL('../templates/github/rulesets/', import.meta.url);

const INSTALL_HINT =
  'gh was not found on PATH. Install GitHub CLI (https://cli.github.com), then run `gh auth login`.';

/** Raised when gh is missing, unauthenticated or a call fails. */
export class GithubError extends Error {}

/**
 * Runs gh, turning gh failures into GitHub errors.
 *
 * @param {string[]} args
 * @param {string} [input] Text written to stdin.
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 * @throws {GithubError} When gh cannot be started.
 */
function gh(args, input) {
  return viaGh(() => runGh(args, { input }));
}

/**
 * Runs a gh call, turning gh failures into GitHub errors.
 *
 * @template T
 * @param {() => T} run
 * @returns {T}
 * @throws {GithubError} When gh is missing or the call fails.
 */
function viaGh(run) {
  try {
    return run();
  } catch (error) {
    if (error instanceof GhError) {
      throw new GithubError(error.missing ? INSTALL_HINT : error.message);
    }
    throw error;
  }
}

/**
 * Runs a gh command that must succeed.
 *
 * @param {string[]} args
 * @param {string} [input] Text written to stdin.
 * @returns {string} Stdout.
 * @throws {GithubError} With gh's output when it exits non-zero.
 */
function ghStep(args, input) {
  const result = gh(args, input);
  if (result.status !== 0) {
    throw new GithubError(
      `gh ${args[0]} ${args[1]} failed (exit ${result.status}):\n${`${result.stdout}${result.stderr}`.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Checks that gh is authenticated and returns the current repository.
 *
 * @returns {string} The `owner/name` of the repository.
 * @throws {GithubError} When gh is unauthenticated or there is no GitHub remote.
 */
function resolveRepo() {
  if (gh(['auth', 'status']).status !== 0) {
    throw new GithubError('gh is not authenticated. Run `gh auth login`.');
  }
  return ghStep([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]).trim();
}

/**
 * Reads the ruleset templates, sorted by file name.
 *
 * @returns {Ruleset[]}
 */
export function loadTemplates() {
  return readdirSync(TEMPLATES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) =>
      JSON.parse(readFileSync(new URL(file, TEMPLATES_DIR), 'utf8')),
    );
}

/**
 * Reads every ruleset of a repository with its full body.
 *
 * @param {string} repo `owner/name`.
 * @returns {(Ruleset & { id: number })[]}
 * @throws {GithubError} When a gh call fails.
 */
function readRulesets(repo) {
  return viaGh(() =>
    listRulesets(repo, { includeParents: false })
      .filter(
        (/** @type {{ source_type?: string }} */ item) =>
          item.source_type === undefined || item.source_type === 'Repository',
      )
      .map((/** @type {{ id: number }} */ item) => readRuleset(repo, item.id)),
  );
}

/**
 * @template T
 * @param {T[]} list
 * @returns {T[]} A sorted copy.
 */
function sorted(list) {
  return [...list].sort();
}

/**
 * Picks the compared fields that are present and sorts the order-insensitive
 * lists: `conditions.ref_name.include`/`exclude` and `rules` by `type`.
 *
 * @param {Record<string, any>} ruleset
 * @returns {Record<string, any>}
 */
export function normalize(ruleset) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const field of COMPARED_FIELDS) {
    if (ruleset[field] === undefined) continue;
    result[field] = structuredClone(ruleset[field]);
  }
  const refName = result.conditions?.ref_name;
  if (refName) {
    for (const key of ['include', 'exclude']) {
      if (Array.isArray(refName[key])) refName[key] = sorted(refName[key]);
    }
  }
  if (Array.isArray(result.rules)) {
    result.rules.sort((/** @type {any} */ a, /** @type {any} */ b) =>
      String(a.type).localeCompare(String(b.type)),
    );
  }
  return result;
}

/**
 * @typedef {object} RulesetComparison
 * @property {Ruleset[]} missing Templates with no ruleset of that name.
 * @property {{ template: Ruleset, id: number, fields: string[] }[]} drifted
 * @property {string[]} extra Names of rulesets that are not in the template.
 * @property {string[]} inSync Names of rulesets that match.
 */

/**
 * Compares the templates with the rulesets on GitHub, matching by name. A
 * field absent from the actual ruleset is not compared.
 *
 * @param {Ruleset[]} templates
 * @param {(Ruleset & { id: number })[]} actual
 * @returns {RulesetComparison}
 */
export function compareRulesets(templates, actual) {
  /** @type {RulesetComparison} */
  const result = { missing: [], drifted: [], extra: [], inSync: [] };
  for (const template of templates) {
    const found = actual.find((r) => r.name === template.name);
    if (!found) {
      result.missing.push(template);
      continue;
    }
    const want = normalize(template);
    const have = normalize(found);
    const fields = COMPARED_FIELDS.filter(
      (field) =>
        have[field] !== undefined &&
        !isDeepStrictEqual(want[field], have[field]),
    );
    if (fields.length === 0) result.inSync.push(template.name);
    else result.drifted.push({ template, id: found.id, fields });
  }
  const names = new Set(templates.map((t) => t.name));
  result.extra = actual.map((r) => r.name).filter((name) => !names.has(name));
  return result;
}

/**
 * @param {string} repo
 * @param {RulesetComparison} result
 * @returns {string[]} Report lines.
 */
export function formatGithubReport(repo, result) {
  const lines = [`GitHub rulesets of ${repo}`];
  for (const name of result.inSync) lines.push(`  ✓ ruleset ${name}`);
  for (const { name } of result.missing) {
    lines.push(`  ✗ ruleset ${name}: missing`);
  }
  for (const { template, fields } of result.drifted) {
    lines.push(`  ✗ ruleset ${template.name}: differs in ${fields.join(', ')}`);
  }
  for (const name of result.extra) {
    lines.push(`  ! ruleset ${name}: not in the template (left unchanged)`);
  }
  const issues = result.missing.length + result.drifted.length;
  lines.push(
    issues === 0
      ? '✓ GitHub rulesets match the template'
      : `✗ GitHub rulesets differ from the template: ${issues} issue(s). Run gasdev github --fix to apply it.`,
  );
  return lines;
}

/**
 * Sends a template to GitHub with POST (create) or PUT (update).
 *
 * @param {string} repo `owner/name`.
 * @param {'POST' | 'PUT'} method
 * @param {string} path Endpoint below `repos/<repo>/`.
 * @param {Ruleset} template Request body.
 * @throws {GithubError} When the write fails.
 */
function writeRuleset(repo, method, path, template) {
  const args = ['api', '-X', method, `repos/${repo}/${path}`, '--input', '-'];
  const result = gh(args, JSON.stringify(template));
  if (result.status === 0) return;
  const output = `${result.stdout}${result.stderr}`.trim();
  throw new GithubError(
    /HTTP 403/.test(output)
      ? `cannot write rulesets on ${repo}: admin rights on the repository are needed (HTTP 403).`
      : `gh api ${method} failed (exit ${result.status}):\n${output}`,
  );
}

/**
 * Creates the missing rulesets and updates the drifted ones. Extra rulesets
 * are never touched.
 *
 * @param {string} repo `owner/name`.
 * @param {RulesetComparison} result
 * @throws {GithubError} At the first failed write.
 */
function applyTemplates(repo, { missing, drifted }) {
  for (const template of missing) {
    writeRuleset(repo, 'POST', 'rulesets', template);
    process.stdout.write(`  created ruleset ${template.name}\n`);
  }
  for (const { template, id } of drifted) {
    writeRuleset(repo, 'PUT', `rulesets/${id}`, template);
    process.stdout.write(`  updated ruleset ${template.name}\n`);
  }
}

/**
 * Reports drift of the repository's GitHub rulesets from the templates and,
 * with `fix`, creates or updates them.
 *
 * @param {{ fix: boolean }} options
 * @returns {number} 0 when the rulesets match or were fixed, 1 on drift.
 * @throws {GithubError} When gh is missing, unauthenticated or a call fails.
 */
export function runGithub({ fix }) {
  const repo = resolveRepo();
  const result = compareRulesets(loadTemplates(), readRulesets(repo));
  const clean = result.missing.length + result.drifted.length === 0;
  if (fix && !clean) {
    process.stdout.write(`GitHub rulesets of ${repo}\n`);
    for (const name of result.inSync) {
      process.stdout.write(`  ✓ ruleset ${name}\n`);
    }
    applyTemplates(repo, result);
    for (const name of result.extra) {
      process.stdout.write(
        `  ! ruleset ${name}: not in the template (left unchanged)\n`,
      );
    }
    process.stdout.write('✓ GitHub rulesets now match the template\n');
    return 0;
  }
  const out = formatGithubReport(repo, result).join('\n') + '\n';
  (clean ? process.stdout : process.stderr).write(out);
  return clean ? 0 : 1;
}
