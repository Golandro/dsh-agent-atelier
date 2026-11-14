/**
 * 票 05 / 59 的懒加载构建链守卫：不跑 tsc（host 产物与本测试无关），直接重放
 * 两个构建脚本，然后断言四份浏览器产物的形状——
 *
 *   lib/client.js          轻壳：零 CodeMirror/TanStack，chunk 缝就位
 *   lib/client.editor.js   CodeMirror chunk：注册形状 + react-free
 *   lib/client.list.js     TanStack chunk：注册形状 + react 保持外部
 *   lib/client.registry.js registry 页 chunk：注册形状 + react 保持外部 + 不互引
 *
 * 产物形状由 DSH 模块加载器的 on-demand chunk 通道决定（CLIENT_CHUNK 名字
 * 规则 + `__ModuleLoader__.load({ id, chunk, factory })` 注册），任何漂移都
 * 会在真机上以「编辑器/列表永远加载中」的形式爆炸，所以在这里钉死。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PACKAGE_NAME = 'dsh-agent-atelier'
/** The loader's on-demand chunk name rule, applied to what the build actually emitted. */
const CHUNK_NAME_RE = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

let main = ''
let editor = ''
let list = ''
let registry = ''

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
  registry = read('client.registry.js')
})

describe('产物文件名', () => {
  it('每个 chunk 产物名都符合 CLIENT_CHUNK 规则', () => {
    // The rule used to be asserted against string literals written beside it,
    // which could never fail; here it judges the files the build just emitted.
    // `client.js` is the shell, not a chunk: the rule covers `client.<name>.js` only.
    const emitted = readdirSync(join(ROOT, 'lib')).filter((name) => name.startsWith('client.') && name.endsWith('.js') && name !== 'client.js')
    expect(emitted.length).toBeGreaterThan(0)
    for (const name of emitted) expect(name, name).toMatch(CHUNK_NAME_RE)
  })
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
    expect(main).toContain("loadRegistryChunk: () => localRequire.async('./client.registry.js')")
    expect(main).toContain('localRequire.async = require.async')
  })
})

describe('编辑器 chunk（lib/client.editor.js）', () => {
  it('以模块加载器注册形状开场，chunk 名写在注册里', () => {
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
  it('以模块加载器注册形状开场，chunk 名写在注册里', () => {
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

  it('不 import registry chunk（两个 chunk 互不依赖）', () => {
    expect(list).not.toContain('ModelRegistryView')
    expect(list).not.toContain('PromptRegistryView')
  })
})

describe('registry chunk（lib/client.registry.js）', () => {
  it('以模块加载器注册形状开场，chunk 名写在注册里', () => {
    expect(registry).toContain(`window.__ModuleLoader__.load({`)
    expect(registry).toContain(`id: "${PACKAGE_NAME}"`)
    expect(registry).toContain('chunk: "client.registry.js"')
  })

  it('暴露两个 registry 视图且 react 保持平台外部依赖', () => {
    expect(registry).toContain('ModelRegistryView')
    expect(registry).toContain('PromptRegistryView')
    expect(registry).toContain('require("react")')
  })

  it('空壳只挂类名：内联 ListPane 结构、不引 TanStack/CodeMirror', () => {
    expect(registry).toContain('list-pane')
    expect(registry).toContain('模型关联')
    expect(registry).toContain('系统提示词')
    expect(registry).not.toContain('@tanstack')
    expect(registry).not.toContain('@codemirror')
  })

  it('不 import list chunk（两个 chunk 互不依赖）', () => {
    expect(registry).not.toContain('AgentListView')
    expect(registry).not.toContain('evaluateAgentQuery')
  })

  it('注册的 factory 以 react 为唯一外部时能跑通并导出两个视图', () => {
    // 重放模块加载器的注册通道：factory 执行成功 = 真机 chunk 通道不会卡在
    // 「加载中」；唯一外部是平台 react，多要一个依赖就立刻失败。
    const registrations: { factory: (require: (spec: string) => unknown) => Record<string, unknown> }[] = []
    runInNewContext(registry, {
      window: { __ModuleLoader__: { load: (registration: never) => registrations.push(registration) } },
    })
    expect(registrations).toHaveLength(1)
    const exports = registrations[0]!.factory((specifier) => {
      if (specifier === 'react') return React
      throw new Error(`unexpected chunk external: ${specifier}`)
    })
    expect(typeof exports.ModelRegistryView).toBe('function')
    expect(typeof exports.PromptRegistryView).toBe('function')
  })
})
