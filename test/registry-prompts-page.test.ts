/**
 * 票 68 系统提示词页的行为锚点：生效层卡片、草稿 / 脏标记 / 保存编辑（空串 =
 * 移除字段）/ 跨页定位与高亮。
 *
 * 本仓没有 DOM 环境：组件测试只断言 react-dom/server 的可见输出，状态机部分
 * 走 prompt-model 的纯函数；高亮的「消费后不清定时器」由源码级断言钉住（没有
 * 定时器就无法在无 DOM 环境里跑真实退场）。
 */
import { readFileSync } from 'node:fs'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  INITIAL_PROMPTS_PAGE_STATE,
  PromptsPageView,
} from '../src/client/chunks/registry/prompts.tsx'
import type { PromptsPageState } from '../src/client/chunks/registry/prompts.tsx'
import {
  PROMPTS_SINGLE_COLUMN_REM,
  buildPromptCards,
  canEditPrompt,
  dirtyPromptCount,
  isPromptDirty,
  promptFocusTarget,
  promptPathLabel,
  promptTextOf,
  promptsEmptyOf,
  setSysPromptEditOf,
} from '../src/client/chunks/registry/prompt-model.ts'

import type { AliasDefinition, ModelDefinition } from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

const PROJECT_PATH = '/work/.dsh/agents/registry.yaml'
const USER_PATH = '/home/me/.dsh/agents/registry.yaml'

function model(
  modelName: string,
  options: {
    readonly provider?: string | undefined
    readonly model?: string | undefined
    readonly source?: ModelDefinition['source'] | undefined
    readonly sysPrompt?: string | undefined
    readonly available?: boolean | undefined
    readonly synthesized?: boolean | undefined
  } = {},
): ModelDefinition {
  const source = options.source ?? 'project-dsh'
  const path = source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH
  return {
    modelName,
    provider: options.provider ?? 'acme',
    model: options.model ?? 'chat',
    available: options.available ?? true,
    source,
    ...(path === undefined ? {} : { path }),
    ...(options.sysPrompt === undefined ? {} : { sysPrompt: options.sysPrompt }),
    ...(options.synthesized === true ? { synthesized: true } : {}),
  }
}

function alias(name: string, targets: readonly string[], source: AliasDefinition['source'] = 'project-dsh'): AliasDefinition {
  const path = source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH
  return { alias: name, targets, source, ...(path === undefined ? {} : { path }) }
}

function snapshotOf(models: readonly ModelDefinition[], aliases: readonly AliasDefinition[] = []): ControlSnapshot {
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

/** 合并快照：fast 带提示词、slow 没有、dsh-default 是内置合成条目。 */
function snapshot(): ControlSnapshot {
  return snapshotOf(
    [
      model('slow', { model: 'slow' }),
      model('fast', { sysPrompt: 'Be terse.' }),
      model('dsh-default', { provider: 'deepseek', source: 'built-in', synthesized: true }),
    ],
    [alias('smart', ['fast']), alias('twin', ['fast']), alias('dsh-default', ['dsh-default'], 'built-in')],
  )
}

function state(patch: Partial<PromptsPageState> = {}): PromptsPageState {
  return { ...INITIAL_PROMPTS_PAGE_STATE, ...patch }
}

function render(snapshotValue: ControlSnapshot, pageState: PromptsPageState): string {
  return renderToStaticMarkup(h(PromptsPageView, {
    snapshot: snapshotValue,
    state: pageState,
    onDraft: () => {},
    onSave: () => {},
    onRevert: () => {},
  }))
}

/** 一张卡片的开始标签（从 data-prompt-card 往前找 <article）。 */
function articleTagOf(html: string, name: string): string {
  const at = html.indexOf('data-prompt-card="' + name + '"')
  if (at < 0) throw new Error('missing card markup: ' + name)
  const start = html.lastIndexOf('<article', at)
  return html.slice(start, html.indexOf('>', at))
}

/** 一个 textarea 的开始标签（属性顺序由 React 决定，只按元素边界切）。 */
function textareaTagOf(html: string, name: string): string {
  const at = html.indexOf('data-prompt-area="' + name + '"')
  if (at < 0) throw new Error('missing textarea markup: ' + name)
  const start = html.lastIndexOf('<textarea', at)
  return html.slice(start, html.indexOf('>', at))
}

function cardOf(name: string, snapshotValue: ControlSnapshot = snapshot()) {
  const card = buildPromptCards(snapshotValue).find((entry) => entry.name === name)
  if (card === undefined) throw new Error('missing card: ' + name)
  return card
}

describe('生效层卡片', () => {
  it('每个模型名一张卡，排序稳定（名称升序）', () => {
    const cards = buildPromptCards(snapshot())
    expect(cards.map((card) => card.name)).toEqual(['dsh-default', 'fast', 'slow'])
    // 同一份快照求值两次顺序一致（跨页跳转落点不漂）。
    expect(buildPromptCards(snapshot()).map((card) => card.name)).toEqual(cards.map((card) => card.name))
  })

  it('只读合并快照的生效层：来源、path、提示词与 available 都照抄', () => {
    const fast = cardOf('fast')
    expect(fast.source).toBe('project-dsh')
    expect(fast.path).toBe(PROJECT_PATH)
    expect(fast.route).toBe('acme/chat')
    expect(fast.prompt).toBe('Be terse.')
    expect(fast.available).toBe(true)
    expect(fast.readOnly).toBe(false)
    // 别名按名称排序，同一模型的两个别名都计入。
    expect(fast.aliases).toEqual(['smart', 'twin'])
  })

  it('内置 / 合成条目只读且没有文件', () => {
    const builtIn = cardOf('dsh-default')
    expect(builtIn.readOnly).toBe(true)
    expect(canEditPrompt(builtIn)).toBe(false)
    expect(promptPathLabel(builtIn)).toBe('（内置，无文件）')
    expect(builtIn.aliases).toEqual(['dsh-default'])
  })

  it('没有 sysPrompt 的条目读作空串（不是 undefined）', () => {
    expect(cardOf('slow').prompt).toBe('')
  })

  it('空快照走「没有任何模型条目」', () => {
    expect(promptsEmptyOf(snapshotOf([]))).toBe(true)
    expect(promptsEmptyOf(snapshot())).toBe(false)
  })
})

describe('草稿与脏标记', () => {
  const fast = cardOf('fast')

  it('草稿优先于已保存值', () => {
    expect(promptTextOf(fast, { fast: 'draft' })).toBe('draft')
    expect(promptTextOf(fast, {})).toBe('Be terse.')
  })

  it('与已保存值相同的草稿不算脏；不同的才算', () => {
    expect(isPromptDirty(fast, {})).toBe(false)
    expect(isPromptDirty(fast, { fast: 'Be terse.' })).toBe(false)
    expect(isPromptDirty(fast, { fast: 'Be terse' })).toBe(true)
    expect(dirtyPromptCount(buildPromptCards(snapshot()), { fast: 'x', slow: 'y' })).toBe(2)
  })

  it('回退即删键，文本回到已保存值', () => {
    const drafts: Record<string, string> = { fast: 'draft' }
    const next: Record<string, string> = { ...drafts }
    delete next.fast
    expect(promptTextOf(fast, next)).toBe('Be terse.')
    expect(isPromptDirty(fast, next)).toBe(false)
  })
})

describe('保存编辑（setSysPrompt）', () => {
  const fast = cardOf('fast')

  it('非空文本落成一笔 setSysPrompt', () => {
    expect(setSysPromptEditOf(fast, 'Be brief.')).toEqual({
      kind: 'setSysPrompt',
      modelName: 'fast',
      sysPrompt: 'Be brief.',
    })
  })

  it('空白文本 = 移除字段（undefined，不是空串）', () => {
    expect(setSysPromptEditOf(fast, '')).toEqual({ kind: 'setSysPrompt', modelName: 'fast', sysPrompt: undefined })
    expect(setSysPromptEditOf(fast, '   \n ')).toEqual({ kind: 'setSysPrompt', modelName: 'fast', sysPrompt: undefined })
  })

  it('只读条目没有编辑', () => {
    expect(setSysPromptEditOf(cardOf('dsh-default'), 'x')).toBeNull()
  })
})

describe('跨页定位与高亮', () => {
  it('模型目标在快照里才消费；别名 / 智能体目标与缺席条目都不消费', () => {
    expect(promptFocusTarget({ kind: 'model', name: 'fast' }, snapshot())).toBe('fast')
    expect(promptFocusTarget({ kind: 'model', name: 'ghost' }, snapshot())).toBeNull()
    expect(promptFocusTarget({ kind: 'alias', name: 'smart' }, snapshot())).toBeNull()
    expect(promptFocusTarget({ kind: 'agent', name: 'reviewer' }, snapshot())).toBeNull()
    expect(promptFocusTarget(null, snapshot())).toBeNull()
  })

  it('高亮卡片带 focus 类，其余不带', () => {
    const html = render(snapshot(), state({ highlighted: 'fast' }))
    expect(articleTagOf(html, 'fast')).toContain('prompt-card focus')
    const other = articleTagOf(html, 'slow')
    expect(other).toContain('prompt-card')
    expect(other).not.toContain('focus')
  })

  it('高亮退场定时器不挂在 effect cleanup 上（原型 SystemPrompts.tsx 的反例）', () => {
    const source = readFileSync(new URL('../src/client/chunks/registry/prompts.tsx', import.meta.url), 'utf8')
    // 只在卸载时清理：cleanup 的 effect 依赖为空数组。
    expect(source).toContain('useEffect(() => () => {')
    expect(source).toContain('}, [])')
    // 焦点 effect 的 return 里不得出现 clearTimeout（那会让高亮永不退场）。
    const focusEffect = source.slice(source.indexOf('promptFocusTarget(props.focus'))
    const body = focusEffect.slice(0, focusEffect.indexOf('}, [props.focus'))
    expect(body).not.toContain('return () =>')
    expect(body).toContain('setTimeout')
  })
})

describe('系统提示词页静态输出', () => {
  it('每张卡带名称、层、路线、提示词与别名计数，只读条目标注只读', () => {
    const html = render(snapshot(), state())
    expect(html).toContain('data-registry-view="prompts"')
    expect(html).toContain('3 条目')
    expect(html).toContain('data-prompt-card="fast"')
    expect(html).toContain('project · .dsh')
    expect(html).toContain('acme/chat')
    expect(html).toContain('Be terse.')
    expect(html).toContain('别名 ×2')
    expect(html).toContain('data-prompt-card="dsh-default"')
    expect(html).toContain('只读')
    expect(html).toContain('内置 / 合成条目只读')
    // 只读卡片的 textarea 可选中但不可编辑（readOnly，不是 disabled）。
    expect(textareaTagOf(html, 'dsh-default')).toContain('readOnly')
    expect(textareaTagOf(html, 'dsh-default')).not.toContain('disabled')
    expect(textareaTagOf(html, 'fast')).not.toContain('readOnly')
  })

  it('未保存计数进标题，脏卡片带「未保存」，保存可用 / 回退可用', () => {
    const html = render(snapshot(), state({ drafts: { fast: 'draft' } }))
    expect(html).toContain('1 未保存')
    const card = html.slice(html.indexOf('data-prompt-card="fast"'))
    expect(card.slice(0, card.indexOf('</article>'))).toContain('未保存')
    const save = card.slice(card.indexOf('data-prompt-save="fast"'))
    expect(save.slice(0, save.indexOf('>'))).not.toContain('disabled')
    const revert = card.slice(card.indexOf('data-prompt-revert="fast"'))
    expect(revert.slice(0, revert.indexOf('>'))).not.toContain('disabled')
  })

  it('没有写通道时全部只读，并给出一句说明', () => {
    const html = renderToStaticMarkup(h(PromptsPageView, { snapshot: snapshot(), state: state() }))
    expect(html).toContain('当前没有接入写通道，提示词只读。')
    const save = html.slice(html.indexOf('data-prompt-save="fast"'))
    expect(save.slice(0, save.indexOf('>'))).toContain('disabled')
  })

  it('空快照给出空态而不是空网格', () => {
    const html = render(snapshotOf([]), state())
    expect(html).toContain('还没有任何模型条目')
    expect(html).not.toContain('prompts-grid')
  })
})

describe('窄容器单栏', () => {
  it('CSS 的 @container prompts 断点与 prompt-model 的常量同源', () => {
    const css = readFileSync(new URL('../src/client/features/styles.css', import.meta.url), 'utf8')
    expect(css).toContain(`@container prompts (max-width: ${PROMPTS_SINGLE_COLUMN_REM}rem)`)
    const at = css.indexOf(`@container prompts (max-width: ${PROMPTS_SINGLE_COLUMN_REM}rem)`)
    expect(css.slice(at)).toMatch(/\.prompts-grid[^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  })
})
