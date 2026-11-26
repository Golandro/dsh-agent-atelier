/**
 * 预览接缝的守卫（票 85）：数据怎么从宿主读面到 chunk。
 *
 * 三层事实一起钉：
 * 1. chunk 只经 `chunk-contracts` 看预览数据（import 矩阵的 `CHUNK_ENTRIES`）；
 * 2. 接缝是 type-only：运行期只有回调，没有投影函数、没有装配调用；
 * 3. 回调由主壳注入（chunk 拿不到 http-client），没有读面时如实返回 undefined。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { hasPromptPreview, previewHandlerOf } from '../../src/client/ui-core/preview-request.ts'
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

  it('chunk 入口按需请求一次：没有轮询 / 没有 effect 自动触发', () => {
    const prompts = sourceOf('src/client/chunks/registry/prompts.tsx')
    // 请求只由用户点击的 runPreview 发起。
    expect(prompts).toContain('const runPreview = useCallback(')
    expect(prompts).toContain('handler(agent, controller.signal)')
    // 不自动重载：没有 setInterval / 没有依赖 snapshot 的自动请求。
    expect(prompts).not.toContain('setInterval')
    expect(prompts).not.toContain('setTimeout(() => runPreview')
    // 预览请求不经写通道。
    expect(prompts.slice(prompts.indexOf('const runPreview'))).not.toContain('onRegistryWrite(')
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

  it('信封的每个字段类型都来自 contract 或原语，没有本地发明', () => {
    // 信封的定义在契约层（集成后已上移）；字段类型只准是原语或契约自己的 DTO。
    const contract = sourceOf('src/contract/prompt-preview-route.ts')
    const body = contract.slice(contract.indexOf('export interface PromptPreviewView'))
    const fields = body.slice(0, body.indexOf('\n}'))
    // 逐字段看类型标注：允许原语与已 re-export 的契约类型。
    const annotations = [...fields.matchAll(/readonly (\w+)\??: ([^\n]+)/g)].map((m) => [m[1], m[2] ?? ''])
    expect(annotations.length).toBeGreaterThanOrEqual(8)
    for (const [name, type] of annotations) {
      expect(type, String(name)).toMatch(/string|number|readonly|PromptSegmentsView|PromptPreviewDegradation|undefined/)
    }
  })

  it('接缝注释写明了交接方式（集成方改 re-export，不保留第二份定义）', () => {
    const seam = sourceOf('src/dsh/client/chunk-contracts.ts')
    expect(seam).toContain('type-only re-export')
    expect(seam).toContain('不保留第二份定义')
  })
})