#!/usr/bin/env node
/**
 * 本仓守卫（本仓无 CI、无远端，所以守卫挂在 `pnpm run check` 与 `.githooks/pre-commit` 上）。
 *
 * 检查项（由廉价到昂贵）：
 *   self-test  自身有牙：用合成坏输入断言下面每条判定都能报错
 *   scratch    已知探针目录不得残留（被 .gitignore 隐藏，`git status` 看不出来）
 *   build      `lib/` 必须存在且不旧于 `src/`（profile 装的是 lib/，不是 src/）
 *   bundle     `package.json` 运行时依赖不得含 `@deepseek-ai/*` 宿主包（ADR-0001 import 边界，宿主共享实例走 peer+dev；第三方库允许——2026-10-17 维护者裁决，install_bundle 随装入解析）
 *   deps       声明的每个 devDependency 必须已安装
 *   anchors    `.scratch`/`docs` 里每一处 `path:line` 断言都必须能解析且行号在范围内
 *
 * 用法：`pnpm run check`（全量）| `pnpm run check:static`（只跑本脚本）| `--self-test`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_SOURCE = process.env.DSH_SOURCE ?? join(homedir(), 'repo/deepseek-harness')
const SCRATCH_DIRS = ['.probe']
const ANCHOR_RE = /`([A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|json|yml|yaml|md|html)):(\d+)(?:-(\d+))?`/g

/** @returns {string[]} 实际存在的探针目录 */
export function findScratchDirs(root = ROOT, names = SCRATCH_DIRS) {
  return names.filter((n) => existsSync(join(root, n))).map((n) => `${n}/`)
}

/** 递归取最新 mtime（毫秒），目录不存在返回 0 */
export function newestMtime(dir) {
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs)
  }
  return newest
}

/** 列出目录下所有文件（相对 dir，跳过 node_modules/.git） */
export function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(path, base))
    else out.push(relative(base, path))
  }
  return out
}

/**
 * `lib/` 是否跟得上 `src/`：缺产物文件，或 src 比 lib 新。
 * @returns {{ok: boolean, reason?: string}}
 */
export function buildFresh(root = ROOT) {
  const src = join(root, 'src')
  const lib = join(root, 'lib')
  if (!existsSync(join(lib, 'index.js'))) return { ok: false, reason: 'lib/index.js 不存在' }
  const missing = listFiles(src)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, '.js'))
    .filter((f) => !existsSync(join(lib, f)))
  if (missing.length > 0) return { ok: false, reason: `未编译的源码：${missing.join(', ')}` }
  const srcNewest = newestMtime(src)
  const libOldest = Math.min(...listFiles(lib).map((f) => statSync(join(lib, f)).mtimeMs))
  if (srcNewest > libOldest) return { ok: false, reason: 'src/ 比 lib/ 新（改完源码没重建）' }
  return { ok: true }
}

/** 运行时依赖里不得出现宿主包：`@deepseek-ai/*` 须走 peerDependencies + devDependencies（宿主 publish 纪律；ADR-0001 import 边界）。第三方库允许进 `dependencies`：install_bundle 装入时随 pnpm add 进 profile 解析（2026-10-17 维护者裁决「我们需要这些依赖」）。 */
export function hostRuntimeDeps(pkg) {
  return Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith('@deepseek-ai/'))
}

/** 声明了但没装的 devDependency */
export function missingDevDeps(pkg, root = ROOT) {
  return Object.keys(pkg.devDependencies ?? {}).filter((dep) => !existsSync(join(root, 'node_modules', dep)))
}

/** 从 markdown 文本抽取 `path:line` 断言 */
export function parseAnchors(text, source = '') {
  const out = []
  for (const m of text.matchAll(ANCHOR_RE)) {
    const start = Number(m[2])
    const end = m[3] ? Number(m[3]) : start
    out.push({ token: m[0], path: m[1], line: Math.max(start, end), source })
  }
  return out
}

/**
 * 解析一处锚点：先按 workspace 相对路径，再按 DSH 源码树后缀唯一匹配，最后 $DSH_HOME。
 * @returns {{status: 'ok'|'missing'|'ambiguous'|'out-of-range', file?: string, total?: number, candidates?: string[]}}
 */
export function resolveAnchor(anchor, { root = ROOT, dshSource = DSH_SOURCE } = {}) {
  const candidates = []
  const direct = join(root, anchor.path)
  if (existsSync(direct)) candidates.push(direct)
  if (candidates.length === 0 && existsSync(join(dshSource, 'packages'))) {
    try {
      const hits = execFileSync('find', [join(dshSource, 'packages'), '-path', `*/${anchor.path}`, '-not', '-path', '*node_modules*', '-not', '-path', '*/lib/*'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
      candidates.push(...hits)
    } catch {
      /* find 失败视为未解析 */
    }
  }
  const home = process.env.DSH_HOME
  if (candidates.length === 0 && home && existsSync(join(home, anchor.path))) candidates.push(join(home, anchor.path))
  if (candidates.length === 0) return { status: 'missing' }
  if (candidates.length > 1) return { status: 'ambiguous', candidates }
  const file = candidates[0]
  const total = readFileSync(file, 'utf8').split('\n').length
  if (anchor.line > total) return { status: 'out-of-range', file, total }
  return { status: 'ok', file, total }
}

function collectAnchors(root = ROOT) {
  const files = []
  for (const base of [join(root, '.scratch'), join(root, 'docs')]) {
    for (const f of listFiles(base, base)) if (f.endsWith('.md')) files.push(join(base, f))
  }
  for (const f of ['AGENTS.md', 'README.md']) if (existsSync(join(root, f))) files.push(join(root, f))
  const anchors = []
  for (const file of files) anchors.push(...parseAnchors(readFileSync(file, 'utf8'), relative(root, file)))
  return anchors
}

function selfTest() {
  const failures = []
  const check = (name, cond) => { if (!cond) failures.push(name) }
  const tmp = mkdtempSync(join(tmpdir(), 'check-selftest-'))
  try {
    mkdirSync(join(tmp, 'src'))
    mkdirSync(join(tmp, 'lib'))
    writeFileSync(join(tmp, 'src', 'index.ts'), 'export const a = 1\n')
    writeFileSync(join(tmp, 'lib', 'index.js'), 'export const a = 1\n')
    check('buildFresh 刚构建的树应通过', buildFresh(tmp).ok === true)
    utimesSync(join(tmp, 'src', 'index.ts'), new Date(Date.now() + 2000), new Date(Date.now() + 2000))
    check('buildFresh src 更新应报错', buildFresh(tmp).ok === false)
    utimesSync(join(tmp, 'lib', 'index.js'), new Date(Date.now() + 4000), new Date(Date.now() + 4000))
    check('buildFresh 重建后应通过', buildFresh(tmp).ok === true)
    writeFileSync(join(tmp, 'src', 'extra.ts'), 'export const b = 2\n')
    check('buildFresh 新增未编译文件应报错', buildFresh(tmp).ok === false)
    mkdirSync(join(tmp, '.probe'))
    check('findScratchDirs 能发现 .probe', findScratchDirs(tmp).includes('.probe/'))
    check('hostRuntimeDeps 能发现宿主运行时依赖', hostRuntimeDeps({ dependencies: { 'js-yaml': '1', '@deepseek-ai/cordis': '2' } }).length === 1 && hostRuntimeDeps({ dependencies: { 'js-yaml': '1', zod: '2' } }).length === 0)
    check('parseAnchors 抽得到范围锚点', parseAnchors('`a/b.ts:10-20`')[0]?.line === 20)
    check('resolveAnchor 对不存在路径报 missing', resolveAnchor({ path: 'nope/not-here.ts', line: 1 }, { root: tmp, dshSource: tmp }).status === 'missing')
    check('resolveAnchor 对超范围行号报 out-of-range', resolveAnchor({ path: 'src/index.ts', line: 999 }, { root: tmp, dshSource: tmp }).status === 'out-of-range')
    check('resolveAnchor 对唯一命中报 ok', resolveAnchor({ path: 'src/index.ts', line: 1 }, { root: tmp, dshSource: tmp }).status === 'ok')
    mkdirSync(join(tmp, 'packages', 'a'), { recursive: true })
    mkdirSync(join(tmp, 'packages', 'b'), { recursive: true })
    writeFileSync(join(tmp, 'packages', 'a', 'x.ts'), '\n\n')
    writeFileSync(join(tmp, 'packages', 'b', 'x.ts'), '\n\n')
    check('resolveAnchor 对同名多命中报 ambiguous', resolveAnchor({ path: 'x.ts', line: 1 }, { root: tmp, dshSource: tmp }).status === 'ambiguous')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  for (const f of failures) console.error(`  FAIL  ${f}`)
  console.log(failures.length === 0 ? '  ✓ self-test：每条判定都能报错' : `  ✗ self-test：${failures.length} 条判定失灵`)
  return failures.length === 0
}

function main() {
  const args = new Set(process.argv.slice(2))
  const problems = []
  console.log('check: 守卫')

  if (!selfTest()) problems.push('self-test 失败（守卫本身失灵）')
  if (args.has('--self-test')) {
    process.exit(problems.length === 0 ? 0 : 1)
  }

  const scratch = findScratchDirs()
  if (scratch.length > 0) problems.push(`残留探针目录：${scratch.join(', ')}（被 .gitignore 隐藏，必须删掉）`)

  const fresh = buildFresh()
  if (!fresh.ok) problems.push(`build 不新鲜：${fresh.reason} → 跑 \`pnpm run build\``)

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const hostDeps = hostRuntimeDeps(pkg)
  if (hostDeps.length > 0) problems.push(`package.json 运行时依赖出现宿主包：${hostDeps.join(', ')}（@deepseek-ai/* 须走 peerDependencies + devDependencies，ADR-0001；第三方库允许——2026-10-17 裁决）`)

  const missingDeps = missingDevDeps(pkg)
  if (missingDeps.length > 0) problems.push(`devDependency 未安装：${missingDeps.join(', ')} → 跑 \`pnpm install\`（沙箱内注意 store 陷阱，见 docs/agents/harness-facts.md）`)

  const anchors = collectAnchors()
  const dshMissing = !existsSync(DSH_SOURCE)
  if (dshMissing && anchors.length > 0) console.log(`  ! DSH 源码树不存在（${DSH_SOURCE}）：只校验 workspace 内锚点`)
  for (const anchor of anchors) {
    const res = resolveAnchor(anchor)
    if (res.status === 'ok') continue
    if (dshMissing && res.status === 'missing') {
      console.log(`  ? ${anchor.source} ${anchor.token}（无法判定：缺少 DSH 源码树）`)
      continue
    }
    const detail = res.status === 'out-of-range'
      ? `越界：${res.file} 只有 ${res.total} 行`
      : res.status === 'ambiguous'
        ? `有 ${res.candidates.length} 个同名命中，请补全分组前缀：${res.candidates.slice(0, 3).join(' | ')}`
        : '解析不到该文件'
    problems.push(`锚点漂移：${anchor.source} ${anchor.token} → ${detail}`)
  }
  console.log(`  ✓ 扫过锚点 ${anchors.length} 处（workspace + ${dshMissing ? '缺少 DSH 源码树' : DSH_SOURCE}）`)

  if (problems.length === 0) {
    console.log('check: 通过')
    return 0
  }
  console.error('\ncheck: 未通过')
  for (const p of problems) console.error(`  ✗ ${p}`)
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
