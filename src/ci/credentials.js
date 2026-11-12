// @ts-check
import { closeSync, fchmodSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes the clasp credentials to `<dir>/.clasprc.json`, readable only by the owner.
 *
 * @param {string} dir
 * @param {Record<string, unknown>} clasprc
 * @returns {string} Path of the credentials file.
 */
export function writeCredentials(dir, clasprc) {
  const path = join(dir, '.clasprc.json');
  const fd = openSync(path, 'w', 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, JSON.stringify(clasprc));
  } finally {
    closeSync(fd);
  }
  return path;
}
