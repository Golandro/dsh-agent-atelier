/** deps 检查：声明的每个 devDependency 必须已安装。 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './paths.mjs'

/** 声明了但没装的 devDependency */
export function missingDevDeps(pkg, root = ROOT) {
  return Object.keys(pkg.devDependencies ?? {}).filter((dep) => !existsSync(join(root, 'node_modules', dep)))
}

export function runDeps({ root = ROOT } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const devDeps = Object.keys(pkg.devDependencies ?? {})
  const missingDeps = missingDevDeps(pkg, root)
  const ok = missingDeps.length === 0
  return {
    kind: 'deps',
    status: ok ? 'ok' : 'fail',
    detail: ok ? `devDependency 全部已安装（${devDeps.length}/${devDeps.length}）` : `未安装：${missingDeps.join(', ')}`,
    problems: ok ? [] : [{ kind: 'deps', text: `devDependency 未安装：${missingDeps.join(', ')} → 跑 \`pnpm install\`（沙箱内注意 store 陷阱，见 docs/agents/harness-facts.md）` }],
  }
}
