/**
 * self-test 检查：守卫自身有牙。
 *
 * 用合成坏输入断言其它检查模块的每条判定都能报错；守卫本身失灵时，
 * 后续任何“通过”都不可信。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { analyzeBarePaths, parseAnchors, parseBarePaths, resolveAnchor } from './anchors.mjs'
import { hostRuntimeDeps } from './bundle.mjs'
import { checkImportMatrix, scanImports } from './matrix.mjs'
import { findScratchDirs } from './scratch.mjs'
import { red } from './ui.mjs'

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

    // 裸路径守卫（ticket 17）：存在的放行、缺失的报错，围栏与带行号写法不误报。
    const btmp = mkdtempSync(join(tmpdir(), 'check-bare-'))
    try {
      mkdirSync(join(btmp, 'src'), { recursive: true })
      mkdirSync(join(btmp, 'docs'), { recursive: true })
      writeFileSync(join(btmp, 'src', 'index.ts'), 'export const a = 1\n')
      const doc = (text) => writeFileSync(join(btmp, 'docs', 'note.md'), text)
      doc('见 `src/index.ts`、`src/...`（省略写法）与 `src/index.ts:3`（带行号，归锚点项）\n')
      check('裸路径：存在的令牌与省略/带行号写法都放行', analyzeBarePaths(btmp).problems.length === 0)
      check('裸路径：抽得到裸令牌且跳过带行号令牌', parseBarePaths('`src/a/b.ts` `src/a/b.ts:7`\n').length === 1)
      doc('```\n`src/gone/away.ts`\n```\n')
      check('裸路径：围栏代码块里的令牌不扫', analyzeBarePaths(btmp).problems.length === 0)
      doc('见 `src/gone/away.ts`\n')
      check('裸路径：缺失的令牌必须报错', analyzeBarePaths(btmp).problems.some((p) => p.includes('src/gone/away.ts')))
      writeFileSync(join(btmp, 'README.md'), '见 `src/gone/away.ts`\n')
      check('裸路径：README.md 也在扫描面内', analyzeBarePaths(btmp).problems.filter((p) => p.includes('README.md')).length === 1)
    } finally {
      rmSync(btmp, { recursive: true, force: true })
    }

    // import 矩阵：干净的领域包树零违规；各种合成越界都必须报错（ticket 16 / 包抽象 1）。
    const mtmp = mkdtempSync(join(tmpdir(), 'check-matrix-'))
    try {
      const put = (file, content) => {
        mkdirSync(dirname(join(mtmp, file)), { recursive: true })
        writeFileSync(join(mtmp, file), content)
      }
      put('src/contract/types.ts', 'export interface A { a: string }\n')
      put('src/contract/index.ts', 'export * from \'./types.ts\'\n')
      put('src/yaml/scalar.ts', 'export const y = 1\n')
      put('src/yaml/index.ts', 'export * from \'./scalar.ts\'\n')
      put('src/catalog/ports.ts', 'export interface P { p: string }\n')
      put('src/catalog/inner.ts', 'import type { A } from \'../contract/index.ts\'\nimport { join } from \'node:path\'\nexport function f(): string { return join(\'a\', \'b\') }\n')
      put('src/catalog/index.ts', 'export * from \'./ports.ts\'\nexport * from \'./inner.ts\'\n')
      put('src/resolve/engine.ts', 'import type { A } from \'../contract/index.ts\'\nexport function g(a: A): string { return a.a }\n')
      put('src/resolve/index.ts', 'export * from \'./engine.ts\'\n')
      put('src/providers/registry.ts', 'export function create(): number { return 1 }\n')
      put('src/providers/index.ts', 'export * from \'./registry.ts\'\n')
      put('src/providers/fs/node.ts', 'import { readFile } from \'node:fs/promises\'\nimport type { P } from \'../../catalog/ports.ts\'\nexport function r(): Promise<unknown> { return readFile(\'x\') }\n')
      put('src/providers/fs/index.ts', 'export * from \'./node.ts\'\n')
      put('src/dsh/host/plugin.ts', 'import type { Context } from \'@deepseek-ai/cordis\'\nimport { r } from \'../../providers/fs/index.ts\'\nexport function apply(ctx: Context): void { void r }\n')
      put('src/dsh/host/index.ts', 'export * from \'./plugin.ts\'\n')
      put('src/index.ts', 'export { A } from \'./contract/index.ts\'\n')
      check('matrix 干净领域包树应零违规', checkImportMatrix(mtmp).length === 0)
      put('src/control/client-errors.ts', 'export const e = 1\n')
      put('src/dsh/client/index.ts', 'import { e } from \'../../control/client-errors.ts\'\nimport { createElement } from \'react\'\nexport function apply(): unknown { return createElement(\'div\', null, e) }\n')
      check('matrix client 层允许平台 react 与 client-errors 子入口', checkImportMatrix(mtmp).length === 0)
      // 第二扫描根（ticket 17）：chunk 只准 chunk-contracts + control 公共入口，第三方库随包 vendor。
      put('src/control/index.ts', 'export const e = 1\nexport function evaluateAgentQuery(): string { return \'q\' }\n')
      put('src/dsh/client/chunk-contracts.ts', 'export interface ChunkProps { readonly p: string }\n')
      put('client-editor/index.ts', 'import type { ChunkProps } from \'../src/dsh/client/chunk-contracts.ts\'\nimport { layoutDocument } from \'./layout.ts\'\nexport const props: ChunkProps = { p: layoutDocument() }\n')
      put('client-editor/layout.ts', 'import { EditorState } from \'@codemirror/state\'\nexport function layoutDocument(): string { return EditorState.allowMultipleSelections.toString() }\n')
      put('client-list/rows.ts', 'export const rows: string[] = []\n')
      put('client-list/index.tsx', 'import { createElement as h } from \'react\'\nimport { useTable } from \'@tanstack/react-table\'\nimport { evaluateAgentQuery } from \'../src/control/index.ts\'\nimport type { ChunkProps } from \'../src/dsh/client/chunk-contracts.ts\'\nimport { rows } from \'./rows.ts\'\nexport const view = (props: ChunkProps) => h(\'div\', null, useTable, evaluateAgentQuery(), rows, props)\n')
      put('client-registry/pane.tsx', 'export const pane = 1\n')
      put('client-registry/index.tsx', 'import { createElement as h } from \'react\'\nimport { evaluateAgentQuery } from \'../src/control/index.ts\'\nimport type { ChunkProps } from \'../src/dsh/client/chunk-contracts.ts\'\nimport { pane } from \'./pane.tsx\'\nexport const view = (props: ChunkProps) => h(\'div\', null, evaluateAgentQuery(), pane, props)\n')
      check('matrix chunk 三根本身零违规（白名单 + vendor 第三方库）', checkImportMatrix(mtmp).length === 0)
      const violation = (name, file, content, needle) => {
        put(file, content)
        check(name, checkImportMatrix(mtmp).some((p) => p.includes(needle)))
      }
      violation('matrix chunk-editor 引用 node:fs 应报错', 'client-editor/bad-node.ts', 'import { readFileSync } from \'node:fs\'\n', 'client-editor/bad-node.ts:1')
      violation('matrix chunk-list 引用宿主包应报错', 'client-list/bad-host.ts', 'import { Context } from \'@deepseek-ai/cordis\'\n', 'client-list/bad-host.ts:1')
      violation('matrix chunk-list 走 catalog 公共入口应报错（只白名单 control 入口）', 'client-list/bad-catalog.ts', 'import { f } from \'../src/catalog/index.ts\'\n', 'client-list/bad-catalog.ts:1')
      violation('matrix chunk-editor 走 control 子入口应报错', 'client-editor/bad-sub.ts', 'import { e } from \'../src/control/client-errors.ts\'\n', 'client-editor/bad-sub.ts:1')
      violation('matrix chunk-list 越层到 chunk-editor 应报错', 'client-list/bad-cross.ts', 'import { props } from \'../client-editor/index.ts\'\n', 'client-list/bad-cross.ts:1')
      violation('matrix chunk-registry 越层到 chunk-list 应报错', 'client-registry/bad-cross.ts', 'import { rows } from \'../client-list/rows.ts\'\n', 'client-registry/bad-cross.ts:1')
      violation('matrix chunk-registry 引用宿主包应报错', 'client-registry/bad-host.ts', 'import { Context } from \'@deepseek-ai/cordis\'\n', 'client-registry/bad-host.ts:1')
      violation('matrix client 层引用 node:fs 应报错', 'src/dsh/client/bad-node.ts', 'import { readFileSync } from \'node:fs\'\n', 'bad-node.ts:1')
      violation('matrix catalog+node:fs 应报错', 'src/catalog/bad-fs.ts', 'import { readFileSync } from \'node:fs\'\n', 'bad-fs.ts:1')
      violation('matrix catalog 走 providers 深路径应报错', 'src/catalog/bad-deep.ts', 'import { r } from \'../../providers/fs/index.ts\'\n', 'bad-deep.ts:1')
      violation('matrix providers type-only cordis 应报错', 'src/providers/fs/bad-cordis.ts', 'import type { Context } from \'@deepseek-ai/cordis\'\n', 'bad-cordis.ts:1')
      violation('matrix dsh 运行期 cordis 应报错', 'src/dsh/host/bad-runtime.ts', 'import { Context } from \'@deepseek-ai/cordis\'\n', 'bad-runtime.ts:1')
      violation('matrix contract 任何 import 应报错', 'src/contract/bad-import.ts', 'import type { P } from \'../catalog/ports.ts\'\n', 'bad-import.ts:1')
      violation('matrix dsh 走 catalog 深路径应报错', 'src/dsh/host/bad-catalog-deep.ts', 'import { f } from \'../../catalog/inner.ts\'\n', 'bad-catalog-deep.ts:1')
      violation('matrix providers 走 catalog/index 应报错（设计只准 ports 子入口）', 'src/providers/fs/bad-catalog-index.ts', 'import { f } from \'../../catalog/index.ts\'\n', 'bad-catalog-index.ts:1')
      violation('matrix resolve 走 catalog 深路径应报错（新包边界）', 'src/resolve/bad-catalog.ts', 'import { f } from \'../catalog/inner.ts\'\n', 'bad-catalog.ts:1')
      put('src/index.ts', 'export { f } from \'./catalog/inner.ts\'\n')
      check('matrix 入口走深路径应报错', checkImportMatrix(mtmp).some((p) => p.includes('src/index.ts:1')))
    } finally {
      rmSync(mtmp, { recursive: true, force: true })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return { failures, total }
}

export function runSelfTest() {
  const self = selfTest()
  const ok = self.failures.length === 0
  return {
    kind: 'self-test',
    status: ok ? 'ok' : 'fail',
    detail: ok ? `${self.total} 条断言全部有牙` : `${self.failures.length}/${self.total} 条判定失灵`,
    problems: ok ? [] : [{ kind: 'self-test', text: `self-test 失败：${self.failures.length}/${self.total} 条判定失灵（守卫本身不可信）` }],
    errors: self.failures.map((failure) => `${red('FAIL')} ${failure}`),
  }
}
