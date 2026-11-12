#!/usr/bin/env node
// @ts-check
// Stand-in for the clasp entry script. Logs every call to $FAKE_CLASP_LOG; env vars pick the outcome:
// FAKE_CLASP_DEPLOYMENTS (JSON), FAKE_CLASP_VERSION_OUTPUT (raw stdout of create-version),
// FAKE_CLASP_DEPLOY_OUTPUT (raw stdout of create-deployment), FAKE_CLASP_MANIFEST (JSON written by pull),
// FAKE_CLASP_KILL (command that kills itself with SIGTERM), FAKE_CLASP_NO_MANIFEST (pull writes nothing),
// FAKE_CLASP_FAIL (command name that exits 1), FAKE_CLASP_ECHO (text printed on failure),
// FAKE_CLASP_USER (email, empty = logged out), FAKE_CLASP_SCRIPT_ID (script id of create-script),
// FAKE_CLASP_OUTPUT (raw stdout for show-authorized-user and create-script), FAKE_CLASP_LOGIN_USER
// (email that `login` signs in: later show-authorized-user calls report it, tracked in a state file
// next to the log). Handles show-authorized-user, login, create-script, open-script and
// list-deployments [scriptId] besides the deploy commands.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);

/** The path to pass as `bin`. */
export const fakeClaspBin = SCRIPT;

/**
 * Reads the calls logged by the fake.
 *
 * @param {string} logPath
 * @returns {{ args: string[], cwd: string, projectDir?: string, authFile?: string, files: Record<string, string>, claspEnv: Record<string, string | undefined>, envKeys: string[] }[]}
 */
export function readCalls(logPath) {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** Handles one invocation. */
function main() {
  const args = process.argv.slice(2);
  const env = process.env;
  const authIndex = args.indexOf('-A');
  const authFile = authIndex === -1 ? undefined : args[authIndex + 1];
  const projectIndex = args.indexOf('-P');
  const projectDir = projectIndex === -1 ? undefined : args[projectIndex + 1];
  /** @type {Record<string, string>} */
  const files = {};
  if (projectDir) {
    files['.clasp.json'] = readFileSync(
      join(projectDir, '.clasp.json'),
      'utf8',
    );
  }
  appendFileSync(
    /** @type {string} */ (env.FAKE_CLASP_LOG),
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      projectDir,
      authFile,
      files,
      claspEnv: {
        clasp_config_auth: env.clasp_config_auth,
        clasp_config_project: env.clasp_config_project,
        clasp_config_ignore: env.clasp_config_ignore,
        CLASPRC_JSON: env.CLASPRC_JSON,
      },
      envKeys: Object.keys(env).sort(),
    })}\n`,
  );
  const command =
    args.filter(
      (arg) =>
        arg !== '--json' &&
        arg !== '-P' &&
        arg !== projectDir &&
        arg !== '-A' &&
        arg !== authFile,
    )[0] ?? '';

  if (env.FAKE_CLASP_FAIL === command) {
    process.stderr.write(`${command} exploded ${env.FAKE_CLASP_ECHO ?? ''}\n`);
    process.exit(1);
  }
  if (env.FAKE_CLASP_KILL === command) {
    process.kill(process.pid, 'SIGTERM');
  }
  const json = (/** @type {unknown} */ value) =>
    process.stdout.write(`${JSON.stringify(value)}\n`);

  if (
    env.FAKE_CLASP_OUTPUT !== undefined &&
    (command === 'show-authorized-user' || command === 'create-script')
  ) {
    process.stdout.write(`${env.FAKE_CLASP_OUTPUT}\n`);
  } else if (command === 'show-authorized-user') {
    const loggedInFile = `${env.FAKE_CLASP_LOG}.login`;
    const email = existsSync(loggedInFile)
      ? readFileSync(loggedInFile, 'utf8')
      : (env.FAKE_CLASP_USER ?? '');
    json(email ? { loggedIn: true, email } : { loggedIn: false });
  } else if (command === 'create-script') {
    const rootDir = /** @type {string} */ (args[args.indexOf('--rootDir') + 1]);
    const scriptId = env.FAKE_CLASP_SCRIPT_ID ?? 'script-123';
    writeFileSync(
      join(rootDir, '.clasp.json'),
      JSON.stringify({ scriptId, rootDir }),
    );
    writeFileSync(
      join(rootDir, 'appsscript.json'),
      JSON.stringify({ timeZone: 'America/New_York' }),
    );
    json({ scriptId });
  } else if (command === 'login' || command === 'open-script') {
    if (command === 'login' && env.FAKE_CLASP_LOGIN_USER) {
      writeFileSync(`${env.FAKE_CLASP_LOG}.login`, env.FAKE_CLASP_LOGIN_USER);
    }
    process.stdout.write(`${command} ok\n`);
  } else if (command === 'list-deployments') {
    process.stdout.write(`${env.FAKE_CLASP_DEPLOYMENTS ?? '[]'}\n`);
  } else if (command === 'create-version') {
    process.stdout.write(
      `${env.FAKE_CLASP_VERSION_OUTPUT ?? JSON.stringify({ versionNumber: 7 })}\n`,
    );
  } else if (command === 'create-deployment') {
    const id = args[args.indexOf('-i') + 1];
    process.stdout.write(
      `${env.FAKE_CLASP_DEPLOY_OUTPUT ?? JSON.stringify({ deploymentId: id, versionNumber: 7 })}\n`,
    );
  } else if (command === 'pull' && projectDir) {
    if (!env.FAKE_CLASP_NO_MANIFEST) {
      writeFileSync(
        join(projectDir, 'appsscript.json'),
        env.FAKE_CLASP_MANIFEST ?? JSON.stringify({ oauthScopes: [] }),
      );
    }
    process.stdout.write('pull ok\n');
  } else if (command === 'push') {
    process.stdout.write('push ok\n');
  } else {
    json({ unexpected: args });
    process.exit(1);
  }
}

if (basename(process.argv[1] ?? '') === basename(SCRIPT)) {
  main();
}
