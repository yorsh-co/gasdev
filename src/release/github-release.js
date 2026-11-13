// @ts-check
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh } from '../gh.js';
import { ReleaseError, viaGh } from './errors.js';
import { git } from './git.js';

const GITHUB_URL =
  /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

/** scp-like `[user@]host:owner/repo`; the host must not start with `-`. */
const SCP_LIKE_URL =
  /^(?:[\w.-]+@)?(\w[\w.-]*):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

/**
 * Resolves an SSH host (possibly a `~/.ssh/config` alias) to its real hostname.
 *
 * @param {string} host
 * @returns {string} The lowercased hostname, or `''` when ssh cannot resolve it.
 */
function sshHostname(host) {
  const result = spawnSync('ssh', ['-G', host], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  const line = result.stdout.split('\n').find((l) => l.startsWith('hostname '));
  return line ? line.slice('hostname '.length).trim().toLowerCase() : '';
}

/**
 * Resolves the `owner/repo` of a GitHub remote from its raw configured URL.
 * An scp-like URL whose host is an SSH alias for github.com (resolved with
 * `ssh -G`) is accepted too.
 *
 * @param {string} remote Remote name.
 * @param {string} cwd Project root.
 * @returns {string}
 * @throws {ReleaseError} When the remote is not a GitHub repository.
 */
export function githubRepo(remote, cwd) {
  let url = '';
  try {
    url = git(['config', '--get', `remote.${remote}.url`], cwd);
  } catch {
    // An unset URL is reported below as a non-GitHub remote.
  }
  const match = GITHUB_URL.exec(url);
  if (!match) {
    const scp = SCP_LIKE_URL.exec(url);
    if (scp && sshHostname(/** @type {string} */ (scp[1])) === 'github.com') {
      return /** @type {string} */ (scp[2]);
    }
    throw new ReleaseError(
      `Remote ${remote} (${url || 'no URL'}) is not a GitHub repository — githubRelease requires one.`,
    );
  }
  return /** @type {string} */ (match[1]);
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the CHANGELOG section for a version, without its heading, trailing
 * link definitions or trailing rule.
 *
 * @param {string} cwd Project root.
 * @param {string} version Version without the `v` prefix.
 * @returns {string} The section, or `''` when the file or section is missing or empty.
 */
export function changelogSection(cwd, version) {
  let changelog;
  try {
    changelog = readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8');
  } catch {
    return '';
  }
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[v?${escapeRegExp(version)}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return '';
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('## '),
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .replace(/(?:\s*\n\[[^\]]+\]:\s[^\n]*)+\s*$/, '')
    .replace(/(?:\s*\n---\s*)+$/, '')
    .trim();
}

/**
 * Builds the release notes: the CHANGELOG section for the version, else the
 * tag annotation, else the tag name.
 *
 * @param {string} cwd Project root.
 * @param {string} version Version without the `v` prefix.
 * @returns {string}
 */
export function releaseNotes(cwd, version) {
  const tag = `v${version}`;
  const section = changelogSection(cwd, version);
  if (section) return section;

  let annotation = '';
  try {
    // A lightweight tag's contents are its commit message, not an annotation.
    const isAnnotated =
      git(
        ['for-each-ref', '--format=%(objecttype)', `refs/tags/${tag}`],
        cwd,
      ) === 'tag';
    if (isAnnotated) {
      annotation = git(['tag', '-l', '--format=%(contents)', tag], cwd);
    }
  } catch {
    // Treated as no annotation.
  }
  return annotation || tag;
}

/**
 * Looks up the GitHub Release for a tag.
 *
 * @param {string} repo `owner/repo`.
 * @param {string} tag Tag name.
 * @param {string} cwd Project root.
 * @returns {'absent' | 'published' | 'draft'}
 * @throws {ReleaseError} When gh is missing or fails for another reason.
 */
export function findRelease(repo, tag, cwd) {
  const result = viaGh(() =>
    gh(['release', 'view', tag, '-R', repo, '--json', 'isDraft'], { cwd }),
  );
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    if (stderr.includes('release not found')) return 'absent';
    throw new ReleaseError(`gh release view ${tag} failed: ${stderr}`);
  }
  try {
    return JSON.parse(result.stdout).isDraft ? 'draft' : 'published';
  } catch {
    throw new ReleaseError(
      `gh release view ${tag} returned unexpected output: ${result.stdout.trim()}`,
    );
  }
}

/**
 * Creates the GitHub Release for an existing remote tag.
 *
 * @param {string} repo `owner/repo`.
 * @param {string} tag Tag name.
 * @param {string} notes Release notes, passed on stdin.
 * @param {string} cwd Project root.
 * @throws {ReleaseError} With the install hint when gh is missing, or with gh's stderr (its exit
 *   status if stderr is empty) when gh exits non-zero.
 */
export function createRelease(repo, tag, notes, cwd) {
  const result = viaGh(() =>
    gh(
      [
        'release',
        'create',
        tag,
        '-R',
        repo,
        '--verify-tag',
        '--title',
        tag,
        '--notes-file',
        '-',
      ],
      { cwd, input: notes },
    ),
  );
  if (result.status !== 0) {
    throw new ReleaseError(
      (result.stderr ?? '').trim() ||
        `gh release create ${tag} failed (exit ${result.status})`,
    );
  }
}

/**
 * Path, relative to the project root, where notes are saved for a manual retry.
 *
 * @param {string} tag Tag name.
 * @returns {string}
 */
export function notesPath(tag) {
  return `.worktrees/github-release-${tag}.md`;
}

/**
 * The command that creates the Release by hand, reading notes from {@link notesPath}.
 *
 * @param {string} repo `owner/repo`.
 * @param {string} tag Tag name.
 * @returns {string}
 */
export function retryCommand(repo, tag) {
  return `gh release create ${tag} -R ${repo} --verify-tag --title ${tag} --notes-file ${notesPath(tag)}`;
}
