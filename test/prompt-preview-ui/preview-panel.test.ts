/**
 * 预览面板的可见行为锚点（票 85）：只断言 react-dom/server 的静态输出。
 *
 * 本仓没有 DOM 环境，静态渲染不跑 effect、不发请求，所以这里断言的是**首帧态**
 * 与「按给定状态渲染出来的东西」；状态转移本身在 preview-model.test.ts 里按纯函数测。
 */
import { readFileSync } from 'node:fs'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  PromptPreviewPanel,
} from '../../src/client/chunks/registry/prompt-preview.tsx'
import {
  INITIAL_PREVIEW_PANEL_STATE,
  PREVIEW_MTIME_NOTE,
  PREVIEW_SIDE_EFFECT_HEADLINE,
  PREVIEW_STATIC_NOTICE,
  PREVIEW_TIER_LABEL,
} from '../../src/client/chunks/registry/prompt-preview-model.ts'
import { PromptsPageView } from '../../src/client/chunks/registry/prompts.tsx'
import { INITIAL_PROMPTS_PAGE_STATE } from '../../src/client/chunks/registry/prompts.tsx'

import type {
  PromptPreviewPanelState,
  PreviewRequestState,
} from '../../src/client/chunks/registry/prompt-preview-model.ts'
import type { PromptPreviewView } from '../../src/dsh/client/chunk-contracts.ts'
import type { ControlSnapshot } from '../../src/control/index.ts'
import {
  chainExhaustedView,
  emptyStateView,
  emptyView,
  fullView,
  shadowedView,
  staticView,
} from './fixtures.ts'

const AGENTS = ['fast-agent', 'slow-agent']

function panelState(patch: Partial<PromptPreviewPanelState> = {}): PromptPreviewPanelState {
  return { ...INITIAL_PREVIEW_PANEL_STATE, agent: 'fast-agent', ...patch }
}

function readyState(view: PromptPreviewView): PromptPreviewPanelState {
  return panelState({ request: { status: 'ready', agent: 'fast-agent', view } })
}

function renderPanel(
  state: PromptPreviewPanelState,
  options: { readonly wired?: boolean; readonly agents?: readonly string[] } = {},
): string {
  return renderToStaticMarkup(h(PromptPreviewPanel, {
    state,
    agents: options.agents ?? AGENTS,
    wired: options.wired ?? true,
  }))
}

const EMPTY_SNAPSHOT: ControlSnapshot = {
  agents: [],
  models: [],
  aliases: [],
  registryLayers: [],
  agentDiagnostics: [],
  aliasDiagnostics: [],
  findings: [],
  assemblies: {},
  scope: { cwd: '/work', projectRoot: '/work' },
}

/** 一份带一个模型条目的快照：卡片网格会渲染（预览仍在网格之前）。 */
function snapshotWithModel(): ControlSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    models: [{
      modelName: 'fast',
      provider: 'acme',
      model: 'chat',
      available: true,
      source: 'project-dsh',
      path: '/work/.dsh/agents/registry.yaml',
    }],
  }
}

/** 取一段 HTML 里某个标记的开标签（判断属性用）。 */
function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<', at)
  return html.slice(start, html.indexOf('>', at) + 1)
}

describe('首帧与读面接入', () => {
  it('还没读取时先声明副作用，并说清「还没读取」', () => {
    const html = renderPanel(panelState())
    expect(html).toContain('data-preview-panel="1"')
    expect(html).toContain(PREVIEW_SIDE_EFFECT_HEADLINE)
    expect(html).toContain('还没读取预览')
    expect(html).toContain('读取预览')
    expect(html).toContain('文件 mtime')
    expect(html).toContain('不可用')
  })

  it('没有预览读面时按钮禁用并说明原因（不假装可用）', () => {
    const html = renderPanel(panelState(), { wired: false })
    expect(html).toContain('没有接入预览读面')
    expect(tagWith(html, 'data-preview-request="1"')).toContain('disabled')
    // 接入后同一状态下按钮可用（agent 已选、不在请求中）。
    expect(tagWith(renderPanel(panelState()), 'data-preview-request="1"')).not.toContain('disabled')
  })

  it('快照里没有 agent 时不给选择器，明说没有可预览的对象', () => {
    const html = renderPanel(panelState({ agent: null }), { agents: [] })
    expect(html).toContain('快照里没有 agent')
    expect(html).not.toContain('preview-agent')
    expect(tagWith(html, 'data-preview-request="1"')).toContain('disabled')
  })

  it('加载中：role=status 的文案 + 按钮变「读取中…」且禁用', () => {
    const loading: PreviewRequestState = { status: 'loading', agent: 'fast-agent' }
    const html = renderPanel(panelState({ request: loading }))
    expect(html).toContain('role="status"')
    expect(html).toContain('正在装配 fast-agent')
    expect(html).toContain('读取中…')
    expect(tagWith(html, 'data-preview-request="1"')).toContain('disabled')
  })

  it('读取失败：role=alert + 错误原文 + 重试', () => {
    const html = renderPanel(panelState({ request: { status: 'error', agent: 'fast-agent', message: 'boom' } }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('预览读取失败：boom')
    expect(html).toContain('重试')
  })
})

describe('7 条来源分组可折叠', () => {
  it('7 组都渲染，各带圈号标题、段数与注册者说明', () => {
    const html = renderPanel(readyState(fullView()))
    for (const source of [
      'harness-identity',
      'deployment-persona',
      'preset-persona',
      'atelier-section',
      'tool-guidance',
      'runtime-context',
      'tool-declaration',
    ]) {
      expect(html).toContain('data-preview-source="' + source + '"')
    }
    expect(html).toContain('① harness identity')
    expect(html).toContain('⑦ 工具声明')
    // 空组（preset-persona）保留并说明「本次没有贡献任何段」。
    expect(html).toContain('这一来源本次没有贡献任何段')
  })

  it('折叠一组：该组带 aria-expanded=false 且不渲染段体，其余组照常', () => {
    const html = renderPanel(panelState({
      request: { status: 'ready', agent: 'fast-agent', view: fullView() },
      collapsed: { 'tool-guidance': true },
    }))
    expect(html).toContain('data-preview-collapsed="1"')
    const toggle = tagWith(html, 'data-preview-toggle="tool-guidance"')
    expect(toggle).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-preview-segment="tools:sdk"')
    // 别的组仍然展开。
    expect(tagWith(html, 'data-preview-toggle="harness-identity"')).toContain('aria-expanded="true"')
    expect(html).toContain('data-preview-segment="harness:identity"')
  })

  it('段的二级键 = 宿主装配名（不显示规划名当名字）', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('data-preview-segment="atelier:model-sys"')
    expect(html).toContain('data-preview-segment="deployment:persona-prefix"')
  })
})

describe('段内块可展开', () => {
  it('多块的段渲染 details + summary，块名与块文本都在', () => {
    const html = renderPanel(readyState(fullView()))
    const seg = html.slice(html.indexOf('data-preview-segment="tools:sdk"'))
    const block = seg.slice(0, seg.indexOf('</article>'))
    expect(block).toContain('<details')
    expect(block).toContain('<summary')
    expect(block).toContain('段内块 2 个')
    expect(block).toContain('bash: run commands')
    expect(block).toContain('read: read files')
    expect(block).toContain('data-preview-parts="2"')
  })

  it('单块的段不展开，整段文本直接可见（内容不丢）', () => {
    const html = renderPanel(readyState(fullView()))
    const seg = html.slice(html.indexOf('data-preview-segment="harness:identity"'))
    const block = seg.slice(0, seg.indexOf('</article>'))
    expect(block).not.toContain('<details')
    expect(block).toContain('You are DSH.')
  })
})

describe('标注齐备', () => {
  it('waterfall 改写与层标注都在', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('已被 waterfall 改写')
    expect(html).toContain('来自 .dsh/agents/assembly.yml')
    expect(html).toContain('规划名 model-system')
  })

  it('遮蔽：opaque 显示「遮蔽关系不可见」，visible 给出被遮蔽者', () => {
    const html = renderPanel(readyState(fullView({ segments: shadowedView() })))
    expect(html).toContain('遮蔽关系不可见')
    expect(html).toContain('遮蔽了同名注册（preset scope）')
  })

  it('不可归因段单独一组，带警告标签', () => {
    const html = renderPanel(readyState(fullView({ segments: shadowedView() })))
    expect(html).toContain('data-preview-source="unattributed"')
    expect(html).toContain('未归因段')
    expect(html).toContain('不猜')
    expect(html).toContain('data-preview-segment="unknown:section"')
  })

  it('诊断信号逐条列出（alias-mismatch / missing-from-assembly）', () => {
    const html = renderPanel(readyState(fullView({ segments: shadowedView() })))
    expect(html).toContain('data-preview-diagnostics="1"')
    expect(html).toContain('alias-mismatch')
    expect(html).toContain('missing-from-assembly')
  })
})

describe('四档降级各有可见态', () => {
  it('① 完整：档位标签是「完整装配」，没有「非宿主装配结果」', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('data-preview-tier="full"')
    expect(html).toContain(PREVIEW_TIER_LABEL.full)
    expect(html).not.toContain(PREVIEW_STATIC_NOTICE)
    // 段组照常渲染。
    expect(html).toContain('data-preview-segment="harness:identity"')
  })

  it('② 链耗尽：档位、原因与候选报告都可见', () => {
    const html = renderPanel(readyState(chainExhaustedView()))
    expect(html).toContain('data-preview-tier="chain-exhausted"')
    expect(html).toContain(PREVIEW_TIER_LABEL['chain-exhausted'])
    expect(html).toContain('原因：chain exhausted')
    expect(html).toContain('data-preview-chain="1"')
    expect(html).toContain('候选 2 个')
    expect(html).toContain('available:false，解析时跳过')
  })

  it('③ 静态回退：标「非宿主装配结果」并逐项列 missing', () => {
    const html = renderPanel(readyState(staticView()))
    expect(html).toContain('data-preview-tier="static"')
    expect(html).toContain(PREVIEW_STATIC_NOTICE)
    expect(html).toContain('data-preview-missing="1"')
    expect(html).toContain('live-agent')
    expect(html).toContain('该 agent 当前没有活跃会话')
    expect(html).toContain('host-config')
  })

  it('④ 空态：档位、原因原文都在，没有段组', () => {
    const html = renderPanel(readyState(emptyStateView()))
    expect(html).toContain('data-preview-tier="empty"')
    expect(html).toContain(PREVIEW_TIER_LABEL.empty)
    expect(html).toContain('ENOENT registry.yaml')
    expect(html).not.toContain('data-preview-segment=')
  })

  it('②③④ 档不摆 7 个空来源组（装配没发生，摆空组会读成另一种事实）', () => {
    for (const view of [chainExhaustedView(), staticView(), emptyStateView()]) {
      const html = renderPanel(readyState(view))
      expect(html).not.toContain('data-preview-source="harness-identity"')
      expect(html).not.toContain('data-preview-toggle=')
    }
  })

  it('① 档即使 0 段也摆 7 组：「本次都没贡献」本身是要看的结论', () => {
    const html = renderPanel(readyState(fullView({ segments: emptyView() })))
    expect(html).toContain('data-preview-source="harness-identity"')
    expect(html).toContain('这一来源本次没有贡献任何段')
  })

  it('四档的档位标签两两不同（每一档都看得出是哪一档）', () => {
    const labels = new Set(Object.values(PREVIEW_TIER_LABEL))
    expect(labels.size).toBe(4)
  })
})

describe('新鲜度条与副作用提示', () => {
  it('顶部条给装配时刻、本次请求序号、agent、扫描起点与 mtime 不可用', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('data-preview-freshness="1"')
    expect(html).toContain('2026-11-26T05:00:00.000Z')
    expect(html).toContain('本次请求序号')
    expect(html).toContain('42')
    expect(html).toContain('fast-agent')
    expect(html).toContain('/work')
    expect(html).toContain('文件 mtime')
    expect(html).toContain(PREVIEW_MTIME_NOTE)
  })

  it('顶部条不把 scanId 说成「数据代次 / 加载代次」，且明写不自动重载', () => {
    const html = renderPanel(readyState(fullView()))
    const bar = html.slice(html.indexOf('data-preview-freshness="1"'))
    const block = bar.slice(0, bar.indexOf('preview-side-effect'))
    // 标签与值里绝不出现「代次」；只有 scanId 的说明是否定式（「不是数据代次」）。
    const labels = [...block.matchAll(/preview-freshness-label">([^<]*)</g)].map((m) => m[1] ?? '')
    const values = [...block.matchAll(/preview-freshness-value">([^<]*)</g)].map((m) => m[1] ?? '')
    for (const text of [...labels, ...values]) expect(text).not.toContain('代次')
    expect(block).not.toContain('加载代次')
    expect(block).toContain('不是数据代次')
    expect(block).toContain('不做')
    expect(block).toContain('不会自动重载')
  })

  it('副作用：常驻标题 + 读面声明的逐条说法（原样，不改写）', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('data-preview-side-effect="1"')
    expect(html).toContain(PREVIEW_SIDE_EFFECT_HEADLINE)
    expect(html).toContain('本接口会真实执行 system-prompt/assemble waterfall 的每个 handler。')
  })

  it('读面的其余事实（notes）逐条展示', () => {
    const html = renderPanel(readyState(fullView()))
    expect(html).toContain('新鲜度：只带装配时刻与本次请求的 scanId。')
  })
})

describe('挂在系统提示词页（不新增页签）', () => {
  it('预览在 prompts 页内渲染，页根仍是 section.prompts-page', () => {
    const html = renderToStaticMarkup(h(PromptsPageView, {
      snapshot: snapshotWithModel(),
      state: INITIAL_PROMPTS_PAGE_STATE,
      preview: readyState(fullView()),
      previewAgents: AGENTS,
      previewWired: true,
    }))
    expect(html).toContain('data-registry-view="prompts"')
    expect(html).toContain('data-preview-panel="1"')
    // 预览是列表体（.prompts-body）的第一块：复用既有列表外壳，不新建平行视图框架。
    const bodyAt = html.indexOf('class="list-pane-body"')
    expect(bodyAt).toBeGreaterThan(-1)
    expect(html.indexOf('data-preview-panel')).toBeGreaterThan(bodyAt)
    // 预览在模型卡片网格之前（页内最上方）。
    expect(html.indexOf('data-preview-panel')).toBeLessThan(html.indexOf('prompts-grid'))
  })

  it('空模型条目时预览照常可见（预览读的是 agent，不是模型条目）', () => {
    const html = renderToStaticMarkup(h(PromptsPageView, {
      snapshot: EMPTY_SNAPSHOT,
      state: INITIAL_PROMPTS_PAGE_STATE,
      preview: readyState(fullView()),
      previewAgents: AGENTS,
      previewWired: true,
    }))
    expect(html).toContain('还没有任何模型条目')
    expect(html).toContain('data-preview-panel="1"')
    expect(html).toContain('data-preview-segment="harness:identity"')
  })

  it('不传 preview 时页面结构与原来一致（预览是可选插槽）', () => {
    const html = renderToStaticMarkup(h(PromptsPageView, {
      snapshot: EMPTY_SNAPSHOT,
      state: INITIAL_PROMPTS_PAGE_STATE,
    }))
    expect(html).not.toContain('data-preview-panel')
    expect(html).toContain('还没有任何模型条目')
  })

  it('页签仍是 4 值封闭联合（预览不新增第五个页签）', () => {
    const types = readFileSync(new URL('../../src/client/ui-core/panel-types.ts', import.meta.url), 'utf8')
    expect(types).toContain("export type PanelTab = 'agents' | 'models' | 'prompts' | 'history'")
    const header = readFileSync(new URL('../../src/client/ui-react/panel-header.tsx', import.meta.url), 'utf8')
    // 头部仍只有四个页签项（硬编码 4 项）。
    expect((header.match(/id: '(agents|models|prompts|history)'/g) ?? []).length).toBe(4)
  })
})

describe('样式体系复用（不新建平行框架）', () => {
  const css = readFileSync(new URL('../../src/client/features/styles.css', import.meta.url), 'utf8')
  const PREVIEW_MARKER = '/* ── 系统提示词预览（票 85）'
  /** 预览样式块：从自己的小节标题到下一节标题（不含后续小节）。 */
  const previewCss = (() => {
    const start = css.indexOf(PREVIEW_MARKER)
    expect(start).toBeGreaterThan(-1)
    // 从小节注释**结束**处开始切（注释里提到 @container 是解释，不是规则）。
    const afterComment = css.indexOf('*/', start)
    expect(afterComment).toBeGreaterThan(start)
    const rest = css.slice(afterComment + 2)
    const nextSection = rest.indexOf('/* ── ')
    const block = nextSection === -1 ? rest : rest.slice(0, nextSection)
    return block.replace(/\/\*[\s\S]*?\*\//g, '')
  })()

  it('预览的每条规则都挂在 .agent-atelier-page 下', () => {
    expect(previewCss.length).toBeGreaterThan(0)
    const selectors = previewCss.match(/^\.agent-atelier-page[^{]*\{/gm) ?? []
    expect(selectors.length).toBeGreaterThan(20)
    // 该块内不存在裸选择器（不以 .agent-atelier-page 开头的顶层规则）。
    const bareTop = previewCss.split('\n').filter((line) => /^\.[a-z]/.test(line) && !line.startsWith('.agent-atelier-page'))
    expect(bareTop).toEqual([])
  })

  it('颜色只消费宿主 token（--dsw-* / --dsh-*），不写死颜色', () => {
    expect(previewCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(previewCss).not.toMatch(/rgb\(|hsl\(/)
    // 每个 var(--…) 都是宿主 token 族。
    for (const match of previewCss.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      expect(match[1]).toMatch(/^--(dsw|dsh)-/)
    }
  })

  it('响应式只走容器查询（预览块里没有 @media），断点复用既有那一个', () => {
    expect(previewCss).not.toContain('@media')
    expect(previewCss).not.toContain('@container')
    // 窄容器规则挂在既有 @container prompts 块里，断点常量仍是 prompt-model 的那个。
    expect(css).toContain('@container prompts (max-width: 42rem)')
    const narrow = css.slice(css.indexOf('@container prompts (max-width: 42rem)'))
    // 取整个 at 规则（按花括号配对），不是到第一个 } 就停。
    let depth = 0
    let end = 0
    for (let index = narrow.indexOf('{'); index < narrow.length; index += 1) {
      if (narrow[index] === '{') depth += 1
      else if (narrow[index] === '}') {
        depth -= 1
        if (depth === 0) { end = index; break }
      }
    }
    expect(end).toBeGreaterThan(0)
    const rule = narrow.slice(0, end)
    expect(rule).toContain('.prompts-grid')
    expect(rule).toContain('.preview-head')
    expect(rule).toContain('.preview-freshness-row')
  })

  it('复用既有 chunk 挂载方式：prompts 页由 RegistryMount 挂载，预览不是新 chunk', () => {
    const mount = readFileSync(new URL('../../src/client/ui-react/registry-mount.tsx', import.meta.url), 'utf8')
    expect(mount).toContain('onPreviewRequest: props.onPreviewRequest')
    const chunkIndex = readFileSync(new URL('../../src/client/chunks/registry/index.tsx', import.meta.url), 'utf8')
    // chunk 入口仍只有两个视图导出（预览不是第三个发布视图）。
    expect((chunkIndex.match(/^export \{/gm) ?? []).length).toBe(2)
  })

  it('chunk 不 import 装配层（import 矩阵围栏）：预览数据只经 chunk-contracts', () => {
    for (const file of ['prompt-preview.tsx', 'prompt-preview-model.ts', 'prompts.tsx']) {
      const source = readFileSync(new URL('../../src/client/chunks/registry/' + file, import.meta.url), 'utf8')
      // 只看 import / export-from 语句：注释里提到 src/assembly/ 是解释，不是依赖。
      const specifiers = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
      for (const specifier of specifiers) {
        expect(specifier, file + ' → ' + specifier).not.toContain('assembly')
      }
      // 也不自己跑投影（那段代码在装配层，chunk 拿不到也不该假装能跑）。
      expect(source, file).not.toContain('buildPromptSegments(')
    }
  })
})
