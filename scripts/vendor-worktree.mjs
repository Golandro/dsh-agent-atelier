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
 * The script is idempotent and probes before it acts:
 *
 *   1. an existing checkout is reused — `--source`, `$DSH_SOURCE`, this
 *      project's managed clone, then the historical `~/repo/deepseek-harness`;
 *   2. an already-correct worktree is reported and left untouched;
 *   3. a legacy symlink is replaced by a worktree (only the link is removed);
 *   4. a directory holding unrelated files is never touched;
 *   5. `--clone` is the only path that reaches the network, and it clones the
 *      canonical copy OUTSIDE the workspace under `$DSH_HOME`.
 *
 * Usage:
 *   node scripts/vendor-worktree.mjs [--source <path>] [--ref <ref>] [--dry-run] [--clone]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root: two levels above this file, so callers cannot skew it. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** This package's name, used for the per-project harness directory. */
const PROJECT = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
/** Where the LSP-visible checkout must appear. */
const TARGET = join(ROOT, '.vendor', 'deepseek-harness')
/** Upstream used only when `--clone` is requested and no checkout exists. */
const REPO_URL = 'https://github.com/deepseek-ai/deepseek-harness.git'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wantClone = args.includes('--clone')
const explicitSource = flagValue('--source')
const ref = flagValue('--ref') ?? 'HEAD'

/** Read a `--flag value` pair, or `undefined` when absent. */
function flagValue(name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
  return value
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

/** Classify what currently occupies `TARGET`. */
function targetState() {
  if (!existsSync(TARGET) && !isLink(TARGET)) return 'missing'
  if (isLink(TARGET)) return 'symlink'
  if (isGitCheckout(TARGET)) return 'checkout'
  return 'unrelated-directory'
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

/** Create the in-workspace worktree from `source`. */
function addWorktree(source) {
  if (dryRun) {
    say(`[dry-run] would run: git -C ${source} worktree add --detach ${TARGET} ${ref}`)
    return
  }
  mkdirSync(dirname(TARGET), { recursive: true })
  execFileSync('git', ['-C', source, 'worktree', 'add', '--detach', TARGET, ref], { stdio: 'inherit' })
  say(`created worktree at ${TARGET} from ${source} (${ref})`)
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

  // An existing real checkout is the desired end state: never re-create it.
  if (state === 'checkout') {
    if (existing !== undefined && !isRegisteredWorktree(existing)) {
      say(`${TARGET} is a checkout but not a worktree of ${existing}; leaving it as-is`)
    }
    linkNodeModules(existing ?? TARGET)
    say('done (no-op)')
    return
  }

  const source = existing ?? (wantClone ? cloneCanonical() : undefined)
  if (source === undefined) {
    fail(
      'no existing DSH checkout found. Pass --source <path> with a checkout you already have, ' +
        'or --clone to create one outside the workspace.',
    )
  }

  if (state === 'symlink') {
    say('replacing the legacy symlink with a real worktree')
    if (!dryRun) rmSync(TARGET, { force: true })
  }

  addWorktree(source)
  linkNodeModules(source)
  say('done')
}

main()
