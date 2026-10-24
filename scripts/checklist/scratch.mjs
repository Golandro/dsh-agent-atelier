/**
 * scratch 检查：已知探针目录不得残留。
 *
 * 这些目录被 `.gitignore` 隐藏，`git status` 看不出来，所以必须由守卫显式探测。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, SCRATCH_DIRS } from './paths.mjs'

/** @returns {string[]} 实际存在的探针目录 */
export function findScratchDirs(root = ROOT, names = SCRATCH_DIRS) {
  return names.filter((n) => existsSync(join(root, n))).map((n) => `${n}/`)
}

export function runScratch({ root = ROOT } = {}) {
  const scratch = findScratchDirs(root)
  const ok = scratch.length === 0
  return {
    kind: 'scratch',
    status: ok ? 'ok' : 'fail',
    detail: ok ? `无残留探针目录（检查 ${SCRATCH_DIRS.length} 个）` : `残留 ${scratch.join(', ')}`,
    problems: ok ? [] : [{ kind: 'scratch', text: `残留探针目录：${scratch.join(', ')}（被 .gitignore 隐藏，\`git status\` 看不出来）` }],
  }
}
