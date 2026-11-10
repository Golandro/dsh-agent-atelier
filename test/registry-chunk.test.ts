/**
 * 票 59 registry chunk 空壳的行为锚点（不依赖宿主 DOM）。
 *
 * 用 react-dom/server 渲染 chunk 视图：两个视图共用 ListPane 外壳与主 bundle
 * 既有类名，只从纯数据 snapshot 取标题计数；页面内容由后续票接入。
 * 挂载器首帧是加载态（静态渲染不执行 effect，也不会真的请求 chunk）。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModelRegistryView, PromptRegistryView } from '../client-registry/index.tsx'
import { RegistryMount } from '../src/dsh/client/registry-mount.tsx'

import type { ModelDefinition } from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

/** 一份最小的宿主快照：registry chunk 只读 models 计数，其余字段按契约置空。 */
function snapshotWith(models: readonly ModelDefinition[]): ControlSnapshot {
  return {
    agents: [],
    models,
    aliases: [],
    registryLayers: [],
    agentDiagnostics: [],
    aliasDiagnostics: [],
    findings: [],
    assemblies: {},
    scope: { cwd: '/work', projectRoot: '/work' },
  }
}

const FAST: ModelDefinition = {
  modelName: 'fast',
  provider: 'acme',
  model: 'chat',
  available: true,
  source: 'project-dsh',
  path: '/work/.dsh/agents/registry.yaml',
}

describe('registry chunk 空壳', () => {
  const snapshot = snapshotWith([FAST])

  it('模型关联视图：ListPane 外壳 + 纯数据计数', () => {
    const html = renderToStaticMarkup(h(ModelRegistryView, { snapshot }))
    expect(html).toContain('data-registry-view="models"')
    expect(html).toContain('registry-pane')
    expect(html).toContain('list-pane-title')
    expect(html).toContain('模型关联')
    expect(html).toContain('1 条目')
  })

  it('系统提示词视图共用同一外壳，计数同样来自 snapshot', () => {
    const html = renderToStaticMarkup(h(PromptRegistryView, { snapshot: snapshotWith([]) }))
    expect(html).toContain('data-registry-view="prompts"')
    expect(html).toContain('系统提示词')
    expect(html).toContain('0 条目')
  })

  it('空壳不渲染行内容（页面内容留给后续票）', () => {
    const html = renderToStaticMarkup(h(ModelRegistryView, { snapshot }))
    expect(html).toContain('list-pane-body')
    expect(html).not.toContain('agent-row')
    expect(html).not.toContain('list-empty')
  })
})

describe('registry 挂载器', () => {
  it('首帧是加载态，带页名与加载中样式，不会白屏', () => {
    const html = renderToStaticMarkup(h(RegistryMount, { view: 'models', snapshot: snapshotWith([]) }))
    expect(html).toContain('list-chunk-status')
    expect(html).toContain('模型关联加载中…')
  })
})
