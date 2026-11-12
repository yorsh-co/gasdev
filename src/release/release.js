// @ts-check
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { GitHubReleaseError, ReleaseError } from './errors.js';
import { git, gitStatus, gitSucceeds } from './git.js';
import {
  createRelease,
  findRelease,
  githubRepo,
  notesPath,
  releaseNotes,
  retryCommand,
} from './github-release.js';
import { matchesAny } from './glob.js';
import { gasLibraryFor, releasePackageJson } from './package-json.js';
import { assertPeerTypesVersion } from './peer-types.js';
import { assertProtected } from './rulesets.js';

/** @typedef {import('./config.js').ReleaseConfig} ReleaseConfig */
/** @typedef {import('./config.js').Target} Target */

/**
 * @typedef {object} PreparedTarget
 * @property {Target} target
 * @property {string} worktree Absolute path of the target's worktree.
 * @property {string} tag Release tag, `<branch>/v<version>`.
 * @property {boolean} hasRemote Whether the branch existed on the remote before the release.
 */

/**
 * @typedef {object} ReleaseOptions
 * @property {boolean} [dryRun] Stage and report the changes, then restore the worktrees; commit, tag and push nothing.
 * @property {string[]} [targets] Branches to release; empty or omitted releases every configured target.
 */

/**
 * Releases the project: publishes each target's build to its branch and tags it.
 *
 * A dry run performs the same preflight, worktree sync (including the fetch and the fast-forward of
 * the local branch to the remote) and staging as a real run, prints the staged diff stat per target
 * and restores every worktree to its HEAD. It fails exactly where a real run would, including
 * "Nothing to release".
 *
 * With `githubRelease` enabled, a successful push is followed by a GitHub Release for `vX.Y.Z`.
 *
 * @param {string} cwd Project root.
 * @param {(message: string) => void} [log] Progress output.
 * @param {ReleaseOptions} [options]
 * @returns {void}
 * @throws {ReleaseError} On an expected failure; nothing is pushed.
 * @throws {GitHubReleaseError} When the push succeeded but the GitHub Release could not be created.
 */
export function release(
  cwd,
  log = () => {},
  { dryRun = false, targets = [] } = {},
) {
  const config = selectTargets(loadConfig(cwd), targets);

  log('Running preflight checks...');
  const github = preflight(config, cwd);

  /** @type {PreparedTarget[]} */
  const prepared = [];
  try {
    for (const target of config.targets) {
      log(`[${target.branch}] Checking out release worktree...`);
      const { worktree, hasRemote } = syncWorktree(config, target, cwd);
      prepared.push({
        target,
        worktree,
        tag: releaseTag(target, config.version),
        hasRemote,
      });
      log(`[${target.branch}] Syncing release contents...`);
      stage(config, target, cwd, worktree);
    }

    const changed = prepared.filter(({ worktree }) =>
      hasStagedChanges(worktree),
    );
    if (changed.length === 0) {
      const branches = prepared.map(({ target }) => target.branch).join(', ');
      throw new ReleaseError(
        `Nothing to release — ${branches} already matches the build.`,
      );
    }

    for (const { target, worktree } of prepared) {
      if (!changed.some((item) => item.worktree === worktree)) {
        log(`[${target.branch}] No changes — skipped`);
      }
    }

    if (dryRun) {
      for (const { target, worktree } of changed) {
        log(`[${target.branch}] Staged changes:`);
        log(git(['diff', '--cached', '--stat'], worktree));
        const gasLibrary = gasLibraryFor(config, target, cwd);
        if (gasLibrary) {
          log(
            `[${target.branch}] gasLibrary.loadOrder: ${gasLibrary.loadOrder.length} file(s)`,
          );
          for (const file of gasLibrary.loadOrder) log(`  ${file}`);
        }
      }
      if (github) {
        log(`GitHub Release v${config.version}: ${dryRunOutcome(github)}`);
        log('Dry run — nothing was committed, tagged, pushed or published.');
      } else {
        log('Dry run — nothing was committed, tagged or pushed.');
      }
      return;
    }

    log('Committing and tagging...');
    for (const { worktree, tag } of changed) {
      git(['commit', '-m', `merge: v${config.version}`], worktree);
      git(['tag', tag], worktree);
    }

    log(`Pushing to ${config.remote}...`);
    push(config, changed, cwd);
    if (github) publishGitHubRelease(config, github, cwd, log);
  } finally {
    if (dryRun) restoreWorktrees(prepared, cwd);
  }
}

/**
 * @typedef {object} GitHubPlan
 * @property {string} repo `owner/repo` of the remote.
 * @property {'absent' | 'published' | 'draft'} state Existing GitHub Release state for `vX.Y.Z`.
 */

/**
 * @param {GitHubPlan} github
 * @returns {string}
 */
function dryRunOutcome({ repo, state }) {
  if (state === 'published') return 'already exists — skipped';
  if (state === 'draft') {
    return 'a draft exists — skipped (publish or delete it)';
  }
  return `would be created on ${repo}`;
}

/**
 * Creates the GitHub Release after the push. Failure is fatal but nothing is rolled back; the notes
 * are saved so the printed command can retry.
 *
 * @param {ReleaseConfig} config
 * @param {GitHubPlan} github
 * @param {string} cwd
 * @param {(message: string) => void} log
 * @returns {void}
 * @throws {GitHubReleaseError} When gh fails to create the Release.
 */
function publishGitHubRelease(config, { repo, state }, cwd, log) {
  const tag = `v${config.version}`;
  if (state !== 'absent') {
    log(`GitHub Release ${tag}: ${dryRunOutcome({ repo, state })}`);
    return;
  }
  log(`Creating GitHub Release ${tag}...`);
  const notes = releaseNotes(cwd, config.version);
  try {
    createRelease(repo, tag, notes, cwd);
  } catch (error) {
    /** @type {string[]} */
    let saved;
    try {
      writeFileSync(join(cwd, notesPath(tag)), notes);
      saved = [];
    } catch (writeError) {
      saved = [
        '',
        `The notes file ${notesPath(tag)} could not be saved: ${/** @type {Error} */ (writeError).message}`,
        'Release notes:',
        notes,
      ];
    }
    throw new GitHubReleaseError(
      [
        `Push to ${config.remote} succeeded; the GitHub Release for ${tag} was not created.`,
        /** @type {Error} */ (error).message,
        ...saved,
        '',
        'Run from the project root to retry:',
        `  ${retryCommand(repo, tag)}`,
      ].join('\n'),
    );
  }
}

/**
 * Restricts the configuration to the requested targets, keeping the configured order.
 *
 * @param {ReleaseConfig} config
 * @param {string[]} branches Requested branches; empty selects every target.
 * @returns {ReleaseConfig}
 * @throws {ReleaseError} When a branch is not a configured target.
 */
function selectTargets(config, branches) {
  if (branches.length === 0) return config;
  const configured = config.targets.map(({ branch }) => branch);
  const unknown = branches.find((branch) => !configured.includes(branch));
  if (unknown !== undefined) {
    throw new ReleaseError(
      `Unknown target "${unknown}" — configured branches: ${configured.join(', ')}.`,
    );
  }
  return {
    ...config,
    targets: config.targets.filter(({ branch }) => branches.includes(branch)),
  };
}

/**
 * Undoes the staging of a dry run: resets each worktree to its HEAD, or removes a worktree that has
 * no commits yet (a first release), leaving no local branch behind.
 *
 * @param {PreparedTarget[]} prepared
 * @param {string} cwd
 * @returns {void}
 */
function restoreWorktrees(prepared, cwd) {
  for (const { worktree } of prepared) {
    if (gitSucceeds(['rev-parse', '--verify', '--quiet', 'HEAD'], worktree)) {
      git(['reset', '--hard'], worktree);
      git(['clean', '-fdx'], worktree);
    } else {
      git(['worktree', 'remove', '--force', worktree], cwd);
    }
  }
}

/**
 * @param {Target} target
 * @param {string} version
 * @returns {string}
 */
function releaseTag(target, version) {
  return `${target.branch}/v${version}`;
}

/**
 * Verifies every precondition before anything is modified.
 *
 * @param {ReleaseConfig} config
 * @param {string} cwd
 * @returns {GitHubPlan | null} The GitHub Release plan, or null when `githubRelease` is off.
 * @throws {ReleaseError}
 */
function preflight(config, cwd) {
  const { version, remote, targets } = config;

  // The tool's own worktrees may be untracked in projects that do not ignore them.
  if (
    git(['status', '--porcelain', '--', '.', ':(exclude).worktrees'], cwd) !==
    ''
  ) {
    throw new ReleaseError(
      'Working tree is not clean — commit or stash your changes first.',
    );
  }

  const versionTag = `v${version}`;
  const tagCommit = gitSucceeds(
    ['rev-parse', '--verify', '--quiet', `refs/tags/${versionTag}`],
    cwd,
  )
    ? git(['rev-parse', `refs/tags/${versionTag}^{commit}`], cwd)
    : null;
  if (tagCommit === null) {
    throw new ReleaseError(
      `Version tag ${versionTag} does not exist — finish the git-flow release first.`,
    );
  }
  if (tagCommit !== git(['rev-parse', 'HEAD'], cwd)) {
    throw new ReleaseError(
      `Version tag ${versionTag} does not point at HEAD — check out ${versionTag} (the released commit), or finish the git-flow release first.`,
    );
  }

  assertPeerTypesVersion(config.pkg, cwd);

  for (const target of targets) {
    if (!hasJsFile(join(cwd, target.from))) {
      throw new ReleaseError(
        `${target.from}/ is missing or has no .js files — run the build first.`,
      );
    }
    for (const { src } of target.files) {
      if (!isFile(join(cwd, src))) {
        throw new ReleaseError(
          `[${target.branch}] File ${src} does not exist — check "files".`,
        );
      }
    }
    for (const { from } of target.include) {
      if (!isDirectory(join(cwd, from))) {
        throw new ReleaseError(
          `[${target.branch}] Include ${from}/ does not exist — run the build first.`,
        );
      }
    }
    gasLibraryFor(config, target, cwd);
    const tag = releaseTag(target, version);
    if (
      gitSucceeds(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], cwd)
    ) {
      throw new ReleaseError(
        `Tag ${tag} already exists locally — bump the version in package.json.`,
      );
    }
    if (remoteHas(remote, 'tags', tag, cwd)) {
      throw new ReleaseError(
        `Tag ${tag} already exists on ${remote} — bump the version in package.json.`,
      );
    }
  }

  if (!config.githubRelease) return null;
  const repo = githubRepo(remote, cwd);
  assertProtected(repo, targets, cwd);
  assertRemoteVersionTag(remote, versionTag, tagCommit, cwd);
  return { repo, state: findRelease(repo, versionTag, cwd) };
}

/**
 * Requires `vX.Y.Z` on the remote at the released commit, so `gh` never creates the tag itself.
 *
 * @param {string} remote
 * @param {string} tag
 * @param {string} commit Local commit the tag peels to.
 * @param {string} cwd
 * @returns {void}
 * @throws {ReleaseError} When the tag is missing from the remote or points elsewhere.
 */
function assertRemoteVersionTag(remote, tag, commit, cwd) {
  let output;
  try {
    output = git(
      [
        'ls-remote',
        '--tags',
        remote,
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ],
      cwd,
    );
  } catch (error) {
    throw new ReleaseError(
      `Cannot query remote "${remote}": ${/** @type {Error} */ (error).message}`,
    );
  }
  /** @type {Map<string, string>} */
  const refs = new Map();
  for (const line of output.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (sha && ref) refs.set(ref, sha);
  }
  const remoteCommit =
    refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
  if (remoteCommit !== commit) {
    throw new ReleaseError(
      `Version tag ${tag} is not on ${remote} (or differs) — run: git push ${remote} ${tag}`,
    );
  }
}

/**
 * @param {string} remote
 * @param {'heads' | 'tags'} kind
 * @param {string} name
 * @param {string} cwd
 * @returns {boolean}
 * @throws {ReleaseError} When the remote cannot be queried.
 */
function remoteHas(remote, kind, name, cwd) {
  try {
    return (
      git(['ls-remote', `--${kind}`, remote, `refs/${kind}/${name}`], cwd) !==
      ''
    );
  } catch (error) {
    throw new ReleaseError(
      `Cannot query remote "${remote}": ${/** @type {Error} */ (error).message}`,
    );
  }
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * @param {string} dir
 * @returns {boolean} Whether the directory contains a `.js` file at any depth.
 */
function hasJsFile(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasJsFile(join(dir, entry.name))
      : entry.name.endsWith('.js'),
  );
}

/**
 * Prepares the target's worktree and fast-forwards it to the remote branch.
 *
 * @param {ReleaseConfig} config
 * @param {Target} target
 * @param {string} cwd
 * @returns {{ worktree: string, hasRemote: boolean }} Absolute worktree path and whether the branch exists on the remote.
 * @throws {ReleaseError} When the local branch has commits the remote lacks.
 */
function syncWorktree(config, target, cwd) {
  const { remote } = config;
  const { branch } = target;
  const relative = join('.worktrees', branch);
  const worktree = join(cwd, relative);
  const remoteRef = `${remote}/${branch}`;

  const hasRemote = remoteHas(remote, 'heads', branch, cwd);
  if (hasRemote) {
    git(
      ['fetch', '--no-prune', remote, `${branch}:refs/remotes/${remoteRef}`],
      cwd,
    );
  }

  // Re-links a worktree whose repository or directory moved; fails harmlessly when unregistered.
  if (existsSync(worktree)) gitSucceeds(['worktree', 'repair', relative], cwd);

  // Drops registrations whose directory is gone; they would otherwise keep the branch "in use".
  git(['worktree', 'prune'], cwd);

  if (existsSync(worktree)) {
    assertWorktree(worktree, relative, branch, cwd);
  } else if (
    gitSucceeds(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      cwd,
    )
  ) {
    addBranchWorktree(relative, branch, cwd);
  } else if (hasRemote) {
    git(['worktree', 'add', '--track', '-b', branch, relative, remoteRef], cwd);
  } else {
    git(['worktree', 'add', '--detach', relative], cwd);
    git(['checkout', '--orphan', branch], worktree);
    gitSucceeds(['rm', '-rf', '.'], worktree);
  }

  if (hasRemote) {
    const { status, stderr } = gitStatus(
      ['merge-base', '--is-ancestor', 'HEAD', remoteRef],
      worktree,
    );
    if (status === 1) {
      throw new ReleaseError(
        `Local ${branch} has commits that are not on ${remoteRef} — resolve before releasing.`,
      );
    }
    if (status !== 0) {
      throw new Error(
        `git merge-base --is-ancestor HEAD ${remoteRef} failed: ${stderr}`,
      );
    }
    git(['merge', '--ff-only', remoteRef], worktree);
  }
  return { worktree, hasRemote };
}

/**
 * Verifies that an existing directory is a working worktree of this repository on the branch.
 *
 * @param {string} worktree Absolute worktree path.
 * @param {string} relative Worktree path relative to the project root.
 * @param {string} branch
 * @param {string} cwd
 * @returns {void}
 * @throws {ReleaseError} When the directory is not a worktree of this repository on the branch.
 */
function assertWorktree(worktree, relative, branch, cwd) {
  /**
   * @param {string} directory
   * @returns {string}
   */
  const commonDir = (directory) =>
    realpathSync(
      resolve(directory, git(['rev-parse', '--git-common-dir'], directory)),
    );

  let valid = false;
  try {
    valid =
      realpathSync(git(['rev-parse', '--show-toplevel'], worktree)) ===
        realpathSync(worktree) &&
      commonDir(worktree) === commonDir(cwd) &&
      git(['symbolic-ref', '--short', 'HEAD'], worktree) === branch;
  } catch {
    // Any git failure means the directory is not a usable worktree.
  }
  if (!valid) {
    throw new ReleaseError(
      `${relative} exists but is not a worktree of this repository on ${branch} — remove it (rm -rf ${relative}) and run the release again.`,
    );
  }
}

/**
 * Checks out an existing local branch into a new worktree.
 *
 * @param {string} relative Worktree path relative to the project root.
 * @param {string} branch
 * @param {string} cwd
 * @returns {void}
 * @throws {ReleaseError} When the branch cannot be checked out, e.g. it is in use by another worktree.
 */
function addBranchWorktree(relative, branch, cwd) {
  try {
    git(['worktree', 'add', relative, branch], cwd);
  } catch (error) {
    throw new ReleaseError(
      `Cannot check out ${branch} into ${relative}: ${/** @type {Error} */ (error).message}\nRun "git worktree list" to see where ${branch} is checked out.`,
    );
  }
}

/**
 * Replaces the worktree contents with the target's release files and stages them.
 *
 * @param {ReleaseConfig} config
 * @param {Target} target
 * @param {string} cwd
 * @param {string} worktree
 * @returns {void}
 */
function stage(config, target, cwd, worktree) {
  for (const entry of readdirSync(worktree)) {
    if (entry !== '.git') {
      rmSync(join(worktree, entry), { recursive: true, force: true });
    }
  }

  copyTree(join(cwd, target.from), worktree, target.hide, target.exclude);
  for (const { from, to, hide } of target.include) {
    copyTree(join(cwd, from), join(worktree, to), hide, []);
  }
  for (const { src, dest } of target.files) {
    mkdirSync(dirname(join(worktree, dest)), { recursive: true });
    copyFileSync(join(cwd, src), join(worktree, dest));
  }
  if (target.packageJson) {
    writeFileSync(
      join(worktree, 'package.json'),
      releasePackageJson(config.pkg, gasLibraryFor(config, target, cwd)),
    );
  }
  git(['add', '-A'], worktree);
}

/**
 * Recursively copies files, skipping files that match a hide glob and files
 * and directories that match an exclude glob.
 *
 * @param {string} source
 * @param {string} destination
 * @param {string[]} hide
 * @param {string[]} exclude
 * @param {string} [prefix] Path of `source` relative to the copy root.
 * @returns {void}
 */
function copyTree(source, destination, hide, exclude, prefix = '') {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (matchesAny(relative, exclude, entry.isDirectory())) continue;
    if (entry.isDirectory()) {
      copyTree(
        join(source, entry.name),
        join(destination, entry.name),
        hide,
        exclude,
        `${relative}/`,
      );
    } else if (!matchesAny(relative, hide)) {
      mkdirSync(dirname(join(destination, entry.name)), { recursive: true });
      copyFileSync(join(source, entry.name), join(destination, entry.name));
    }
  }
}

/**
 * @param {string} worktree
 * @returns {boolean}
 */
function hasStagedChanges(worktree) {
  return git(['diff', '--cached', '--name-only'], worktree) !== '';
}

/**
 * Pushes all branches and tags in a single atomic operation.
 *
 * @param {ReleaseConfig} config
 * @param {PreparedTarget[]} prepared
 * @param {string} cwd
 * @returns {void}
 * @throws {ReleaseError} When the remote rejects the push.
 */
function push(config, prepared, cwd) {
  const refs = prepared.flatMap(({ target, tag }) => [
    target.branch,
    `refs/tags/${tag}`,
  ]);
  try {
    git(['push', '--atomic', config.remote, ...refs], cwd);
  } catch (error) {
    throw new ReleaseError(
      pushFailureMessage(config.remote, prepared, refs, error),
    );
  }
}

/**
 * Builds the push failure message, with the commands to retry or to undo the local release.
 *
 * @param {string} remote
 * @param {PreparedTarget[]} prepared
 * @param {string[]} refs Refs passed to `git push`.
 * @param {unknown} error The git failure.
 * @returns {string}
 */
function pushFailureMessage(remote, prepared, refs, error) {
  const reset = prepared.map(({ target, hasRemote }) =>
    hasRemote
      ? `  git -C .worktrees/${target.branch} reset --hard ${remote}/${target.branch}`
      : `  git worktree remove --force .worktrees/${target.branch} && git branch -D ${target.branch}`,
  );
  return [
    `Push to ${remote} failed; nothing was pushed, and the local release commits and tags were kept.`,
    /** @type {Error} */ (error).message,
    '',
    'Run from the project root. To retry the push:',
    `  git push --atomic ${remote} ${refs.join(' ')}`,
    '',
    'To discard the local release instead:',
    ...prepared.map(({ tag }) => `  git tag -d ${tag}`),
    ...reset,
  ].join('\n');
}
