// @ts-check
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MISSING_GH, ReleaseError } from '../../src/release/errors.js';
import {
  changelogSection,
  createRelease,
  findRelease,
  githubRepo,
  notesPath,
  releaseNotes,
  retryCommand,
} from '../../src/release/github-release.js';
import { cleanup, createProject, fakeGh, git } from './helpers/project.js';

const KEYS = ['PATH', 'FAKE_GH_LOG', 'FAKE_GH_VIEW', 'FAKE_GH_CREATE'];

/** @type {Record<string, string | undefined>} */
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  cleanup();
});

/**
 * @param {Parameters<typeof fakeGh>[0]} behavior
 * @returns {ReturnType<typeof fakeGh>}
 */
function setup(behavior) {
  const gh = fakeGh(behavior);
  Object.assign(process.env, gh.env);
  return gh;
}

/** Points PATH at an empty directory so gh cannot be found. */
function withoutGh() {
  process.env.PATH = mkdtempSync(join(tmpdir(), 'gasdev-no-gh-'));
  emptyDirs.push(process.env.PATH);
}

/** @type {string[]} */
const emptyDirs = [];
afterEach(() => {
  for (const dir of emptyDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * @param {string} url
 * @returns {string}
 */
function repoFor(url) {
  const { root } = createProject();
  git(root, 'config', 'remote.origin.url', url);
  return githubRepo('origin', root);
}

describe('githubRepo', () => {
  it.each([
    'https://github.com/acme/gas-lib.git',
    'https://github.com/acme/gas-lib',
    'git@github.com:acme/gas-lib.git',
    'git@github.com:acme/gas-lib',
    'ssh://git@github.com/acme/gas-lib.git',
    'ssh://git@github.com:22/acme/gas-lib.git',
    'https://user@github.com/acme/gas-lib.git',
    'https://x-access-token:TOKEN@github.com/acme/gas-lib',
  ])('parses %s', (url) => {
    expect(repoFor(url)).toBe('acme/gas-lib');
  });

  it.each([
    'https://gitlab.com/acme/gas-lib.git',
    'https://github.com.evil.example/acme/gas-lib.git',
    'git@example.com:acme/gas-lib.git',
    'https://github.com/ac;me/gas-lib.git',
    'git@github.com:acme/$(gas-lib)',
  ])('rejects %s', (url) => {
    expect(() => repoFor(url)).toThrow(ReleaseError);
    expect(() => repoFor(url)).toThrow(/is not a GitHub repository/);
  });

  describe('SSH host aliases', () => {
    const originalPath = process.env.PATH;
    /** @type {string} */
    let bin;

    afterEach(() => {
      process.env.PATH = originalPath;
      rmSync(bin, { recursive: true, force: true });
    });

    /** Puts an `ssh` stub on PATH that maps the host `gh-alias` to github.com. */
    function stubSsh() {
      bin = mkdtempSync(join(tmpdir(), 'fake-ssh-'));
      const ssh = join(bin, 'ssh');
      writeFileSync(
        ssh,
        '#!/bin/sh\n[ "$2" = gh-alias ] && echo "hostname github.com" || echo "hostname $2"\n',
      );
      chmodSync(ssh, 0o755);
      process.env.PATH = `${bin}${delimiter}${originalPath}`;
    }

    it.each(['gh-alias:acme/gas-lib.git', 'git@gh-alias:acme/gas-lib'])(
      'resolves %s through ssh -G',
      (url) => {
        stubSsh();
        expect(repoFor(url)).toBe('acme/gas-lib');
      },
    );

    it.each(['other-alias:acme/gas-lib.git', '-oFoo:acme/gas-lib'])(
      'rejects %s',
      (url) => {
        stubSsh();
        expect(() => repoFor(url)).toThrow(/is not a GitHub repository/);
      },
    );
  });
});

describe('releaseNotes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- later',
    '',
    '---',
    '',
    '## [1.1.0] - 2026-02-01',
    '',
    '### Added',
    '',
    '- newer',
    '',
    '---',
    '',
    '## [v1.0.0] - 2026-01-01',
    '',
    '### Added',
    '',
    '- first',
    '',
    '---',
    '',
  ].join('\n');

  it('extracts the section among several, without heading or trailing rule', () => {
    const { root } = createProject({ files: { 'CHANGELOG.md': changelog } });
    expect(releaseNotes(root, '1.1.0')).toBe('### Added\n\n- newer');
  });

  it('accepts the [vX.Y.Z] heading form', () => {
    const { root } = createProject({ files: { 'CHANGELOG.md': changelog } });
    expect(releaseNotes(root, '1.0.0')).toBe('### Added\n\n- first');
  });

  it('drops trailing link definitions from the last section', () => {
    const { root } = createProject({
      files: {
        'CHANGELOG.md': `${changelog}\n[1.0.0]: https://example.com/1.0.0\n[Unreleased]: https://example.com/u\n`,
      },
    });
    expect(releaseNotes(root, '1.0.0')).toBe('### Added\n\n- first');
  });

  it('falls back to the tag annotation when the section is missing', () => {
    const { root } = createProject({ files: { 'CHANGELOG.md': changelog } });
    git(root, 'tag', '-a', 'v2.0.0', '-m', 'Annotated notes');
    expect(releaseNotes(root, '2.0.0')).toBe('Annotated notes');
  });

  it('falls back to the tag name without a section or annotation', () => {
    const { root } = createProject();
    expect(releaseNotes(root, '1.0.0')).toBe('v1.0.0');
  });
});

describe('changelogSection', () => {
  it('returns the section without heading or trailing rule', () => {
    const { root } = createProject({
      files: {
        'CHANGELOG.md':
          '# Changelog\n\n## [1.1.0] - 2026-02-01\n\n- newer\n\n---\n\n## [1.0.0]\n\n- first\n',
      },
    });
    expect(changelogSection(root, '1.1.0')).toBe('- newer');
  });

  it('returns an empty string when the section is missing', () => {
    const { root } = createProject();
    expect(changelogSection(root, '2.0.0')).toBe('');
  });

  it('returns an empty string without a CHANGELOG', () => {
    const { root } = createProject();
    rmSync(join(root, 'CHANGELOG.md'));
    expect(changelogSection(root, '1.0.0')).toBe('');
  });
});

describe('retry helpers', () => {
  it('builds the notes path and retry command', () => {
    expect(notesPath('v1.0.0')).toBe('.worktrees/github-release-v1.0.0.md');
    expect(retryCommand('acme/gas-lib', 'v1.0.0')).toBe(
      'gh release create v1.0.0 -R acme/gas-lib --verify-tag --title v1.0.0 --notes-file .worktrees/github-release-v1.0.0.md',
    );
  });
});

describe('findRelease', () => {
  it.each(/** @type {const} */ (['absent', 'published', 'draft']))(
    'returns %s',
    (view) => {
      setup({ view });
      expect(findRelease('acme/gas-lib', 'v1.0.0', process.cwd())).toBe(view);
    },
  );

  it('throws a ReleaseError when gh fails', () => {
    setup({ view: 'error' });
    expect(() => findRelease('acme/gas-lib', 'v1.0.0', process.cwd())).toThrow(
      ReleaseError,
    );
  });

  it('throws the missing-gh hint when gh is not installed', () => {
    withoutGh();
    expect(() => findRelease('acme/gas-lib', 'v1.0.0', process.cwd())).toThrow(
      new ReleaseError(MISSING_GH),
    );
  });
});

describe('createRelease', () => {
  it('passes the notes on stdin', () => {
    const gh = setup({});
    createRelease('acme/gas-lib', 'v1.0.0', 'the notes', process.cwd());
    expect(gh.calls()).toEqual([
      {
        args: [
          'release',
          'create',
          'v1.0.0',
          '-R',
          'acme/gas-lib',
          '--verify-tag',
          '--title',
          'v1.0.0',
          '--notes-file',
          '-',
        ],
        stdin: 'the notes',
      },
    ]);
  });

  it('falls back to the exit status when gh fails without stderr', () => {
    setup({ create: 'silent-fail' });
    expect(() =>
      createRelease('acme/gas-lib', 'v1.0.0', 'notes', process.cwd()),
    ).toThrow(
      expect.objectContaining({
        name: 'ReleaseError',
        message: 'gh release create v1.0.0 failed (exit 1)',
      }),
    );
  });

  it("throws gh's trimmed stderr when gh fails", () => {
    setup({ create: 'fail' });
    expect(() =>
      createRelease('acme/gas-lib', 'v1.0.0', 'notes', process.cwd()),
    ).toThrow(
      expect.objectContaining({
        name: 'ReleaseError',
        message: 'HTTP 422: Validation Failed',
      }),
    );
  });

  it('throws the missing-gh hint when gh is not installed', () => {
    withoutGh();
    expect(() =>
      createRelease('acme/gas-lib', 'v1.0.0', 'notes', process.cwd()),
    ).toThrow(new ReleaseError(MISSING_GH));
  });
});
