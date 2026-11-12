// @ts-check
// Guards the fake-clasp assumptions against clasp upgrades: every command and
// flag the wrapper relies on must still exist in the bundled clasp CLI.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveClaspBin } from '../../src/clasp-bin.js';

/**
 * Runs `clasp <args> --help` offline and returns its output.
 * @param {string[]} args
 * @returns {string}
 */
function help(args) {
  return execFileSync(
    process.execPath,
    [resolveClaspBin(), ...args, '--help'],
    {
      encoding: 'utf8',
    },
  );
}

/**
 * Matches a whole flag, not a substring of a longer option.
 * @param {string} flag
 * @returns {RegExp}
 */
function flagPattern(flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,])${escaped}($|[\\s,=])`, 'm');
}

/** @type {Array<[string, string[]]>} */
const commands = [
  ['push', ['--force']],
  ['list-deployments', []],
  ['show-authorized-user', []],
  ['login', []],
  ['create-script', ['--title', '--rootDir']],
  ['open-script', []],
  ['create-version', []],
  ['create-deployment', ['-i', '-V', '-d']],
  ['pull', ['--versionNumber']],
];

describe('bundled clasp contract', () => {
  it('lists the global flags', () => {
    const out = help([]);
    for (const flag of ['--json', '-P', '-A']) {
      expect(out).toMatch(flagPattern(flag));
    }
  });

  it.each(commands)('%s supports its flags', (command, flags) => {
    const out = help([command]);
    // clasp prints global help with exit 0 for unknown commands, so match the command's own usage line.
    expect(out).toMatch(new RegExp(`^Usage: clasp ${command}[| ]`, 'm'));
    for (const flag of flags) {
      expect(out).toMatch(flagPattern(flag));
    }
  });
});
