/**
 * import 矩阵检查（ticket 16 / 17）：TS AST 判定，不读 `lib/`。
 *
 * 扫描根为 `src/` 与三个 chunk 根（`client-editor/`、`client-list/`、`client-registry/`）。
 * 跨层只准公共入口；`@deepseek-ai/*` 只在 dsh/host 且 type-only（P1 现状，
 * 运行期放开归 P2/ADR-0004）；node:fs 只在 providers/dsh/host。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { listFiles } from './files.mjs'
import { ROOT } from './paths.mjs'
import { dim, red } from './ui.mjs'

/** 公共入口：跨层 import 只准落在这些文件上（ticket 16 的矩阵白名单）。 */
export const PUBLIC_ENTRIES = [
  'src/contract/index.ts',
  'src/core/index.ts',
  'src/core/ports.ts',
  'src/providers/fs/index.ts',
  'src/agent-assembly/index.ts',
  'src/control/index.ts',
  'src/control/client-errors.ts',
  'src/control/http-client.ts',
  'src/dsh/host/index.ts',
]

/**
 * 三个 chunk 源（`client-editor/`、`client-list/`、`client-registry/`）与宿主翼的全部接触面（ticket 17 / 59）：
 * 打包产物的共享契约 `src/dsh/client/chunk-contracts.ts`，加 control 公共入口
 * （`client-list` 的查询求值走 `evaluateAgentQuery`）。其余 `src/` 深路径一律报错。
 */
export const CHUNK_ENTRIES = [
  'src/control/index.ts',
  'src/dsh/client/chunk-contracts.ts',
]

/**
 * 每层的依赖面：`dir` 内部深引用随便；跨层只准 `entries`；
 * `node` 列出允许的 `node:` 模块（true = 全部）；`cordis` = 允许 `@deepseek-ai/cordis`
 * 且仅 type-only（Q5 的运行期 `Service` 例外在 P2 生效）；`external` = 由宿主
 * 平台注入的运行时模块白名单（client 层的 react 由模块加载器提供，打包时保持 external）；
 * `thirdParty` = 浏览器 chunk：第三方库随 chunk 打包（自带 vendor），但宿主包
 * （`@deepseek-ai/*`）与 `node:*` 不许进来——界面翼只与宿主共享 contract（ticket 17）。
 */
const IMPORT_MATRIX = [
  { name: 'contract', dir: 'src/contract/', entries: [], node: [], cordis: false },
  { name: 'core', dir: 'src/core/', entries: ['src/contract/index.ts'], node: ['node:path', 'node:os'], cordis: false },
  { name: 'providers', dir: 'src/providers/', entries: ['src/contract/index.ts', 'src/core/ports.ts'], node: true, cordis: false },
  { name: 'agent-assembly', dir: 'src/agent-assembly/', entries: ['src/contract/index.ts'], node: [], cordis: false },
  { name: 'control', dir: 'src/control/', entries: ['src/contract/index.ts', 'src/core/index.ts', 'src/core/ports.ts', 'src/providers/fs/index.ts'], node: ['node:path'], cordis: false },
  { name: 'dsh/client', dir: 'src/dsh/client/', entries: ['src/contract/index.ts', 'src/core/ports.ts', 'src/control/index.ts', 'src/control/client-errors.ts', 'src/control/http-client.ts'], node: [], cordis: false, external: ['react'] },
  { name: 'dsh/host', dir: 'src/dsh/host/', entries: ['src/contract/index.ts', 'src/core/index.ts', 'src/core/ports.ts', 'src/providers/fs/index.ts', 'src/agent-assembly/index.ts', 'src/control/index.ts'], node: true, cordis: true },
  { name: 'chunk-editor', dir: 'client-editor/', entries: CHUNK_ENTRIES, node: [], cordis: false, thirdParty: true },
  { name: 'chunk-list', dir: 'client-list/', entries: CHUNK_ENTRIES, node: [], cordis: false, thirdParty: true },
  { name: 'chunk-registry', dir: 'client-registry/', entries: CHUNK_ENTRIES, node: [], cordis: false, thirdParty: true },
  { name: 'entry', dir: null, entries: PUBLIC_ENTRIES, node: [], cordis: false },
]

/** 矩阵扫描根：`src/` 加三个发布 chunk 的源码根（ticket 17 起不再只扫 src/）。 */
const MATRIX_ROOTS = ['src', 'client-editor', 'client-list', 'client-registry']

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
 * import 矩阵判定（ticket 16 / 17），AST 版。
 * 扫描根：`src/`、`client-editor/`、`client-list/`。
 * @returns {{problems: string[], files: number, imports: number, byLayer: Record<string, number>}}
 */
export function analyzeImportMatrix(root = ROOT) {
  const problems = []
  const byLayer = Object.fromEntries(IMPORT_MATRIX.map((layer) => [layer.name, 0]))
  let files = 0
  let imports = 0
  const sourceFiles = MATRIX_ROOTS
    .flatMap((base) => listFiles(join(root, base), join(root, base)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${base}/${f}`))
    .sort()
  for (const rel of sourceFiles) {
    const layer = layerOf(rel)
    if (layer === undefined) {
      problems.push(`矩阵：${rel} 不在任何层（contract/core/providers/agent-assembly/control/dsh/client/dsh/host/chunk-editor/chunk-list/chunk-registry，或入口 src/index.ts）`)
      continue
    }
    files += 1
    byLayer[layer.name] += 1
    for (const imp of scanImports(rel, readFileSync(join(root, rel), 'utf8'))) {
      imports += 1
      const where = `${rel}:${imp.line}`
      const source = imp.source
      if (source.startsWith('.')) {
        const target = relative(root, resolve(root, dirname(rel), source)).split('\\').join('/')
        const within = layer.dir !== null && target.startsWith(layer.dir)
        if (within || layer.entries.includes(target)) continue
        problems.push(`矩阵：${where} 相对引用 "${source}" 越层（${layer.name} 层跨层只准 ${layer.entries.join(', ') || '无'}）`)
      } else if (source.startsWith('node:')) {
        if (layer.node !== true && !layer.node.includes(source)) {
          problems.push(`矩阵：${where} 引用 "${source}"（${layer.name} 层只准 ${Array.isArray(layer.node) && layer.node.length > 0 ? layer.node.join('/') : '无 node:'}）`)
        }
      } else if (layer.cordis && source === '@deepseek-ai/cordis') {
        if (imp.runtime) problems.push(`矩阵：${where} 运行期引用 "${source}"（dsh 层本票只准 type-only，Q5 的运行期例外在 P2）`)
      } else if (layer.thirdParty === true) {
        // 浏览器 chunk 自带 vendor：第三方库随包打进 chunk；宿主包不许跨翼。
        if (source.startsWith('@deepseek-ai/')) {
          problems.push(`矩阵：${where} 引用宿主包 "${source}"（${layer.name} 与宿主翼只共享 contract）`)
        }
      } else if (Array.isArray(layer.external) && layer.external.includes(source)) {
        // 平台注入的运行时模块（client 层 react），打包时保持 external。
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

export function runMatrix({ root = ROOT, verbose = false } = {}) {
  const matrix = analyzeImportMatrix(root)
  const ok = matrix.problems.length === 0
  const notes = []
  const errors = []
  if (verbose) {
    const layers = Object.entries(matrix.byLayer).map(([name, count]) => `${name} ${count}`).join(' · ')
    notes.push(dim(`层文件数：${layers}`))
    for (const problem of matrix.problems) errors.push(`${red('✗')} ${problem}`)
  }
  return {
    kind: 'matrix',
    status: ok ? 'ok' : 'fail',
    detail: ok
      ? `依赖方向零违规（扫描 ${matrix.files} 文件 / ${matrix.imports} 条 import，含 client-editor/client-list/client-registry 三个 chunk 根）`
      : `${matrix.problems.length} 处违规（扫描 ${matrix.files} 文件 / ${matrix.imports} 条 import）`,
    problems: matrix.problems.map((text) => ({ kind: 'matrix', text })),
    notes,
    errors,
  }
}
