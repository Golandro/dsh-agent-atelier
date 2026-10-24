#!/usr/bin/env node
/**
 * 本仓守卫的编排入口（本仓无 CI、无远端，所以守卫挂在 `pnpm run check` 与
 * `.githooks/pre-commit` 上）。
 *
 * 判定实现拆在 `scripts/checklist/`，本文件只负责参数解析、按序执行与汇总：
 *   self-test  → checklist/self-test.mjs   自身有牙：合成坏输入断言每条判定能报错
 *   scratch    → checklist/scratch.mjs     已知探针目录不得残留
 *   bundle     → checklist/bundle.mjs      运行时依赖不得含 `@deepseek-ai/*`
 *   deps       → checklist/deps.mjs        声明的 devDependency 必须已安装
 *   matrix     → checklist/matrix.mjs      import 矩阵（AST，ticket 16/17）
 *   anchors    → checklist/anchors.mjs     `path:line` 与裸 `src/...` 断言
 *
 * 本脚本只读 `src/` 源码，不要求 `lib/` 存在，也不触发构建：静态判定全部走
 * TypeScript AST（`typescript` 是 devDependency），类型层面交给 `pnpm run typecheck`。
 *
 * 用法：
 *   node scripts/check.mjs              全量静态检查
 *   node scripts/check.mjs --self-test 只跑守卫自测
 *   node scripts/check.mjs --hook      pre-commit 模式：附带分支/暂存文件与修复建议
 *   node scripts/check.mjs --verbose   打印每层扫描统计与逐条违规（默认只报数量）
 *   node scripts/check.mjs --no-color  关闭 ANSI 颜色
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { runAnchors } from './checklist/anchors.mjs'
import { runBundle } from './checklist/bundle.mjs'
import { runDeps } from './checklist/deps.mjs'
import { runMatrix } from './checklist/matrix.mjs'
import { DSH_SOURCE, ROOT } from './checklist/paths.mjs'
import { gitContext, reportHookContext, reportHookFailure } from './checklist/report.mjs'
import { runScratch } from './checklist/scratch.mjs'
import { runSelfTest } from './checklist/self-test.mjs'
import { bold, cyan, dim, green, red, reportStep } from './checklist/ui.mjs'

const ARGS = new Set(process.argv.slice(2))
const STEPS = [
  { label: 'self-test', run: runSelfTest },
  { label: 'scratch', run: runScratch },
  { label: 'bundle', run: runBundle },
  { label: 'deps', run: runDeps },
  { label: 'import 矩阵', run: runMatrix },
  { label: 'anchors', run: runAnchors },
]

function main() {
  const hook = ARGS.has('--hook')
  const verbose = ARGS.has('--verbose')
  const problems = []
  const started = performance.now()
  const hookContext = hook ? gitContext(ROOT) : null

  console.log(`${bold('check:')} 仓库守卫（TS AST · typescript ${ts.version}${hook ? ' · pre-commit' : ''}）`)
  if (hook) reportHookContext(hookContext)

  for (const [index, step] of STEPS.entries()) {
    const stepStarted = performance.now()
    const result = step.run({ root: ROOT, dshSource: DSH_SOURCE, verbose })
    for (const note of result.preNotes ?? []) console.log(`      ${note}`)
    reportStep(index + 1, STEPS.length, step.label, result.status, result.detail, Math.round(performance.now() - stepStarted))
    for (const note of result.notes ?? []) console.log(`      ${note}`)
    for (const line of result.errors ?? []) console.error(`      ${line}`)
    problems.push(...result.problems)
    if (step.label === 'self-test' && ARGS.has('--self-test')) {
      console.log(problems.length === 0 ? `${green('check: 通过')}（self-test 模式）` : `${red('check: 未通过')}（self-test 模式）`)
      return problems.length === 0 ? 0 : 1
    }
  }

  const elapsed = Math.round(performance.now() - started)
  if (problems.length === 0) {
    console.log(`\n${green('check: 通过')}（${STEPS.length} 项检查 · ${elapsed}ms）`)
    if (hook) console.log(`  ${dim('静态守卫通过；pre-commit 接下来跑 typecheck + 单测。')}`)
    return 0
  }
  const counts = [...problems.reduce((map, problem) => map.set(problem.kind, (map.get(problem.kind) ?? 0) + 1), new Map())]
    .map(([kind, count]) => `${kind} ×${count}`)
    .join(' · ')
  console.error(`\n${red('check: 未通过')}（${problems.length} 个问题 · ${counts} · ${elapsed}ms）`)
  if (hook) {
    reportHookFailure(problems, hookContext)
  } else {
    console.error(`  修复后重跑：${cyan('pnpm run check:static')}  |  全量：${cyan('pnpm run check')}`)
  }
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
