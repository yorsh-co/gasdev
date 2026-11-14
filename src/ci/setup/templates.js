// @ts-check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeployError } from '../errors.js';
import { templateDefaults } from '../manifest-defaults.js';

/**
 * Reads `gasdev.type` from the project's `package.json`.
 *
 * @param {string} cwd Project root.
 * @returns {string | undefined} The type, or undefined when unset or unreadable.
 */
function readProjectType(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const type = pkg?.gasdev?.type;
    return typeof type === 'string' ? type : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Offers to create the clasp and manifest templates that are missing from a project.
 * Existing files are never overwritten, and nothing is written without a `package.json`.
 *
 * @param {string} cwd Project root.
 * @param {import('./io.js').Io} io Console helpers.
 * @returns {Promise<void>}
 * @throws {DeployError} When the user declines to create the missing templates.
 * @throws {import('../errors.js').CancelledError} When the user cancels the prompt.
 */
export async function createMissingTemplates(cwd, io) {
  if (!existsSync(join(cwd, 'package.json'))) {
    return;
  }
  const missing = Object.entries(
    templateDefaults(readProjectType(cwd) ?? 'app'),
  ).filter(([name]) => !existsSync(join(cwd, name)));
  if (missing.length === 0) {
    return;
  }
  const names = missing.map(([name]) => name).join(' and ');
  const { create } = await io.prompt({
    type: 'confirm',
    name: 'create',
    message: `Create ${names} with defaults?`,
    initial: true,
  });
  if (!create) {
    throw new DeployError(
      `${names} not found; create ${missing.length === 1 ? 'it' : 'them'} or rerun setup and accept the defaults (see "Commit the clasp and manifest templates" in the README).`,
    );
  }
  for (const [name, value] of missing) {
    writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`);
    io.log.success(`Created ${name}; review and commit it.`);
  }
}
