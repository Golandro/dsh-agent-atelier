/**
 * 票 68 系统提示词页的行为锚点，含票 79 的修复回归：生效声明卡片、草稿按范围
 * 分桶、脏标记、保存编辑（空串 = 移除字段）、回读失败保留草稿、写反馈只出现一次、
 * 只读谓词与宿主同源、跨页定位与高亮。
 *
 * 本仓没有 DOM 环境：组件测试只断言 react-dom/server 的可见输出，状态机部分走
 * prompt-model 的纯函数；高亮的「消费后不清定时器」用 TS AST 钉住——源码字符串
 * 断言会匹配到任意空依赖 effect，AST 才真的定位到那一个 useEffect。
 */
import { readFileSync } from 'node:fs'

import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { isReadOnlyModelEntry } from '../src/control/index.ts'
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
  draftClearedBy,
  draftsAfterEdit,
  draftsAfterRevert,
  draftsAfterWrite,
  isPromptDirty,
  promptDraftKey,
  promptFocusTarget,
  promptPathLabel,
  promptScopeKeyOf,
  promptTextOf,
  promptsEmptyOf,
  setSysPromptEditOf,
} from '../src/client/chunks/registry/prompt-model.ts'

import type { AliasDefinition, ModelDefinition } from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'
import type { RegistryWriteOutcome } from '../src/dsh/client/chunk-contracts.ts'

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
    readonly path?: string | undefined
  } = {},
): ModelDefinition {
  const source = options.source ?? 'project-dsh'
  const path = 'path' in options
    ? options.path
    : source === 'built-in' ? undefined : source === 'project-dsh' ? PROJECT_PATH : USER_PATH
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

function snapshotOf(
  models: readonly ModelDefinition[],
  aliases: readonly AliasDefinition[] = [],
  projectRoot: string | null = '/work',
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
    scope: { cwd: projectRoot, projectRoot },
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

function render(
  snapshotValue: ControlSnapshot,
  pageState: PromptsPageState,
  write?: Parameters<typeof PromptsPageView>[0]['write'],
): string {
  return renderToStaticMarkup(h(PromptsPageView, {
    snapshot: snapshotValue,
    state: pageState,
    ...(write === undefined ? {} : { write }),
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

/** 草稿表：只写本卡那一个键，模拟「输入框里敲了字」。 */
function draftsOf(card: ReturnType<typeof cardOf>, text: string): Record<string, string> {
  return { [promptDraftKey(card)]: text }
}

function outcomeOf(patch: Partial<RegistryWriteOutcome> = {}): RegistryWriteOutcome {
  return { status: 'ok', rows: [], changedCount: 1, ...patch }
}

describe('生效声明卡片', () => {
  it('每个模型名一张卡，排序稳定（名称升序）', () => {
    const cards = buildPromptCards(snapshot())
    expect(cards.map((card) => card.name)).toEqual(['dsh-default', 'fast', 'slow'])
    // 同一份快照求值两次顺序一致（跨页跳转落点不漂）。
    expect(buildPromptCards(snapshot()).map((card) => card.name)).toEqual(cards.map((card) => card.name))
  })

  it('只读合并快照的生效声明：来源、path、提示词与 available 都照抄', () => {
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

describe('只读谓词与宿主同源（票 79 第 4 条）', () => {
  it('没有层文件的条目只读，即使来源不是 built-in', () => {
    // 宿主按 `source === built-in || path === undefined` 拒绝写入；旧 UI 只看
    // source/synthesized，会把这种条目当成可写并给出保存按钮。
    expect(isReadOnlyModelEntry({ source: 'project-dsh', path: undefined })).toBe(true)
    expect(isReadOnlyModelEntry({ source: 'user-dsh', path: undefined })).toBe(true)
    expect(isReadOnlyModelEntry({ source: 'built-in', path: PROJECT_PATH })).toBe(true)
    expect(isReadOnlyModelEntry({ source: 'project-dsh', path: PROJECT_PATH })).toBe(false)
  })

  it('卡片与宿主用同一个判定：无 path 的条目既标只读也不给编辑', () => {
    const noFile = buildPromptCards(snapshotOf([model('ghost', { path: undefined })]))[0]
    expect(noFile).toBeDefined()
    if (noFile === undefined) return
    expect(noFile.readOnly).toBe(true)
    expect(canEditPrompt(noFile)).toBe(false)
    expect(setSysPromptEditOf(noFile, 'x')).toBeNull()
  })

  it('path 文案没有不可达分支：有文件给路径，没文件给同一句内置文案', () => {
    expect(promptPathLabel(cardOf('fast'))).toBe(PROJECT_PATH)
    expect(promptPathLabel(cardOf('dsh-default'))).toBe('（内置，无文件）')
  })
})

describe('草稿与脏标记', () => {
  const fast = cardOf('fast')

  it('草稿优先于已保存值', () => {
    expect(promptTextOf(fast, draftsOf(fast, 'draft'))).toBe('draft')
    expect(promptTextOf(fast, {})).toBe('Be terse.')
  })

  it('与已保存值相同的草稿不算脏；不同的才算', () => {
    expect(isPromptDirty(fast, {})).toBe(false)
    expect(isPromptDirty(fast, draftsOf(fast, 'Be terse.'))).toBe(false)
    expect(isPromptDirty(fast, draftsOf(fast, 'Be terse'))).toBe(true)
    const cards = buildPromptCards(snapshot())
    const slow = cardOf('slow')
    expect(dirtyPromptCount(cards, { ...draftsOf(fast, 'x'), ...draftsOf(slow, 'y') })).toBe(2)
  })

  it('编辑回到已保存值即删键', () => {
    const edited = draftsAfterEdit(fast, draftsOf(fast, 'draft'), 'Be terse.')
    expect(Object.keys(edited)).toEqual([])
    expect(draftsAfterEdit(fast, {}, 'other')).toEqual(draftsOf(fast, 'other'))
  })

  it('回退即删键，文本回到已保存值；没有草稿时原样返回同一个对象', () => {
    const drafts = draftsOf(fast, 'draft')
    const next = draftsAfterRevert(fast, drafts)
    expect(promptTextOf(fast, next)).toBe('Be terse.')
    expect(isPromptDirty(fast, next)).toBe(false)
    expect(draftsAfterRevert(fast, next)).toBe(next)
    expect(drafts).toEqual(draftsOf(fast, 'draft'))
  })
})

describe('草稿按范围分桶（票 79 第 2 条）', () => {
  const here = cardOf('fast', snapshotOf([model('fast', { sysPrompt: 'Be terse.' })], [], '/work'))
  const elsewhere = cardOf('fast', snapshotOf([model('fast', { sysPrompt: 'Be terse.' })], [], '/other'))

  it('范围键取项目根，用户全局用空串', () => {
    expect(promptScopeKeyOf({ cwd: '/work', projectRoot: '/work' })).toBe('/work')
    expect(promptScopeKeyOf({ cwd: null, projectRoot: null })).toBe('')
  })

  it('同名模型在不同范围下是不同的草稿键', () => {
    expect(promptDraftKey(here)).not.toBe(promptDraftKey(elsewhere))
    // 切空间后旧草稿不再命中新快照：既不显示成未保存改动，也不会写进新空间的层。
    const stale = draftsOf(here, '旧空间里敲的字')
    expect(promptTextOf(elsewhere, stale)).toBe('Be terse.')
    expect(isPromptDirty(elsewhere, stale)).toBe(false)
    expect(dirtyPromptCount([elsewhere], stale)).toBe(0)
  })

  it('切回原空间仍能取回原草稿', () => {
    const drafts = draftsOf(here, 'draft')
    expect(promptTextOf(here, drafts)).toBe('draft')
    expect(isPromptDirty(here, drafts)).toBe(true)
  })

  it('键里带 NUL 分隔，范围与名字不会串（/a 的 b 与 /a-b 的 c 不撞）', () => {
    const left = cardOf('b', snapshotOf([model('b')], [], '/a'))
    const right = cardOf('c', snapshotOf([model('c')], [], '/a-b'))
    expect(promptDraftKey(left)).not.toBe(promptDraftKey(right))
    expect(promptDraftKey(left)).toBe('/a\u0000b')
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

describe('回读失败保留草稿（票 79 第 1 条）', () => {
  const fast = cardOf('fast')
  const drafts = draftsOf(fast, 'draft')

  it('写入落地但回读失败 ⇒ 不清草稿', () => {
    const outcome = outcomeOf({ reloadError: 'GET /agent-atelier/state 503' })
    expect(draftClearedBy(outcome)).toBe(false)
    expect(draftsAfterWrite(fast, drafts, outcome)).toBe(drafts)
  })

  it('回读成功 ⇒ 清草稿（新值已在快照里）', () => {
    const outcome = outcomeOf({ snapshot: snapshot() })
    expect(draftClearedBy(outcome)).toBe(true)
    expect(draftsAfterWrite(fast, drafts, outcome)).toEqual({})
  })

  it('一笔都没写成功 ⇒ 不清草稿', () => {
    expect(draftClearedBy(outcomeOf({ status: 'failed', changedCount: 0 }))).toBe(false)
    expect(draftClearedBy(outcomeOf({ status: 'busy', changedCount: 0 }))).toBe(false)
  })

  it('其他卡片的草稿不受本次写入影响', () => {
    const slow = cardOf('slow')
    const both = { ...drafts, ...draftsOf(slow, 'slow draft') }
    const next = draftsAfterWrite(fast, both, outcomeOf({ snapshot: snapshot() }))
    expect(next).toEqual(draftsOf(slow, 'slow draft'))
  })
})

describe('写反馈页面级一次（票 79 第 3 条）', () => {
  const failed = outcomeOf({
    status: 'failed',
    changedCount: 0,
    rows: [{ ok: false, editIndex: 0, file: undefined, code: 'read-only', message: 'nope' }],
  })

  it('三张卡片也只出一条 role=alert', () => {
    const html = render(snapshot(), state(), { status: 'done', outcome: failed })
    expect(html.match(/role="alert"/g)?.length).toBe(1)
    expect(html.match(/data-model-write="err"/g)?.length).toBe(1)
  })

  it('反馈在卡片网格之前，卡片内不再重复', () => {
    const html = render(snapshot(), state(), { status: 'done', outcome: failed })
    const feedback = html.indexOf('data-model-write=')
    const grid = html.indexOf('prompts-grid')
    expect(feedback).toBeGreaterThan(-1)
    expect(grid).toBeGreaterThan(feedback)
    for (const name of ['fast', 'slow', 'dsh-default']) {
      const card = html.slice(html.indexOf('data-prompt-card="' + name + '"'))
      expect(card.slice(0, card.indexOf('</article>'))).not.toContain('data-model-write=')
    }
  })

  it('没有写状态时不出反馈', () => {
    const html = render(snapshot(), state(), { status: 'idle' })
    expect(html).not.toContain('data-model-write=')
    expect(html).not.toContain('role="alert"')
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

  it('高亮退场定时器挂在空依赖 effect 上，焦点 effect 不返回清理函数', () => {
    const source = readFileSync(new URL('../src/client/chunks/registry/prompts.tsx', import.meta.url), 'utf8')
    const file = ts.createSourceFile('prompts.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const effects = useEffectCalls(file)
    expect(effects.length).toBeGreaterThan(0)

    // 只有卸载 effect 的依赖数组为空，且它的回调真的返回清理函数。
    const unmount = effects.filter((entry) => entry.deps === 0)
    expect(unmount.length).toBe(1)
    expect(unmount[0]?.returnsCleanup).toBe(true)
    expect(unmount[0]?.body).toContain('clearTimeout')

    // 焦点 effect 会重排定时器（重设前清旧的），但它绝不能返回清理函数：
    // 消费焦点会立刻把 focus 置空，cleanup 里清定时器等于高亮永不退场。
    const focus = effects.filter((entry) => entry.body.includes('promptFocusTarget'))
    expect(focus.length).toBe(1)
    expect(focus[0]?.body).toContain('setTimeout')
    expect(focus[0]?.returnsCleanup).toBe(false)
    expect(focus[0]?.deps).toBeGreaterThan(0)
  })
})

/**
 * 每个 `useEffect(...)` 调用：回调源码、依赖数组长度（-1 = 没有依赖数组）、
 * 回调里是否有「带值的 return」（= 返回清理函数）。按 AST 取，注释与相邻
 * effect 不会互相串味，空依赖的箭头函数也不会被误当成清理函数。
 */
interface EffectCall {
  readonly body: string
  readonly deps: number
  readonly returnsCleanup: boolean
}

function useEffectCalls(file: ts.SourceFile): readonly EffectCall[] {
  const found: EffectCall[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
      const [callback, deps] = node.arguments
      found.push({
        body: callback === undefined ? '' : callback.getText(file),
        deps: deps !== undefined && ts.isArrayLiteralExpression(deps) ? deps.elements.length : -1,
        returnsCleanup: callback !== undefined && returnsValue(callback),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/**
 * 回调是否返回清理函数：表达式体箭头（`() => () => …`）看返回值是不是函数，
 * 块体看有没有 `return <expr>`。只看回调自己的函数体——嵌套的箭头函数是
 * setTimeout 之类的回调，不算；`return` 空值也不算。
 */
function returnsValue(root: ts.Node): boolean {
  if (ts.isArrowFunction(root) && !ts.isBlock(root.body)) return ts.isFunctionLike(root.body)
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (node !== root && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

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
    const fast = cardOf('fast')
    const html = render(snapshot(), state({ drafts: draftsOf(fast, 'draft') }))
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

describe('写后清草稿的接线（票 79 第 1 条的结构侧）', () => {
  it('save 的写后回调经 draftsAfterWrite 落草稿，不自己判 changedCount', () => {
    // 判定本身在「回读失败保留草稿」一节按行为测；这里只钉「视图真的用了那个判定」——
    // 没有 DOM 环境驱动不了 click → promise → setState，结构断言是剩下的那一层。
    const source = readFileSync(new URL('../src/client/chunks/registry/prompts.tsx', import.meta.url), 'utf8')
    const save = source.slice(source.indexOf('const save = (card: PromptCard)'))
    const body = save.slice(0, save.indexOf('\n  }', save.indexOf('runWrite([')))
    expect(body).toContain('draftsAfterWrite(card, previous.drafts, outcome)')
    expect(body).not.toContain('changedCount')
  })
})

describe('文档与词表跟代码一致（票 79 第 6 / 7 条）', () => {
  it('registry chunk 两页共享私有件，README 不得声称两页各自封口', () => {
    const prompts = readFileSync(new URL('../src/client/chunks/registry/prompts.tsx', import.meta.url), 'utf8')
    // 事实：系统提示词页确实跨页引模型关联页的私有件（写反馈与来源词表）。
    expect(prompts).toContain("from './model-detail.tsx'")
    expect(prompts).toContain("from './model-links.ts'")
    const readme = readFileSync(new URL('../docs/client/README.md', import.meta.url), 'utf8')
    // chunk 级封口（不互相 import、不回流主壳）仍然成立，只否掉「页与页各自封口」。
    expect(readme).not.toContain('两个页各自封口')
    expect(readme).toContain('共用同一份 chunk 私有件')
  })

  it('「生效层」已退役，系统提示词页的代码与文档不再用它', () => {
    // GLOSSARY 的「来源」词条把 生效层 记为退役、改「生效声明 + 来源」；页面沿用
    // 旧词会让读者以为那是层轴上的第四种层。
    const files = [
      '../src/client/chunks/registry/prompts.tsx',
      '../src/client/chunks/registry/prompt-model.ts',
      '../src/client/chunks/registry/model-detail.tsx',
      '../docs/client/README.md',
    ]
    for (const file of files) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).not.toContain('生效层')
    }
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
