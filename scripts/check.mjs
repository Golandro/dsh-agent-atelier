#!/usr/bin/env node
/**
 * 本仓守卫（本仓无 CI、无远端，所以守卫挂在 `pnpm run check` 与 `.githooks/pre-commit` 上）。
 *
 * 本脚本只读 `src/` 源码，不要求 `lib/` 存在，也不触发构建：静态判定全部走
 * TypeScript AST（`typescript` 是 devDependency），类型层面交给 `pnpm run typecheck`。
 *
 * 检查项（由廉价到昂贵）：
 *   self-test  自身有牙：用合成坏输入断言下面每条判定都能报错
 *   scratch    已知探针目录不得残留（被 .gitignore 隐藏，`git status` 看不出来）
 *   bundle     `package.json` 运行时依赖不得含 `@deepseek-ai/*` 宿主包（ADR-0001 import 边界，宿主共享实例走 peer+dev；第三方库允许——2026-10-17 维护者裁决，install_bundle 随装入解析）
 *   deps       声明的每个 devDependency 必须已安装
 *   matrix     src/ 的 import 矩阵（ticket 16）：跨层只准公共入口；`@deepseek-ai/*` 只在 dsh/host 且 type-only（P1 现状，运行期放开归 P2/ADR-0004）；node:fs 只在 providers/dsh/host。type-only 由 AST 判定，不靠文本上溯
 *   anchors    `.scratch`/`docs` 里每一处 `path:line` 断言都必须能解析且行号在范围内
 *
 * 用法：
 *   node scripts/check.mjs              全量静态检查
 *   node scripts/check.mjs --self-test 只跑守卫自测
 *   node scripts/check.mjs --hook      pre-commit 模式：附带分支/暂存文件与修复建议
 *   node scripts/check.mjs --verbose   打印每层扫描统计
 *   node scripts/check.mjs --no-color  关闭 ANSI 颜色
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_SOURCE = process.env.DSH_SOURCE ?? join(homedir(), 'repo/deepseek-harness')
const SCRATCH_DIRS = ['.probe']
const ANCHOR_RE = /`([A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|json|yml|yaml|md|html)):(\d+)(?:-(\d+))?`/g
const STEP_TOTAL = 6
const ARGS = new Set(process.argv.slice(2))

const COLOR = process.env.NO_COLOR === undefined
  && !ARGS.has('--no-color')
  && (process.env.FORCE_COLOR === '1' || process.stdout.isTTY === true)
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text)
const green = (text) => paint('32', text)
const red = (text) => paint('31', text)
const yellow = (text) => paint('33', text)
const cyan = (text) => paint('36', text)
const dim = (text) => paint('2', text)
const bold = (text) => paint('1', text)

/** 修复建议：按问题类别给 pre-commit 模式收尾。 */
const HINTS = {
  'self-test': '守卫自身的判定失灵：先修 `scripts/check.mjs` 的自测，别绕过。',
  scratch: '删除残留探针目录（例如 `.probe/`，它被 .gitignore 隐藏）。',
  bundle: '把 `@deepseek-ai/*` 从 `dependencies` 移到 `peerDependencies` + `devDependencies`（ADR-0001）。',
  deps: '安装缺失的 devDependency：`pnpm install --store-dir "$PWD/.pnpm-store"`（沙箱内，见 docs/agents/harness-facts.md）。',
  matrix: '跨层 import 只走公共入口：`src/contract/index.ts`、`src/core/index.ts`、`src/core/ports.ts`、`src/providers/fs/index.ts`、`src/dsh/host/index.ts`。',
  anchors: '修正票面/文档里的 `path:line`，或先跑 `pnpm run check:static` 看解析详情。',
}

/** @returns {string[]} 实际存在的探针目录 */
export function findScratchDirs(root = ROOT, names = SCRATCH_DIRS) {
  return names.filter((n) => existsSync(join(root, n))).map((n) => `${n}/`)
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
  { name: 'providers', dir: 'src/providers/', entries: ['src/contract/index.ts', 'src/core/ports.ts'], node: true, cordis: false },
  { name: 'dsh/host', dir: 'src/dsh/host/', entries: ['src/contract/index.ts', 'src/core/index.ts', 'src/core/ports.ts', 'src/providers/fs/index.ts'], node: true, cordis: true },
  { name: 'entry', dir: null, entries: PUBLIC_ENTRIES, node: [], cordis: false },
]

/**
 * 用 TypeScript AST 扫一个模块的 import/export-from：静态、副作用、动态。
 * 不依赖 `lib/`，也不做类型检查——`pnpm run typecheck` 负责那一层。
 *
 * type-only 判定看语法节点而不是文本：`import type`、`import { type A }`、
 * `export type` 都会被正确识别（后者在 `verbatimModuleSyntax` 下不产生运行时加载）。
 *
 * @param {string} fileName 用于 AST 推断脚本类型（`.ts`/`.tsx`）
 * @returns {{line: number, source: string, runtime: boolean}[]}
 */
export function scanImports(fileName, text) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const imports = []
  const add = (node, source, runtime) => imports.push({ line: lineOf(node), source, runtime })

  const importIsTypeOnly = (node) => {
    const clause = node.importClause
    if (clause === undefined) return false
    if (clause.isTypeOnly) return true
    // `import A, { type B } from 'x'` still needs A at runtime.
    if (clause.name !== undefined) return false
    const bindings = clause.namedBindings
    if (bindings === undefined || ts.isNamespaceImport(bindings)) return false
    return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
  }

  const exportIsTypeOnly = (node) => {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    if (clause === undefined || !ts.isNamedExports(clause)) return false
    return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, !importIsTypeOnly(node))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text, !exportIsTypeOnly(node))
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node, node.moduleReference.expression.text, !node.isTypeOnly)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument !== undefined && ts.isStringLiteralLike(argument)) add(node, argument.text, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports.sort((a, b) => a.line - b.line)
}

/** src/ 文件属于哪一层；不在任何层返回 undefined（本身就是要报的问题）。 */
function layerOf(file) {
  for (const layer of IMPORT_MATRIX) {
    if (layer.dir === null ? file === 'src/index.ts' : file.startsWith(layer.dir)) return layer
  }
  return undefined
}

/**
 * import 矩阵判定（ticket 16），AST 版。
 * @returns {{problems: string[], files: number, imports: number, byLayer: Record<string, number>}}
 */
export function analyzeImportMatrix(root = ROOT) {
  const problems = []
  const srcDir = join(root, 'src')
  const byLayer = Object.fromEntries(IMPORT_MATRIX.map((layer) => [layer.name, 0]))
  let files = 0
  let imports = 0
  const sourceFiles = listFiles(srcDir, srcDir).filter((f) => /\.tsx?$/.test(f)).sort()
  for (const file of sourceFiles) {
    const rel = `src/${file}`
    const layer = layerOf(rel)
    if (layer === undefined) {
      problems.push(`矩阵：${rel} 不在任何层（contract/core/providers/dsh，或入口 src/index.ts）`)
      continue
    }
    files += 1
    byLayer[layer.name] += 1
    for (const imp of scanImports(rel, readFileSync(join(srcDir, file), 'utf8'))) {
      imports += 1
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
  return { problems, files, imports, byLayer }
}

/** 兼容旧调用：只取违规清单。@returns {string[]} 每条 `矩阵：<file>:<line> …` */
export function checkImportMatrix(root = ROOT) {
  return analyzeImportMatrix(root).problems
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
  return { anchors, files: files.length }
}

function selfTest() {
  const failures = []
  let total = 0
  const check = (name, condition) => {
    total += 1
    if (!condition) failures.push(name)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'check-selftest-'))
  try {
    mkdirSync(join(tmp, 'src'))
    writeFileSync(join(tmp, 'src', 'index.ts'), 'export const a = 1\n')

    // AST：type-only / runtime / 副作用 / 动态 import 的判定。
    const scan = (text) => scanImports('memory.ts', text)
    check('AST：import type 判 type-only', scan('import type { A } from \'./a.ts\'\n')[0]?.runtime === false)
    check('AST：全 type 修饰符判 type-only', scan('import { type A, type B } from \'./a.ts\'\n')[0]?.runtime === false)
    check('AST：值 import 判 runtime', scan('import { A } from \'./a.ts\'\n')[0]?.runtime === true)
    check('AST：default 值 import 判 runtime', scan('import A, { type B } from \'./a.ts\'\n')[0]?.runtime === true)
    check('AST：副作用 import 判 runtime', scan('import \'./a.ts\'\n')[0]?.runtime === true)
    check('AST：动态 import 判 runtime', scan('async function f() { return import(\'./a.ts\') }\n')[0]?.runtime === true)
    check('AST：export type 判 type-only', scan('export type { A } from \'./a.ts\'\n')[0]?.runtime === false)
    check('AST：export { type A } 判 type-only', scan('export { type A } from \'./a.ts\'\n')[0]?.runtime === false)
    check('AST：多行 import 行号取语句头', scan('import {\n  A,\n} from \'./a.ts\'\n')[0]?.line === 1)

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
      violation('matrix providers 走 core/index 应报错（设计只准 ports 子入口）', 'src/providers/fs/bad-core-index.ts', 'import { f } from \'../../core/index.ts\'\n', 'bad-core-index.ts:1')
      put('src/index.ts', 'export { f } from \'./core/catalog/inner.ts\'\n')
      check('matrix 入口走深路径应报错', checkImportMatrix(mtmp).some((p) => p.includes('src/index.ts:1')))
    } finally {
      rmSync(mtmp, { recursive: true, force: true })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return { failures, total }
}

function reportStep(index, label, status, detail, elapsed) {
  const icon = status === 'ok' ? green('✓') : status === 'warn' ? yellow('!') : red('✗')
  console.log(`  ${dim(`▸ ${index}/${STEP_TOTAL}`)} ${label} ${icon} ${detail} ${dim(`· ${elapsed}ms`)}`)
}

/** 当前 git 上下文；不在仓库里返回 null。读不到的分支/HEAD 返回空串。 */
function gitContext() {
  const run = (...args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
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

function reportHookContext(context) {
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

function reportHookFailure(problems, context) {
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

function main() {
  const hook = ARGS.has('--hook')
  const verbose = ARGS.has('--verbose')
  const problems = []
  const started = performance.now()
  const hookContext = hook ? gitContext() : null

  console.log(`${bold('check:')} 仓库守卫（TS AST · typescript ${ts.version}${hook ? ' · pre-commit' : ''}）`)
  if (hook) reportHookContext(hookContext)

  // 1/6 self-test：守卫自身的牙齿。
  let stepStarted = performance.now()
  const self = selfTest()
  reportStep(1, 'self-test', self.failures.length === 0 ? 'ok' : 'fail',
    self.failures.length === 0 ? `${self.total} 条断言全部有牙` : `${self.failures.length}/${self.total} 条判定失灵`,
    Math.round(performance.now() - stepStarted))
  for (const failure of self.failures) console.error(`      ${red('FAIL')} ${failure}`)
  if (self.failures.length > 0) problems.push({ kind: 'self-test', text: `self-test 失败：${self.failures.length}/${self.total} 条判定失灵（守卫本身不可信）` })
  if (ARGS.has('--self-test')) {
    console.log(problems.length === 0 ? `${green('check: 通过')}（self-test 模式）` : `${red('check: 未通过')}（self-test 模式）`)
    return problems.length === 0 ? 0 : 1
  }

  // 2/6 scratch：被 .gitignore 隐藏的探针目录。
  stepStarted = performance.now()
  const scratch = findScratchDirs()
  reportStep(2, 'scratch', scratch.length === 0 ? 'ok' : 'fail',
    scratch.length === 0 ? `无残留探针目录（检查 ${SCRATCH_DIRS.length} 个）` : `残留 ${scratch.join(', ')}`,
    Math.round(performance.now() - stepStarted))
  if (scratch.length > 0) problems.push({ kind: 'scratch', text: `残留探针目录：${scratch.join(', ')}（被 .gitignore 隐藏，\`git status\` 看不出来）` })

  // 3/6 bundle：宿主包不得进运行时 dependencies。
  stepStarted = performance.now()
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const runtimeDeps = Object.keys(pkg.dependencies ?? {})
  const hostDeps = hostRuntimeDeps(pkg)
  reportStep(3, 'bundle', hostDeps.length === 0 ? 'ok' : 'fail',
    hostDeps.length === 0
      ? (runtimeDeps.length === 0 ? '运行时依赖无宿主包（0 个依赖）' : `运行时依赖无宿主包（${runtimeDeps.length} 个第三方库：${runtimeDeps.join(', ')}）`)
      : `宿主包进了 dependencies：${hostDeps.join(', ')}`,
    Math.round(performance.now() - stepStarted))
  if (hostDeps.length > 0) problems.push({ kind: 'bundle', text: `package.json 运行时依赖出现宿主包：${hostDeps.join(', ')}（@deepseek-ai/* 须走 peerDependencies + devDependencies，ADR-0001；第三方库允许——2026-10-17 裁决）` })

  // 4/6 deps：devDependency 必须已安装。
  stepStarted = performance.now()
  const devDeps = Object.keys(pkg.devDependencies ?? {})
  const missingDeps = missingDevDeps(pkg)
  reportStep(4, 'deps', missingDeps.length === 0 ? 'ok' : 'fail',
    missingDeps.length === 0 ? `devDependency 全部已安装（${devDeps.length}/${devDeps.length}）` : `未安装：${missingDeps.join(', ')}`,
    Math.round(performance.now() - stepStarted))
  if (missingDeps.length > 0) problems.push({ kind: 'deps', text: `devDependency 未安装：${missingDeps.join(', ')} → 跑 \`pnpm install\`（沙箱内注意 store 陷阱，见 docs/agents/harness-facts.md）` })

  // 5/6 import 矩阵：TS AST 判定，不读 lib/。
  stepStarted = performance.now()
  const matrix = analyzeImportMatrix()
  reportStep(5, 'import 矩阵', matrix.problems.length === 0 ? 'ok' : 'fail',
    matrix.problems.length === 0
      ? `四层依赖方向零违规（扫描 ${matrix.files} 文件 / ${matrix.imports} 条 import）`
      : `${matrix.problems.length} 处违规（扫描 ${matrix.files} 文件 / ${matrix.imports} 条 import）`,
    Math.round(performance.now() - stepStarted))
  if (verbose) {
    const layers = Object.entries(matrix.byLayer).map(([name, count]) => `${name} ${count}`).join(' · ')
    console.log(`      ${dim(`层文件数：${layers}`)}`)
  }
  for (const problem of matrix.problems) console.error(`      ${red('✗')} ${problem}`)
  problems.push(...matrix.problems.map((text) => ({ kind: 'matrix', text })))

  // 6/6 anchors：票面/文档里的 path:line 必须能解析。
  stepStarted = performance.now()
  const { anchors, files: anchorFiles } = collectAnchors()
  const dshMissing = !existsSync(DSH_SOURCE)
  let anchorFailures = 0
  let anchorUnverified = 0
  for (const anchor of anchors) {
    const res = resolveAnchor(anchor)
    if (res.status === 'ok') continue
    if (dshMissing && res.status === 'missing') {
      anchorUnverified += 1
      if (verbose) console.log(`      ${yellow('?')} ${anchor.source} ${anchor.token}（无法判定：缺少 DSH 源码树）`)
      continue
    }
    anchorFailures += 1
    const detail = res.status === 'out-of-range'
      ? `越界：${res.file} 只有 ${res.total} 行`
      : res.status === 'ambiguous'
        ? `有 ${res.candidates.length} 个同名命中，请补全分组前缀：${res.candidates.slice(0, 3).join(' | ')}`
        : '解析不到该文件'
    problems.push({ kind: 'anchors', text: `锚点漂移：${anchor.source} ${anchor.token} → ${detail}` })
  }
  const anchorDetail = anchorFailures > 0
    ? `${anchorFailures}/${anchors.length} 处漂移（扫描 ${anchorFiles} 个 markdown 文件）`
    : `${anchors.length} 处 path:line 全解析（扫描 ${anchorFiles} 个 markdown 文件${dshMissing ? `；缺少 DSH 源码树，${anchorUnverified} 处未判定` : ''}）`
  reportStep(6, 'anchors', anchorFailures > 0 ? 'fail' : anchorUnverified > 0 ? 'warn' : 'ok',
    anchorDetail, Math.round(performance.now() - stepStarted))
  for (const problem of problems.filter((item) => item.kind === 'anchors')) console.error(`      ${red('✗')} ${problem.text}`)

  const elapsed = Math.round(performance.now() - started)
  if (problems.length === 0) {
    console.log(`\n${green('check: 通过')}（${STEP_TOTAL} 项检查 · ${elapsed}ms）`)
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
