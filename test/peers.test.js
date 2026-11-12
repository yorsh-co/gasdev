import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeersError, runPeers } from '../bin/peers.js';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} A new temp directory. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-peers-'));
  dirs.push(dir);
  return dir;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

/**
 * Canonical peer file as published at a version.
 *
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
function canonical(name, version) {
  return `/**\n * ${name} peer types.\n * @version ${version}\n * @license MIT\n */\nexport declare const v${version.replaceAll('.', '_')}: string;\n`;
}

/** @param {string} text */
function stripped(text) {
  return text.replace(/^ \* @version .*\n/m, '');
}

/**
 * Builds a local repository with the tags the resolver must handle.
 *
 * @param {string} root
 * @param {string} name
 * @returns {string} Repository path.
 */
function createPeerRepo(root, name) {
  const repo = join(root, `${name}.git`);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'tag.gpgsign', 'false']);
  const file = join(repo, 'peer', `${name}.peer.types.d.ts`);
  mkdirSync(dirname(file), { recursive: true });
  /** @type {[string, string[]][]} */
  const releases = [
    ['1.0.0', ['v1.0.0']],
    ['1.1.0', ['v1.1.0']],
    ['2.0.0', ['v2.0.0']],
    ['9.9.9', ['dist/v9.9.9', 'v1.2']],
  ];
  for (const [version, tags] of releases) {
    writeFileSync(file, canonical(name, version));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', `release ${version}`]);
    for (const tag of tags) {
      if (tag === 'v1.1.0')
        git(repo, ['tag', '-a', tag, '-m', `release ${tag}`]);
      else git(repo, ['tag', tag]);
    }
  }
  return repo;
}

/**
 * @returns {{ root: string, project: string, repository: (name: string) => string }}
 */
function setup() {
  const root = tempDir();
  const project = join(root, 'project');
  mkdirSync(project);
  return {
    root,
    project,
    repository: (name) => join(root, `${name}.git`),
  };
}

/** @returns {{ out: () => string, err: () => string }} */
function capture() {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  return {
    out: () => out.mock.calls.join(''),
    err: () => err.mock.calls.join(''),
  };
}

describe('runPeers', () => {
  it('writes the highest satisfying tag without the @version line', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    const io = capture();
    const code = runPeers(project, { 'gas-lock': '^1.0.0' }, { repository });
    const path = join(project, 'src/internal/gas-lock.peer.types.d.ts');
    expect(code).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(
      stripped(canonical('gas-lock', '1.1.0')),
    );
    expect(readFileSync(path, 'utf8')).toBe(
      '/**\n * gas-lock peer types.\n * @license MIT\n */\nexport declare const v1_1_0: string;\n',
    );
    expect(io.out()).toBe(
      '✓ Synced src/internal/gas-lock.peer.types.d.ts from gas-lock@1.1.0\n',
    );
  });

  it('picks the highest version across a range union', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    capture();
    runPeers(project, { 'gas-lock': '^1.0.0 || ^2.0.0' }, { repository });
    expect(
      readFileSync(
        join(project, 'src/internal/gas-lock.peer.types.d.ts'),
        'utf8',
      ),
    ).toBe(stripped(canonical('gas-lock', '2.0.0')));
  });

  it('check passes when the file is identical', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    const io = capture();
    runPeers(project, { 'gas-lock': '^1.0.0' }, { repository });
    const code = runPeers(
      project,
      { 'gas-lock': '^1.0.0' },
      { repository, check: true },
    );
    expect(code).toBe(0);
    expect(io.out()).toContain('✓ Peer types are up to date\n');
  });

  it('check fails and writes nothing when the file differs', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    const io = capture();
    const path = join(project, 'src/internal/gas-lock.peer.types.d.ts');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'stale\n');
    const code = runPeers(
      project,
      { 'gas-lock': '^1.0.0' },
      { repository, check: true },
    );
    expect(code).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('stale\n');
    expect(io.err()).toBe(
      'src/internal/gas-lock.peer.types.d.ts is out of date with gas-lock@1.1.0: run gasdev peers sync\n',
    );
  });

  it('check fails and writes nothing when the file is missing', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    const io = capture();
    const code = runPeers(
      project,
      { 'gas-lock': '^1.0.0' },
      { repository, check: true },
    );
    expect(code).toBe(1);
    expect(existsSync(join(project, 'src'))).toBe(false);
    expect(io.err()).toContain(
      'src/internal/gas-lock.peer.types.d.ts is out of date with gas-lock@1.1.0',
    );
  });

  it('writes nothing when a later peer fails', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    capture();
    expect(() =>
      runPeers(
        project,
        { 'gas-lock': '^1.0.0', missing: '^1.0.0' },
        { repository },
      ),
    ).toThrow(PeersError);
    expect(existsSync(join(project, 'src'))).toBe(false);
  });

  it('rejects unconfigured peers', () => {
    const { project } = setup();
    expect(() => runPeers(project, undefined)).toThrow(
      'package.json: "gasdev.peers" is not configured',
    );
  });

  it('rejects an invalid range', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    expect(() =>
      runPeers(project, { 'gas-lock': 'not a range' }, { repository }),
    ).toThrow(/invalid version range "not a range"/);
  });

  it('lists available versions when none satisfies the range', () => {
    const { root, project, repository } = setup();
    createPeerRepo(root, 'gas-lock');
    expect(() =>
      runPeers(project, { 'gas-lock': '^3.0.0' }, { repository }),
    ).toThrow(
      /no version satisfies "\^3.0.0" \(available: 1.0.0, 1.1.0, 2.0.0\)/,
    );
  });

  it('reports none when the repository has no release tags', () => {
    const { root, project, repository } = setup();
    const repo = join(root, 'empty.git');
    mkdirSync(repo);
    git(repo, ['init', '--quiet']);
    expect(() =>
      runPeers(project, { empty: '^1.0.0' }, { repository }),
    ).toThrow(/\(available: none\)/);
  });

  it('rejects a tag without the peer file', () => {
    const { root, project, repository } = setup();
    const repo = createPeerRepo(root, 'gas-lock');
    git(repo, ['rm', '--quiet', '-r', 'peer']);
    git(repo, [
      '-c',
      'user.email=t@e.com',
      '-c',
      'user.name=T',
      'commit',
      '--quiet',
      '-m',
      'rm',
    ]);
    git(repo, ['tag', 'v3.0.0']);
    expect(() =>
      runPeers(project, { 'gas-lock': '^3.0.0' }, { repository }),
    ).toThrow(/peer\/gas-lock\.peer\.types\.d\.ts not found at tag v3\.0\.0/);
  });

  it('rejects an unreachable repository', () => {
    const { project, repository } = setup();
    expect(() =>
      runPeers(project, { nowhere: '^1.0.0' }, { repository }),
    ).toThrow(/^git ls-remote .* failed: .*\S/s);
  });
});

describe('CLI', () => {
  /** @param {string[]} args */
  function run(args) {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr };
  }

  it.each([['peers'], ['peers', 'foo'], ['peers', 'sync', 'extra']])(
    'rejects %j as an unknown command',
    (...args) => {
      const result = run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('unknown command');
    },
  );

  it.each([['check'], ['gas-test', 'build']])(
    'rejects --check with %j',
    (...args) => {
      const result = run([...args, '--check']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        '--check is only valid with html or peers sync.',
      );
    },
  );

  it('fails when no peers are configured', () => {
    const result = run(['peers', 'sync']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'package.json: "gasdev.peers" is not configured',
    );
  });
});
