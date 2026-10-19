/**
 * 票 05 的懒加载构建链守卫：不跑 tsc（host 产物与本测试无关），直接重放
 * 两个构建脚本，然后断言三份浏览器产物的形状——
 *
 *   lib/client.js        轻壳：零 CodeMirror/TanStack，chunk 缝就位
 *   lib/client.editor.js CodeMirror chunk：注册形状 + react-free
 *   lib/client.list.js   TanStack chunk：注册形状 + react 保持外部
 *
 * 产物形状由 DSH 模块加载器的 on-demand chunk 通道决定（CLIENT_CHUNK 名字
 * 规则 + `__ModuleLoader__.load({ id, chunk, factory })` 注册），任何漂移都
 * 会在真机上以「编辑器/列表永远加载中」的形式爆炸，所以在这里钉死。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PACKAGE_NAME = 'dsh-plugin-agents-manager'
const CHUNK_NAME_RE = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

let main = ''
let editor = ''
let list = ''

beforeAll(() => {
  execFileSync('node', ['scripts/build-client.mjs'], { cwd: ROOT, stdio: 'pipe' })
  execFileSync('node', ['scripts/build-chunks.mjs'], { cwd: ROOT, stdio: 'pipe' })
  const read = (name: string): string => {
    const path = join(ROOT, 'lib', name)
    expect(existsSync(path), `lib/${name} 应由构建产生`).toBe(true)
    return readFileSync(path, 'utf8')
  }
  main = read('client.js')
  editor = read('client.editor.js')
  list = read('client.list.js')
})

describe('主 client bundle（轻壳）', () => {
  it('以模块加载器注册形状开场', () => {
    expect(main).toContain(`window.__ModuleLoader__.load({ id: "${PACKAGE_NAME}"`)
    expect(main).toContain('factory: (require) => {')
  })

  it('不含 CodeMirror / TanStack（Q4 裁决：主 bundle 零重依赖）', () => {
    expect(main).not.toContain('@codemirror')
    expect(main).not.toContain('@tanstack')
    expect(main).not.toContain('require("codemirror')
  })

  it('懒加载缝：chunk-loader 被替换为 require.async 转发', () => {
    expect(main).toContain("loadEditorChunk: () => localRequire.async('./client.editor.js')")
    expect(main).toContain("loadListChunk: () => localRequire.async('./client.list.js')")
    expect(main).toContain('localRequire.async = require.async')
  })
})

describe('编辑器 chunk（lib/client.editor.js）', () => {
  it('chunk 名字符合 CLIENT_CHUNK 规则且注册形状完整', () => {
    expect('client.editor.js').toMatch(CHUNK_NAME_RE)
    expect(editor).toContain(`window.__ModuleLoader__.load({`)
    expect(editor).toContain(`id: "${PACKAGE_NAME}"`)
    expect(editor).toContain('chunk: "client.editor.js"')
  })

  it('暴露 createDocumentEditor（chunk 契约的出口）', () => {
    expect(editor).toContain('createDocumentEditor')
  })

  it('react-free（编辑器面不经过平台 react）', () => {
    expect(editor).not.toContain('require("react")')
  })

  it('确实内联了 CodeMirror（懒加载的不是空壳）', () => {
    expect(editor).toContain('EditorView')
  })
})

describe('列表 chunk（lib/client.list.js）', () => {
  it('chunk 名字符合 CLIENT_CHUNK 规则且注册形状完整', () => {
    expect('client.list.js').toMatch(CHUNK_NAME_RE)
    expect(list).toContain(`window.__ModuleLoader__.load({`)
    expect(list).toContain(`id: "${PACKAGE_NAME}"`)
    expect(list).toContain('chunk: "client.list.js"')
  })

  it('暴露 AgentListView 且 react 保持平台外部依赖', () => {
    expect(list).toContain('AgentListView')
    expect(list).toContain('require("react")')
  })

  it('自包含冻结求值器（chunk 不回引主 bundle）', () => {
    expect(list).toContain('evaluateAgentQuery')
  })
})
