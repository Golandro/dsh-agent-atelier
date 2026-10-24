/**
 * pre-commit 上下文与失败收尾：分支/暂存文件、按问题类别给修复建议。
 */
import { execFileSync } from 'node:child_process'
import { ROOT } from './paths.mjs'
import { cyan, dim, yellow } from './ui.mjs'

/** 修复建议：按问题类别给 pre-commit 模式收尾。 */
export const HINTS = {
  'self-test': '守卫自身的判定失灵：先修 `scripts/checklist/self-test.mjs` 的自测，别绕过。',
  scratch: '删除残留探针目录（例如 `.probe/`，它被 .gitignore 隐藏）。',
  bundle: '把 `@deepseek-ai/*` 从 `dependencies` 移到 `peerDependencies` + `devDependencies`（ADR-0001）。',
  deps: '安装缺失的 devDependency：`pnpm install --store-dir "$PWD/.pnpm-store"`（沙箱内，见 docs/agents/harness-facts.md）。',
  matrix: '跨层 import 只走公共入口：`src/contract/index.ts`、`src/core/index.ts`、`src/core/ports.ts`、`src/providers/fs/index.ts`、`src/control/index.ts`、`src/control/client-errors.ts`、`src/control/http-client.ts`、`src/dsh/host/index.ts`；chunk（`client-editor/`、`client-list/`）只准 `src/control/index.ts` 与 `src/dsh/client/chunk-contracts.ts`。',
  anchors: '修正票面/文档里的 `path:line` 或裸 `src/...` 路径，或先跑 `pnpm run check:static` 看解析详情。',
}

/** 当前 git 上下文；不在仓库里返回 null。读不到的分支/HEAD 返回空串。 */
export function gitContext(root = ROOT) {
  const run = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return ''
    }
  }
  if (run('rev-parse', '--is-inside-work-tree') !== 'true') return null
  return {
    branch: run('branch', '--show-current'),
    head: run('rev-parse', '--short', 'HEAD'),
    hooksPath: run('config', 'core.hooksPath'),
    staged: run('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean),
  }
}

export function reportHookContext(context) {
  if (context === null) {
    console.log(`  ${yellow('!')} 不在 git 仓库中，跳过 pre-commit 上下文`)
    return
  }
  console.log(`  ${dim('分支')} ${context.branch || '(detached)'}  ${dim('HEAD')} ${context.head || '(初始提交)'}  ${dim('暂存')} ${context.staged.length} 个文件`)
  console.log(`  ${dim('钩子路径')} ${context.hooksPath || '(未配置 core.hooksPath)'}`)
  if (context.staged.length > 0) {
    const shown = context.staged.slice(0, 10).join(', ')
    console.log(`  ${dim('暂存文件')} ${shown}${context.staged.length > 10 ? ` … 另有 ${context.staged.length - 10} 个` : ''}`)
  }
}

export function reportHookFailure(problems, context) {
  if (context !== null && context.staged.length === 0) {
    console.error('  暂存区为空（可能是手动触发钩子）。')
  } else if (context !== null) {
    const touched = context.staged.filter((file) => problems.some((problem) => problem.text.includes(file)))
    if (touched.length > 0) {
      console.error(`  其中 ${touched.length} 个暂存文件直接涉及上述问题：`)
      for (const file of touched) console.error(`    ${yellow('•')} ${file}`)
    } else {
      console.error(`  上述问题不在本次暂存的 ${context.staged.length} 个文件中（可能是仓库级配置或既有漂移）。`)
    }
  }
  const kinds = [...new Set(problems.map((problem) => problem.kind))]
  console.error('  修复建议：')
  for (const kind of kinds) console.error(`    ${yellow('•')} ${HINTS[kind] ?? kind}`)
  console.error(`  复现命令：${cyan('pnpm run check:static')}  |  全量：${cyan('pnpm run check')}`)
  console.error(`  ${dim('提交已中止；如确认误报，先修守卫而不是 --no-verify。')}`)
}
