#!/usr/bin/env node
// @ts-check
// Stand-in for the GitHub CLI. Logs every call to $FAKE_GH_LOG; $FAKE_GH_VIEW, $FAKE_GH_CREATE and $FAKE_GH_RULES pick the outcome.
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [command, subcommand] = args;
const stdin = args.includes('-') ? readFileSync(0, 'utf8') : '';
appendFileSync(
  /** @type {string} */ (process.env.FAKE_GH_LOG),
  `${JSON.stringify({ args, stdin })}\n`,
);

if (command === 'release' && subcommand === 'view') {
  const view = process.env.FAKE_GH_VIEW;
  if (view === 'absent') {
    process.stderr.write('release not found\n');
    process.exit(1);
  }
  if (view === 'error') {
    process.stderr.write('HTTP 401: Bad credentials\n');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ isDraft: view === 'draft' })}\n`);
} else if (command === 'release' && subcommand === 'create') {
  if (process.env.FAKE_GH_CREATE === 'fail') {
    process.stderr.write('HTTP 422: Validation Failed\n');
    process.exit(1);
  }
  if (process.env.FAKE_GH_CREATE === 'silent-fail') {
    process.exit(1);
  }
} else if (command === 'api') {
  api(String(subcommand));
} else {
  process.stderr.write(`unexpected gh call: ${args.join(' ')}\n`);
  process.exit(1);
}

/**
 * Answers `gh api` for the rulesets endpoints. $FAKE_GH_RULES unset means fully protected,
 * `error` fails, `garbage` prints non-JSON, anything else is a JSON file `{ branches, rulesets }`.
 * A ruleset with `listOnly` appears in the list but has no detail (404).
 *
 * @param {string} path
 */
function api(path) {
  const mode = process.env.FAKE_GH_RULES;
  if (mode === 'error') {
    process.stderr.write('HTTP 401: Bad credentials\n');
    process.exit(1);
  }
  if (mode === 'garbage') {
    process.stdout.write('not json\n');
    process.exit(0);
  }
  const data = mode
    ? JSON.parse(readFileSync(mode, 'utf8'))
    : {
        branches: null,
        rulesets: [
          {
            id: 1,
            name: 'tags',
            target: 'tag',
            enforcement: 'active',
            conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
            rules: [
              { type: 'deletion' },
              { type: 'non_fast_forward' },
              { type: 'update' },
            ],
          },
        ],
      };
  const route = path.split('?')[0] ?? '';
  const branch = route.match(/\/rules\/branches\/(.+)$/);
  const ruleset = route.match(/\/rulesets\/(\d+)$/);
  let body;
  if (branch) {
    const name = (branch[1] ?? '').split('/').map(decodeURIComponent).join('/');
    const types = mode
      ? ((data.branches ?? {})[name] ?? [])
      : ['deletion', 'non_fast_forward'];
    body = types.map((/** @type {string} */ type) => ({ type }));
  } else if (ruleset) {
    body = (data.rulesets ?? []).find(
      (/** @type {{ id: number, listOnly?: boolean }} */ r) =>
        r.id === Number(ruleset[1]) && !r.listOnly,
    );
    if (!body) {
      process.stderr.write('HTTP 404: Not Found\n');
      process.exit(1);
    }
  } else if (route.endsWith('/rulesets')) {
    body = (data.rulesets ?? []).map(
      (/** @type {Record<string, unknown>} */ r) => ({
        id: r.id,
        name: r.name,
        target: r.target,
        enforcement: r.enforcement,
      }),
    );
  } else {
    process.stderr.write(`unexpected gh call: api ${path}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(body)}\n`);
}
