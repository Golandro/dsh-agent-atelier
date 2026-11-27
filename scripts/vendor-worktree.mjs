#!/usr/bin/env node
/**
 * Materialize the external DSH source tree so LSP can query it.
 *
 * Why this exists: the LSP host gates every query on `fs.contains`, which
 * compares **realpath** (`fs-local/src/fsio.ts`). A `.vendor/deepseek-harness`
 * SYMLINK pointing outside the workspace therefore fails every call with
 * `source "<path>" resolves outside the workspace`. The canonical checkout must
 * stay OUTSIDE the workspace (shared by several working directories, read-only
 * by default, reusable for secondary development), so this script materializes
 * a `git worktree` INSIDE the workspace. A worktree shares the outside
 * repository's object store: it is a checkout, not a second clone.
 *
 * A SYMLINK at that path is rejected twice over, by two unrelated gates:
 * `git status` exits 128 ("expected submodule path … not to be a symbolic link",
 * git >= 2.46 hardening with no config switch) and `fs.contains` fails every LSP
 * query. Neither accepts a link, wherever it points, so the path must be a real
 * directory in every workspace that runs either.
 *
 * Three tiers, cheapest first:
 *
 *   1. **hardlink farm** (default in a linked worktree) — link every file of the
 *      main worktree's checkout to the same inode and drop the `.git` pointer.
 *      It costs no disk; the pointer is dropped because two checkouts must not
 *      share one git directory and index. Writes through the farm reach the
 *      canonical checkout, which is acceptable for read-only reference source.
 *   2. **no checkout** — static guards fall back to `$DSH_SOURCE`, so a
 *      worktree that only reads the API contract needs no `.vendor` at all.
 *   3. **independent copy** (`--copy`) — correct but costs the full tree.
 *
 * The script is idempotent and probes before it acts:
 *
 *   1. an existing checkout is reused — `--source`, `$DSH_SOURCE`, this
 *      project's managed clone, then the historical `~/repo/deepseek-harness`;
 *   2. an already-correct worktree or farm is reported and left untouched;
 *   3. a legacy symlink is replaced by a real directory (only the link is removed);
 *   4. a directory holding unrelated files is never touched;
 *   5. nothing is deleted without `--rebuild`, and `--dry-run` reports it first;
 *   6. `--clone` is the only path that reaches the network, and it clones the
 *      canonical copy OUTSIDE the workspace under `$DSH_HOME`.
 *
 * Usage:
 *   node scripts/vendor-worktree.mjs [--root <worktree>] [--source <path>] [--ref <ref>]
 *                                    [--dry-run] [--copy] [--rebuild] [--clone]
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where this script lives: two levels above it, so callers cannot skew the default. */
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Upstream used only when `--clone` is requested and no checkout exists. */
const REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wantClone = args.includes('--clone')
const wantCopy = args.includes('--copy')
const wantRebuild = args.includes('--rebuild')
const explicitSource = flagValue('--source')
const explicitRef = flagValue('--ref')
const explicitRoot = flagValue('--root')

/**
 * The workspace this run acts on. Defaults to the tree holding this script; a
 * linked worktree carries its own older copy of the script, so repairing one
 * from the main checkout passes `--root` instead of shipping the fix first.
 */
const ROOT = explicitRoot === undefined ? SCRIPT_ROOT : resolve(explicitRoot)
/** This package's name, used for the per-project harness directory. */
const PROJECT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
/** Where the LSP-visible checkout must appear. */
const TARGET = join(ROOT, '.vendor', 'deepseek-harness')
const ref = explicitRef ?? pinnedRef() ?? 'HEAD'

/** Read a `--flag value` pair, or `undefined` when absent. */
function flagValue(name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

/**
 * The commit this repository pins for `TARGET`, read from the index gitlink.
 * A clone that tracks the path as a submodule records the exact commit to check
 * out, so honouring it by default reproduces the pinned tree instead of whatever
 * `HEAD` happens to be — and it needs no network.
 */
function pinnedRef() {
  try {
    const staged = execFileSync('git', ['-C', ROOT, 'ls-files', '--stage', '--', relTarget()], {
      encoding: 'utf8',
    }).trim()
    const match = /^160000 ([0-9a-f]{40}) /.exec(staged)
    return match === null ? undefined : match[1]
  } catch {
    return undefined
  }
}

/** `TARGET` relative to the repository root, for git pathspecs. */
function relTarget() {
  return relative(ROOT, TARGET)
}

/** Report a fatal condition and exit non-zero. */
function fail(message) {
  console.error(`vendor-worktree: ${message}`)
  process.exit(1)
}

/** Print one status line. */
function say(message) {
  console.log(`vendor-worktree: ${message}`)
}

/** Run git in `cwd` and return trimmed stdout. */
function git(cwd, gitArgs) {
  return execFileSync('git', ['-C', cwd, ...gitArgs], { encoding: 'utf8' }).trim()
}

/**
 * Whether `path` is itself the root of a git working tree (worktrees included).
 * `--is-inside-work-tree` alone is wrong here: it is true for any directory
 * NESTED inside a worktree, which would misclassify an unrelated directory as
 * a checkout. Compare the reported toplevel against the directory instead.
 */
function isGitCheckout(path) {
  try {
    return realpathSync(git(path, ['rev-parse', '--show-toplevel'])) === realpathSync(path)
  } catch {
    return false
  }
}

/** Whether `path` carries the DSH monorepo layout. */
function isDshCheckout(path) {
  return existsSync(join(path, '.git')) && existsSync(join(path, 'packages'))
}

/** The harness home, mirroring the host's explicit > `$DSH_HOME` > `~/.dsh` order. */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

/** This project's managed clone location, outside the workspace. */
function managedClone() {
  return join(dshHome(), `.${PROJECT}`, 'vendor', 'deepseek-harness')
}

/** The historical default, kept so existing machines are reused rather than re-cloned. */
function legacyDefault() {
  return join(homedir(), 'repo', 'deepseek-harness')
}

/**
 * Every place an existing checkout may already live, highest precedence first.
 * `--source` wins so a caller who knows the path never triggers a clone.
 */
function sourceCandidates() {
  const list = [explicitSource, process.env.DSH_SOURCE, managedClone(), legacyDefault()]
  return [...new Set(list.filter((entry) => entry !== undefined && entry.trim() !== '').map((entry) => resolve(entry)))]
}

/** The first candidate that is a real DSH checkout. */
function findExistingSource() {
  for (const candidate of sourceCandidates()) {
    if (isDshCheckout(candidate)) return candidate
  }
  return undefined
}

/** Whether `source` already registers `TARGET` as one of its worktrees. */
function isRegisteredWorktree(source) {
  try {
    return git(source, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
      .includes(resolve(TARGET))
  } catch {
    return false
  }
}

/**
 * Whether `path` holds the DSH tree without its own `.git` pointer, i.e. a
 * materialization that git only sees as a plain directory.
 */
function isBareDshTree(path) {
  return !isLink(path) && existsSync(join(path, 'packages')) && !existsSync(join(path, '.git'))
}

/**
 * Whether `path`'s files share inodes with another copy. A hardlink farm keeps
 * `nlink > 1`; an independent copy was written through and has `nlink === 1`.
 * Probes a file that every DSH checkout has, so the answer does not depend on
 * which optional packages are present.
 */
function sharesInodes(path) {
  try {
    return statSync(join(path, 'package.json')).nlink > 1
  } catch {
    return false
  }
}

/**
 * The main worktree's materialized checkout: the cheapest source for a farm,
 * because it is the copy that gets refreshed when DSH is bumped.
 */
function mainWorktreeVendor() {
  try {
    const first = git(ROOT, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .find((line) => line.startsWith('worktree '))
    if (first === undefined) return undefined
    const candidate = join(resolve(first.slice('worktree '.length)), '.vendor', 'deepseek-harness')
    return isDshCheckout(candidate) || isBareDshTree(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

/**
 * Classify what currently occupies `TARGET`.
 *
 * `empty-directory` is not an accident: a fresh clone of a repository that
 * tracks this path as a gitlink gets an EMPTY directory created by git itself
 * (the submodule placeholder). Treating that as `unrelated-directory` would
 * refuse the very first run on every clean checkout, so it is filled in place.
 * `git worktree add` accepts an existing empty directory.
 *
 * `farm` and `copy` both lack a `.git` pointer; they differ only in whether the
 * bytes are shared, which decides whether a refresh is free or expensive.
 */
function targetState() {
  if (!existsSync(TARGET) && !isLink(TARGET)) return 'missing'
  if (isLink(TARGET)) return 'symlink'
  if (isGitCheckout(TARGET)) return 'checkout'
  if (isBareDshTree(TARGET)) return sharesInodes(TARGET) ? 'farm' : 'copy'
  if (isEmptyDirectory(TARGET)) return 'empty-directory'
  return 'unrelated-directory'
}

/** Whether `path` is a real directory with no entries at all. */
function isEmptyDirectory(path) {
  try {
    if (!lstatSync(path).isDirectory()) return false
    return readdirSync(path).length === 0
  } catch {
    return false
  }
}

/** `lstat` link check that tolerates a missing path. */
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Link the source's `node_modules` so third-party imports resolve in the worktree.
 * @param source - the canonical checkout whose `node_modules` is shared.
 * @param targetIsReal - whether `TARGET` is already a real directory; a legacy
 *   symlink must not be followed, or its target's `node_modules` would be mistaken
 *   for one this script created.
 */
function linkNodeModules(source, targetIsReal = !dryRun) {
  const from = join(source, 'node_modules')
  const to = join(TARGET, 'node_modules')
  if (!existsSync(from)) {
    say('source has no node_modules; third-party imports will not resolve until it is installed')
    return
  }
  if (targetIsReal && (existsSync(to) || isLink(to))) {
    say('node_modules already present; left as-is')
    return
  }
  if (dryRun) {
    say(`[dry-run] would link ${to} -> ${from}`)
    return
  }
  symlinkSync(from, to)
  say(`linked node_modules -> ${from}`)
}

/** Whether `source` can resolve `rev` to a commit it actually has. */
function hasRef(source, rev) {
  try {
    execFileSync('git', ['-C', source, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * The revision to check out: the requested one when the source has it, else the
 * source's `HEAD`. A pin recorded by a newer clone is routinely absent from an
 * older local checkout, and refusing to run over that would be worse than
 * checking out the best commit available — so fall back loudly instead.
 */
function resolveRef(source) {
  if (hasRef(source, ref)) return ref
  const fallback = git(source, ['rev-parse', 'HEAD'])
  say(
    `source ${source} has no ${ref}; falling back to its HEAD ${fallback.slice(0, 10)}` +
      ' (the pinned commit is not in this checkout — fetch it there to reproduce the pin)',
  )
  return fallback
}

/**
 * Recreate `from` at `to` with every regular file hardlinked.
 *
 * Written as an explicit walk rather than `cp -al` because the shell tool is not
 * portable: NTFS has no directory hardlinks, so a farm there must be built from
 * per-file links (which `fs.linkSync` creates on both POSIX and NTFS). Symlinks
 * are recreated as symlinks; linking a link would hardlink the link inode itself.
 *
 * @param from - source tree that already exists.
 * @param to - destination path, created here.
 */
function linkTree(from, to) {
  const entry = lstatSync(from)
  if (entry.isSymbolicLink()) {
    symlinkSync(readlinkSync(from), to)
    return
  }
  if (entry.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const child of readdirSync(from)) linkTree(join(from, child), join(to, child))
    return
  }
  try {
    linkSync(from, to)
  } catch (error) {
    const code = error.code
    if (code === 'EXDEV' || code === 'EPERM') {
      fail(`cannot hardlink ${from} -> ${to} (${code}): a hardlink needs one filesystem. Use --copy instead.`)
    }
    throw error
  }
}

/**
 * Materialize `TARGET` as a hardlink farm over `source`.
 *
 * Hardlinking shares every inode, so the tree costs directory entries and nothing
 * else, and it runs in about a second for a 200 MB checkout. The `.git` pointer
 * is dropped afterwards: two checkouts must not share one git directory and one
 * index, or concurrent git runs fight over the same lock files. Dropping it is
 * also what keeps `git status` working — git only refuses a SYMLINK at a
 * gitlink path, and a plain directory is accepted whatever it contains.
 */
function linkFarm(source) {
  if (dryRun) {
    say(`[dry-run] would hardlink ${source} -> ${TARGET} and drop its .git pointer`)
    return
  }
  mkdirSync(dirname(TARGET), { recursive: true })
  linkTree(source, TARGET)
  rmSync(join(TARGET, '.git'), { force: true })
  say(`hardlinked ${source} -> ${TARGET} (shared inodes; .git pointer dropped)`)
}

/**
 * Materialize `TARGET` as an independent copy. Correct and isolated, but it
 * duplicates the whole checkout, so it is opt-in rather than the default.
 */
function copyCheckout(source) {
  if (dryRun) {
    say(`[dry-run] would copy ${source} -> ${TARGET} and drop its .git pointer`)
    return
  }
  mkdirSync(dirname(TARGET), { recursive: true })
  try {
    execFileSync('cp', ['-a', source, TARGET], { stdio: 'inherit' })
  } catch {
    fail(`cp could not copy ${source} to ${TARGET}`)
  }
  rmSync(join(TARGET, '.git'), { force: true })
  say(`copied ${source} -> ${TARGET} (independent copy; .git pointer dropped)`)
}

/** Create the in-workspace worktree from `source`. */
function addWorktree(source) {
  const rev = resolveRef(source)
  if (dryRun) {
    say(`[dry-run] would run: git -C ${source} worktree add --detach ${TARGET} ${rev}`)
    return
  }
  mkdirSync(dirname(TARGET), { recursive: true })
  try {
    execFileSync('git', ['-C', source, 'worktree', 'add', '--detach', TARGET, rev], { stdio: 'inherit' })
  } catch {
    fail(`git could not create a worktree at ${TARGET} from ${source} (${rev})`)
  }
  say(`created worktree at ${TARGET} from ${source} (${rev})`)
}

/** Clone the canonical copy outside the workspace, then worktree from it. */
function cloneCanonical() {
  const destination = managedClone()
  if (dryRun) {
    say(`[dry-run] would clone ${REPO_URL} into ${destination}`)
    return destination
  }
  mkdirSync(dirname(destination), { recursive: true })
  say(`cloning ${REPO_URL} into ${destination} (outside the workspace)`)
  execFileSync('git', ['clone', REPO_URL, destination], { stdio: 'inherit' })
  return destination
}

/** Entry point: probe, then reach the smallest state that makes LSP work. */
function main() {
  const state = targetState()
  say(`target ${TARGET} is ${state}`)

  if (state === 'unrelated-directory') {
    fail(
      `${TARGET} exists and is not a git checkout. Refusing to touch it; move it aside first.`,
    )
  }

  const existing = findExistingSource()
  if (existing !== undefined) {
    say(`reusing existing checkout ${existing}`)
  }

  // A farm or copy already satisfies both gates: never re-create it.
  if (state === 'farm' || state === 'copy') {
    if (wantRebuild) {
      say(`--rebuild: replacing the existing ${state} at ${TARGET}`)
      if (!dryRun) rmSync(TARGET, { recursive: true, force: true })
    } else {
      linkNodeModules(existing ?? TARGET)
      say(`done (no-op: ${state} already materialized)`)
      return
    }
  }

  // An existing real checkout is a valid end state; only `--rebuild` replaces it,
  // and only when it is not the main worktree's own checkout (that is the farm source).
  if (state === 'checkout') {
    const isMainVendor = resolve(mainWorktreeVendor() ?? '') === resolve(TARGET)
    if (!wantRebuild || isMainVendor) {
      if (existing !== undefined && !isRegisteredWorktree(existing)) {
        say(`${TARGET} is a checkout but not a worktree of ${existing}; leaving it as-is`)
      }
      linkNodeModules(existing ?? TARGET)
      say('done (no-op)')
      return
    }
    say('--rebuild: replacing the existing checkout with a hardlink farm')
    if (!dryRun) rmSync(TARGET, { recursive: true, force: true })
  }

  const source = existing ?? (wantClone ? cloneCanonical() : undefined)
  if (source === undefined) {
    fail(
      'no existing DSH checkout found. Pass --source <path> with a checkout you already have, ' +
        'or --clone to create one outside the workspace.',
    )
  }

  if (state === 'symlink') {
    say('replacing the legacy symlink with a real directory (git and the LSP host both reject it)')
    if (!dryRun) rmSync(TARGET, { force: true })
  }

  if (state === 'empty-directory') {
    say('filling the empty submodule placeholder git created for a fresh clone')
  }

  // The main worktree's checkout is the copy that gets refreshed on a DSH bump,
  // so prefer it as the farm source; an outside checkout only has the objects.
  const farmSource = mainWorktreeVendor()
  if (wantCopy) {
    copyCheckout(source)
  } else if (farmSource !== undefined && resolve(farmSource) !== resolve(TARGET)) {
    linkFarm(farmSource)
  } else {
    say('no in-workspace checkout to hardlink from; falling back to a git worktree')
    addWorktree(source)
  }
  linkNodeModules(source)
  say('done')
}

main()
