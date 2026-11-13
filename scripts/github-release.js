// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReleaseError } from '../src/release/errors.js';
import {
  changelogSection,
  createRelease,
  findRelease,
} from '../src/release/github-release.js';

const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;

/**
 * Creates the GitHub Release for a stable tag of this repository, using the
 * matching CHANGELOG section as notes. A no-op when the Release is published.
 *
 * @param {string[]} argv Arguments after the script name: the tag.
 * @param {{ cwd: string, env: Record<string, string | undefined> }} context
 * @returns {number} The process exit code.
 */
export function main(argv, { cwd, env }) {
  /** @param {string} message */
  const fail = (message) => {
    console.error(`✗ ${message}`);
    return 1;
  };

  const repo = env['GITHUB_REPOSITORY'];
  if (!repo) return fail('GITHUB_REPOSITORY is not set');

  const tag = argv[0];
  if (!tag) return fail('Usage: node scripts/github-release.js <tag>');

  const version = STABLE_TAG.exec(tag)?.[1];
  if (!version) return fail(`${tag} is not a stable vX.Y.Z tag`);

  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  if (pkg.version !== version) {
    return fail(`${tag} does not match package.json version ${pkg.version}`);
  }

  const section = changelogSection(cwd, version);
  if (!section) return fail(`CHANGELOG.md has no section for ${version}`);

  try {
    const state = findRelease(repo, tag, cwd);
    if (state === 'published') {
      console.log(`✓ GitHub Release ${tag} already exists`);
      return 0;
    }
    if (state === 'draft') {
      return fail(
        `A draft GitHub Release for ${tag} exists; publish or delete it by hand`,
      );
    }
    createRelease(repo, tag, section, cwd);
    console.log(`✓ Created GitHub Release ${tag}`);
    return 0;
  } catch (error) {
    if (error instanceof ReleaseError) return fail(error.message);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
  });
}
