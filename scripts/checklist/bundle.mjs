/**
 * bundle 检查：`package.json` 运行时依赖不得含 `@deepseek-ai/*` 宿主包。
 *
 * 宿主共享实例走 peerDependencies + devDependencies（ADR-0001 import 边界）；
 * 第三方库允许进 `dependencies`——2026-10-17 维护者裁决，install_bundle 随装入解析。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.mjs'

/** 运行时依赖里不得出现宿主包：`@deepseek-ai/*` 须走 peerDependencies + devDependencies（宿主 publish 纪律；ADR-0001 import 边界）。第三方库允许进 `dependencies`：install_bundle 装入时随 pnpm add 进 profile 解析（2026-10-17 维护者裁决「我们需要这些依赖」）。 */
export function hostRuntimeDeps(pkg) {
  return Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith('@deepseek-ai/'))
}

export function runBundle({ root = ROOT } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const runtimeDeps = Object.keys(pkg.dependencies ?? {})
  const hostDeps = hostRuntimeDeps(pkg)
  const ok = hostDeps.length === 0
  return {
    kind: 'bundle',
    status: ok ? 'ok' : 'fail',
    detail: ok
      ? (runtimeDeps.length === 0 ? '运行时依赖无宿主包（0 个依赖）' : `运行时依赖无宿主包（${runtimeDeps.length} 个第三方库：${runtimeDeps.join(', ')}）`)
      : `宿主包进了 dependencies：${hostDeps.join(', ')}`,
    problems: ok ? [] : [{ kind: 'bundle', text: `package.json 运行时依赖出现宿主包：${hostDeps.join(', ')}（@deepseek-ai/* 须走 peerDependencies + devDependencies，ADR-0001；第三方库允许——2026-10-17 裁决）` }],
  }
}
