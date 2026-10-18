#!/usr/bin/env node
/**
 * 本仓守卫（本仓无 CI、无远端，所以守卫挂在 `npm run check` 与 `.githooks/pre-commit` 上）。
 *
 * 检查项（由廉价到昂贵）：
 *   self-test  自身有牙：用合成坏输入断言下面每条判定都能报错
 *   scratch    已知探针目录不得残留（被 .gitignore 隐藏，`git status` 看不出来）
 *   build      `lib/` 必须存在且不旧于 `src/`（profile 装的是 lib/，不是 src/）
 *   bundle     `package.json` 运行时依赖不得含 `@deepseek-ai/*` 宿主包（ADR-0001 import 边界，宿主共享实例走 peer+dev；第三方库允许——2026-10-17 维护者裁决，install_bundle 随装入解析）
 *   deps       声明的每个 devDependency 必须已安装
 *   matrix     src/ 的 import 矩阵（ticket 16）：跨层只准公共入口；`@deepseek-ai/*` 只在 dsh/host 且 type-only；node:fs 只在 providers/dsh
 *   anchors    `.scratch`/`docs` 里每一处 `path:line` 断言都必须能解析且行号在范围内
 *
 * 用法：`npm run check`（全量）| `npm run check:static`（只跑本脚本）| `--self-test`
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

/** 公共入口：跨层 import 只准落在这些文件上（ticket 16 的矩阵白名单）。 */
export const PUBLIC_ENTRIES = [
  'src/contract/index.ts',
  'src/core/index.ts',
  'src/core/ports.ts',
  'src/providers/fs/index.ts',
  'src/dsh/host/index.ts',
]

/**
 * 每层的依赖面：`dir` 内部深引用随便；跨层只准 `entries`；
 * `node` 列出允许的 `node:` 模块（true = 全部）；`cordis` = 允许 `@deepseek-ai/cordis`
 * 且仅 type-only（Q5 的运行期 `Service` 例外在 P2 生效）。
 */
const IMPORT_MATRIX = [
  { name: 'contract', dir: 'src/contract/', entries: [], node: [], cordis: false },
  { name: 'core', dir: 'src/core/', entries: ['src/contract/index.ts'], node: ['node:path', 'node:os'], cordis: false },
  { name: 'providers', dir: 'src/providers/', entries: ['src/contract/index.ts', 'src/core/index.ts', 'src/core/ports.ts'], node: true, cordis: false },
  { name: 'dsh', dir: 'src/dsh/', entries: ['src/contract/index.ts', 'src/core/index.ts', 'src/core/ports.ts', 'src/providers/fs/index.ts'], node: true, cordis: true },
  { name: 'entry', dir: null, entries: PUBLIC_ENTRIES, node: [], cordis: false },
]

/** 扫一个文件的 import：静态（head 行 `import type`/`export type` 判 type-only）、副作用、动态。 */
export function scanImports(text) {
  const lines = text.split('\n')
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const m of line.matchAll(/import\(\s*['"]([^'"]+)['"]/g)) out.push({ line: index + 1, source: m[1], runtime: true })
    const sideEffect = /^import\s+['"]([^'"]+)['"]/.exec(line)
    if (sideEffect !== null) {
      out.push({ line: index + 1, source: sideEffect[1], runtime: true })
      continue
    }
    const from = /\sfrom\s*['"]([^'"]+)['"]/.exec(line)
    if (from === null) continue
    let head = index
    while (head > 0 && !/^\s*(?:import|export)\b/.test(lines[head])) head -= 1
    const typeOnly = /^\s*(?:import|export)\s+type\b/.test(lines[head] ?? '')
    out.push({ line: index + 1, source: from[1], runtime: !typeOnly })
  }
  return out
}

/** src/ 文件属于哪一层；不在任何层返回 undefined（本身就是要报的问题）。 */
function layerOf(file) {
  for (const layer of IMPORT_MATRIX) {
    if (layer.dir === null ? file === 'src/index.ts' : file.startsWith(layer.dir)) return layer
  }
  return undefined
}

/** import 矩阵判定（ticket 16）。@returns {string[]} 违规清单，每条 `矩阵：<file>:<line> …` */
export function checkImportMatrix(root = ROOT) {
  const problems = []
  const srcDir = join(root, 'src')
  for (const file of listFiles(srcDir, srcDir).filter((f) => f.endsWith('.ts')).sort()) {
    const rel = `src/${file}`
    const layer = layerOf(rel)
    if (layer === undefined) {
      problems.push(`矩阵：${rel} 不在任何层（contract/core/providers/dsh，或入口 src/index.ts）`)
      continue
    }
    for (const imp of scanImports(readFileSync(join(srcDir, file), 'utf8'))) {
      const where = `${rel}:${imp.line}`
      const source = imp.source
      if (source.startsWith('.')) {
        const target = `src/${relative(srcDir, resolve(srcDir, dirname(file), source)).split('\\').join('/')}`
        const within = layer.dir !== null && target.startsWith(layer.dir)
        if (within || layer.entries.includes(target)) continue
        problems.push(`矩阵：${where} 相对引用 "${source}" 越层（${layer.name} 层跨层只准 ${layer.entries.join(', ') || '无'}）`)
      } else if (source.startsWith('node:')) {
        if (layer.node !== true && !layer.node.includes(source)) {
          problems.push(`矩阵：${where} 引用 "${source}"（${layer.name} 层只准 ${Array.isArray(layer.node) && layer.node.length > 0 ? layer.node.join('/') : '无 node:'}）`)
        }
      } else if (layer.cordis && source === '@deepseek-ai/cordis') {
        if (imp.runtime) problems.push(`矩阵：${where} 运行期引用 "${source}"（dsh 层本票只准 type-only，Q5 的运行期例外在 P2）`)
      } else {
        problems.push(`矩阵：${where} 引用外部包 "${source}"（${layer.name} 层不准依赖任何包）`)
      }
    }
  }
  return problems
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

    // import 矩阵：干净的四层树零违规；七种合成越界都必须报错（ticket 16）。
    const mtmp = mkdtempSync(join(tmpdir(), 'check-matrix-'))
    try {
      const put = (file, content) => {
        mkdirSync(dirname(join(mtmp, file)), { recursive: true })
        writeFileSync(join(mtmp, file), content)
      }
      put('src/contract/types.ts', 'export interface A { a: string }\n')
      put('src/contract/index.ts', 'export * from \'./types.ts\'\n')
      put('src/core/ports.ts', 'export interface P { p: string }\n')
      put('src/core/catalog/inner.ts', 'import type { A } from \'../../contract/index.ts\'\nimport { join } from \'node:path\'\nexport function f(): string { return join(\'a\', \'b\') }\n')
      put('src/core/index.ts', 'export * from \'./ports.ts\'\nexport * from \'./catalog/inner.ts\'\n')
      put('src/providers/fs/node.ts', 'import { readFile } from \'node:fs/promises\'\nimport type { P } from \'../../core/ports.ts\'\nexport function r(): Promise<unknown> { return readFile(\'x\') }\n')
      put('src/providers/fs/index.ts', 'export * from \'./node.ts\'\n')
      put('src/dsh/host/plugin.ts', 'import type { Context } from \'@deepseek-ai/cordis\'\nimport { r } from \'../../providers/fs/index.ts\'\nexport function apply(ctx: Context): void { void r }\n')
      put('src/dsh/host/index.ts', 'export * from \'./plugin.ts\'\n')
      put('src/index.ts', 'export { A } from \'./contract/index.ts\'\n')
      check('matrix 干净四层树应零违规', checkImportMatrix(mtmp).length === 0)
      const violation = (name, file, content, needle) => {
        put(file, content)
        check(name, checkImportMatrix(mtmp).some((p) => p.includes(needle)))
      }
      violation('matrix core+node:fs 应报错', 'src/core/catalog/bad-fs.ts', 'import { readFileSync } from \'node:fs\'\n', 'bad-fs.ts:1')
      violation('matrix core 走 providers 深路径应报错', 'src/core/catalog/bad-deep.ts', 'import { r } from \'../../../providers/fs/index.ts\'\n', 'bad-deep.ts:1')
      violation('matrix providers type-only cordis 应报错', 'src/providers/fs/bad-cordis.ts', 'import type { Context } from \'@deepseek-ai/cordis\'\n', 'bad-cordis.ts:1')
      violation('matrix dsh 运行期 cordis 应报错', 'src/dsh/host/bad-runtime.ts', 'import { Context } from \'@deepseek-ai/cordis\'\n', 'bad-runtime.ts:1')
      violation('matrix contract 任何 import 应报错', 'src/contract/bad-import.ts', 'import type { P } from \'../core/ports.ts\'\n', 'bad-import.ts:1')
      violation('matrix dsh 走 core 深路径应报错', 'src/dsh/host/bad-core-deep.ts', 'import { f } from \'../../core/catalog/inner.ts\'\n', 'bad-core-deep.ts:1')
      put('src/index.ts', 'export { f } from \'./core/catalog/inner.ts\'\n')
      check('matrix 入口走深路径应报错', checkImportMatrix(mtmp).some((p) => p.includes('src/index.ts:1')))
    } finally {
      rmSync(mtmp, { recursive: true, force: true })
    }
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
  if (!fresh.ok) problems.push(`build 不新鲜：${fresh.reason} → 跑 \`npm run build\``)

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const hostDeps = hostRuntimeDeps(pkg)
  if (hostDeps.length > 0) problems.push(`package.json 运行时依赖出现宿主包：${hostDeps.join(', ')}（@deepseek-ai/* 须走 peerDependencies + devDependencies，ADR-0001；第三方库允许——2026-10-17 裁决）`)

  const missingDeps = missingDevDeps(pkg)
  if (missingDeps.length > 0) problems.push(`devDependency 未安装：${missingDeps.join(', ')} → 跑 \`pnpm install\`（沙箱内注意 store 陷阱，见 docs/agents/harness-facts.md）`)

  const matrix = checkImportMatrix()
  console.log(matrix.length === 0 ? '  ✓ import 矩阵：四层依赖方向零违规' : `  ✗ import 矩阵：${matrix.length} 处违规`)
  problems.push(...matrix)

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
