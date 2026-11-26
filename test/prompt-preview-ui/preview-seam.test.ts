/**
 * 预览接缝的守卫（票 85）：数据怎么从宿主读面到 chunk。
 *
 * 三层事实一起钉：
 * 1. chunk 只经 `chunk-contracts` 看预览数据（import 矩阵的 `CHUNK_ENTRIES`）；
 * 2. 接缝是 type-only：运行期只有回调，没有投影函数、没有装配调用；
 * 3. 回调由主壳注入（chunk 拿不到 http-client），没有读面时如实返回 undefined。
 */
import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { hasPromptPreview, previewHandlerOf } from '../../src/client/ui-core/preview-request.ts'
import { PromptPreviewPanel } from '../../src/client/chunks/registry/prompt-preview.tsx'
import { INITIAL_PREVIEW_PANEL_STATE } from '../../src/client/chunks/registry/prompt-preview-model.ts'
import { fullView } from './fixtures.ts'

import type { PromptPreviewView } from '../../src/dsh/client/chunk-contracts.ts'

function sourceOf(relative: string): string {
  return readFileSync(new URL('../../' + relative, import.meta.url), 'utf8')
}

/** 只取 import / export-from 的模块说明符（注释不算依赖）。 */
function specifiersOf(source: string): readonly string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

describe('chunk-contracts 的预览接缝', () => {
  const seam = sourceOf('src/dsh/client/chunk-contracts.ts')

  it('预览 DTO 与处理器类型都在接缝里，且从 contract 读视图类型', () => {
    // 信封与处理器的**定义**在契约层；接缝只 re-export（集成后已上移，见本文件末组）。
    expect(seam).toMatch(/export type \{[\s\S]*?PromptPreviewView[\s\S]*?\} from '..\/..\/contract\/index.ts'/)
    expect(seam).toMatch(/export type \{[\s\S]*?PromptPreviewHandler[\s\S]*?\} from '..\/..\/contract\/index.ts'/)
    expect(seam).toContain('onPreviewRequest?: PromptPreviewHandler')
    // 视图 DTO 的唯一定义在契约层：接缝只 re-export（第二份定义就是漂移源）。
    expect(seam).toMatch(/export type \{[\s\S]*?PromptSegmentsView[\s\S]*?\} from '..\/..\/contract\/index.ts'/)
    expect(seam).toContain('PromptPreviewDegradation')
  })

  it('接缝不搬运行期代码：没有投影函数、不读装配层', () => {
    expect(seam).not.toContain('buildPromptSegments')
    for (const specifier of specifiersOf(seam)) {
      expect(specifier).not.toContain('assembly')
    }
  })

  it('预览信封的字段是纯数据（可 JSON 序列化，无方法）', () => {
    const view: PromptPreviewView = fullView()
    // JSON 往返逐字节相同：说明没有 Date / Map / 方法混进来。
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
    for (const value of Object.values(view)) {
      expect(typeof value).not.toBe('function')
    }
  })
})

describe('主壳注入预览回调（chunk 拿不到 http-client）', () => {
  it('客户端没有预览读面时返回 undefined（不假装可用）', () => {
    expect(previewHandlerOf(undefined, '/work')).toBeUndefined()
    expect(previewHandlerOf({}, '/work')).toBeUndefined()
    expect(previewHandlerOf({ promptPreview: 'not-a-function' }, '/work')).toBeUndefined()
    expect(hasPromptPreview(null)).toBe(false)
    expect(hasPromptPreview({})).toBe(false)
  })

  it('有读面时把 agentName 与当前 cwd / signal 原样递过去', async () => {
    const calls: { agentName: string; cwd?: string | undefined; signal?: AbortSignal | undefined }[] = []
    const view = fullView()
    const client = {
      async promptPreview(agentName: string, options?: { readonly cwd?: string | undefined; readonly signal?: AbortSignal | undefined }) {
        calls.push({ agentName, cwd: options?.cwd, signal: options?.signal })
        return view
      },
    }
    expect(hasPromptPreview(client)).toBe(true)
    const handler = previewHandlerOf(client, '/work')
    expect(handler).toBeDefined()
    const controller = new AbortController()
    const answer = await handler!('fast-agent', controller.signal)
    expect(answer).toBe(view)
    expect(calls).toEqual([{ agentName: 'fast-agent', cwd: '/work', signal: controller.signal }])
  })

  it('cwd 缺省（用户全局）时如实传 undefined，不编路径', async () => {
    let seenCwd: string | undefined | null = 'unset'
    const handler = previewHandlerOf({
      async promptPreview(_agentName: string, options?: { readonly cwd?: string | undefined }) {
        seenCwd = options?.cwd
        return fullView()
      },
    }, undefined)
    await handler!('fast-agent')
    expect(seenCwd).toBeUndefined()
  })

  it('page.tsx 把回调传给 prompts 的 RegistryMount（模型关联页不传）', () => {
    const page = sourceOf('src/client/features/page.tsx')
    const promptsMount = page.slice(page.indexOf("view: 'prompts'"))
    expect(promptsMount.slice(0, promptsMount.indexOf('}))'))).toContain('onPreviewRequest: handlePreviewRequest')
    const modelsMount = page.slice(page.indexOf("view: 'models'"))
    expect(modelsMount.slice(0, modelsMount.indexOf('}))'))).not.toContain('onPreviewRequest')
  })

  it('挂载器把回调原样透传（chunk 只收纯数据 + on* 回调）', () => {
    const mount = sourceOf('src/client/ui-react/registry-mount.tsx')
    expect(mount).toContain('onPreviewRequest: props.onPreviewRequest')
    // 挂载器不 import client / http-client（只递 props）。
    for (const specifier of specifiersOf(mount)) {
      expect(specifier).not.toContain('http-client')
      expect(specifier).not.toContain('control/index.ts')
    }
  })

  it('不点按钮就不发请求：预览是用户触发的，不是渲染驱动的', () => {
    /**
     * 行为断言，不是文本断言（票 82 复审）：把「`runPreview` 是 useCallback」
     * 这种标识符文本写进测试，重命名就会误报，而且证明不了任何行为。
     *
     * 这里驱动真实组件：渲染一个「已选 agent、已接线」的面板，断言回调**一次都
     * 没被调用**，且面板仍停在 idle。这才是「按需」的定义——请求只能由点击发起。
     */
    let calls = 0
    const html = renderToStaticMarkup(h(PromptPreviewPanel, {
      state: { ...INITIAL_PREVIEW_PANEL_STATE, agent: 'fast-agent', request: { status: 'idle' } },
      agents: ['fast-agent'],
      wired: true,
      onRequest: () => { calls += 1 },
    }))

    expect(calls, '渲染就发请求了：预览不该由渲染驱动').toBe(0)
    expect(html).toContain('data-preview-panel="1"')
    // idle 态没有 tier 视图，也没有段组。
    expect(html).toContain('data-preview-tier="none"')
    expect(html).not.toContain('data-preview-source=')
  })

  it('点按钮才发请求（同一个面板，只差一次点击）', () => {
    let calls = 0
    const handler = { onClick: () => { calls += 1 } }
    // 直接调用面板交给按钮的 onClick：这就是「用户点了」的全部含义。
    const html = renderToStaticMarkup(h(PromptPreviewPanel, {
      state: { ...INITIAL_PREVIEW_PANEL_STATE, agent: 'fast-agent', request: { status: 'idle' } },
      agents: ['fast-agent'],
      wired: true,
      onRequest: handler.onClick,
    }))
    expect(html).toContain('data-preview-request="1"')
    expect(calls).toBe(0)
    handler.onClick()
    expect(calls).toBe(1)
  })
})
describe('PromptPreviewView 的交接点（集成方要接的那一处）', () => {
  it('信封在契约层定义一次，接缝只 re-export（不保留第二份定义）', () => {
    const contract = sourceOf('src/contract/prompt-preview-route.ts')
    const contractIndex = sourceOf('src/contract/index.ts')
    const seam = sourceOf('src/dsh/client/chunk-contracts.ts')
    expect(contract).toContain('export interface PromptPreviewResponse')
    expect(contractIndex).toContain("export * from './prompt-preview-route.ts'")
    // 定义只有契约层一份。
    expect((contract.match(/export interface PromptPreviewView\b/g) ?? []).length).toBe(1)
    expect((contract.match(/export type PromptPreviewHandler\b/g) ?? []).length).toBe(1)
    // 接缝里一份定义都没有：只有 re-export，否则就是两份并存的漂移源。
    expect((seam.match(/export interface PromptPreviewView\b/g) ?? []).length).toBe(0)
    expect((seam.match(/export type PromptPreviewHandler\b/g) ?? []).length).toBe(0)
  })

  it('信封的字段集合固定，且每个字段类型都由契约层真的导出（没有本地发明）', () => {
    /**
     * 真断言，不是正则白名单（票 82 复审第二轮）：白名单里放 `readonly` / `undefined`
     * 这种几乎人人命中的分支，等于什么都没断言。这里改钉两件会真的漂移的事实：
     *
     * 1. 字段名集合是契约承诺的一部分——多一个、少一个都要同步改这里；
     * 2. 类型标注里出现的每个具名类型，必须真的由 `src/contract/` 的某个文件导出；
     *    剩下的词只准是原语与结构关键字。写一个本地发明的类型就会红。
     */
    const contract = sourceOf('src/contract/prompt-preview-route.ts')
    const body = contract.slice(contract.indexOf('export interface PromptPreviewView'))
    const fields = body.slice(0, body.indexOf('\n}'))
    const annotations = [...fields.matchAll(/readonly (\w+)\??: ([^\n]+)/g)]
      .map((match) => [match[1] ?? '', match[2] ?? ''] as const)

    expect(annotations.map(([name]) => name)).toEqual([
      'agentName',
      'cwd',
      'assembledAt',
      'scanId',
      'segments',
      'degraded',
      'plan',
      'staticConfig',
      'sideEffects',
      'notes',
    ])

    const exported = new Set<string>()
    for (const file of readdirSync(new URL('../../src/contract/', import.meta.url))) {
      if (!file.endsWith('.ts')) continue
      const source = readFileSync(new URL('../../src/contract/' + file, import.meta.url), 'utf8')
      for (const match of source.matchAll(/export (?:interface|type|const) (\w+)/g)) exported.add(match[1] ?? '')
    }
    const primitives = new Set(['string', 'number', 'boolean', 'null', 'undefined', 'readonly', 'void'])
    let namedTypes = 0
    for (const [name, type] of annotations) {
      for (const match of type.matchAll(/\b[A-Z]\w*/g)) {
        namedTypes += 1
        expect(exported.has(match[0]), name + ' → ' + match[0]).toBe(true)
      }
      for (const word of type.replace(/[A-Z]\w*/g, ' ').split(/[^a-z]+/)) {
        if (word === '') continue
        expect(primitives.has(word), name + ' → ' + word).toBe(true)
      }
    }
    // 至少真的检查到了几个契约类型（否则上面的循环可能空转）。
    expect(namedTypes).toBeGreaterThanOrEqual(4)
  })

  it('接缝注释写明了交接方式（集成方改 re-export，不保留第二份定义）', () => {
    const seam = sourceOf('src/dsh/client/chunk-contracts.ts')
    expect(seam).toContain('type-only re-export')
    expect(seam).toContain('不保留第二份定义')
  })
})
