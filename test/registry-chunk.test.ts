/**
 * 票 59 / 63 registry chunk 的行为锚点（不依赖宿主 DOM）。
 *
 * 用 react-dom/server 渲染 chunk 视图：模型关联页（票 63）走列表外壳、纯数据
 * 计数与真实行；系统提示词页仍是票 68 的空壳。挂载器首帧是加载态（静态渲染
 * 不执行 effect，也不会真的请求 chunk）。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ModelRegistryView, PromptRegistryView } from '../client-registry/index.tsx'
import { RegistryMount } from '../src/dsh/client/registry-mount.tsx'

import type { AliasDefinition, ModelDefinition } from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

/** 一份最小的宿主快照：registry chunk 只读 models/aliases，其余字段按契约置空。 */
function snapshotWith(
  models: readonly ModelDefinition[],
  aliases: readonly AliasDefinition[] = [],
): ControlSnapshot {
  return {
    agents: [],
    models,
    aliases,
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

const SMART: AliasDefinition = {
  alias: 'smart',
  targets: ['fast'],
  source: 'project-dsh',
  path: '/work/.dsh/agents/registry.yaml',
}

const snapshot = snapshotWith([FAST], [SMART])

describe('registry chunk 视图', () => {
  it('模型关联视图：ListPane 外壳 + 可见/全部计数 + 行', () => {
    const html = renderToStaticMarkup(h(ModelRegistryView, { snapshot }))
    expect(html).toContain('data-registry-view="models"')
    expect(html).toContain('list-pane-title')
    expect(html).toContain('模型关联')
    expect(html).toContain('1/1')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('model-row')
    expect(html).toContain('smart')
  })

  it('系统提示词视图仍是空壳，计数同样来自 snapshot', () => {
    const html = renderToStaticMarkup(h(PromptRegistryView, { snapshot: snapshotWith([]) }))
    expect(html).toContain('data-registry-view="prompts"')
    expect(html).toContain('系统提示词')
    expect(html).toContain('0 条目')
    expect(html).not.toContain('model-row')
  })
})

describe('registry 挂载器', () => {
  it('首帧是加载态，带页名与加载中样式，不会白屏', () => {
    const html = renderToStaticMarkup(h(RegistryMount, { view: 'models', snapshot: snapshotWith([]) }))
    expect(html).toContain('list-chunk-status')
    expect(html).toContain('模型关联加载中…')
  })
})
