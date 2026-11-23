/**
 * 系统提示词页（票 68）：per-model sysPrompt 调优。
 *
 * 模型条目的身份、available 开关与别名映射统一归「模型关联」页；本页只负责
 * 提示词内容，所以每个模型名只出现一张卡片，且只展示**生效层**（工作区覆盖
 * 用户后的赢家）。被覆盖的低层声明在模型关联页的层空间查看。
 *
 * 两层结构：
 * - PromptsPageView 是受控视图（快照 + 草稿 + 写状态 + 高亮名），静态可测；
 * - PromptRegistryView 是 chunk 入口，持有草稿 / 写状态 / 高亮，消费跨页聚焦
 *   目标，并只经页面的单一写通道（票 62）落盘。
 *
 * 高亮不随焦点清空而退场：消费焦点会立刻把 `focus` 置空，若在 effect 的
 * cleanup 里清定时器，高亮就永远不会消失（原型 SystemPrompts.tsx 的反例）。
 * 定时器只在卸载时清理。
 */
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { RegistryViewProps } from '../../../dsh/client/chunk-contracts.ts'
import { errorMessage, isAbortError } from '../../../control/index.ts'
import type { ControlSnapshot, RegistryEdit } from '../../../control/index.ts'
import { ListPane } from './list-pane.tsx'
import { WriteFeedback } from './model-detail.tsx'
import { registryLayerLabel } from './registry-model.ts'
import { sourceTagClass } from './model-links.ts'
import {
  EMPTY_PROMPT_DRAFTS,
  PROMPT_HIGHLIGHT_MS,
  buildPromptCards,
  canEditPrompt,
  dirtyPromptCount,
  isPromptDirty,
  promptActionLabel,
  promptFocusTarget,
  promptPathLabel,
  promptTextOf,
  promptsEmptyOf,
  setSysPromptEditOf,
} from './prompt-model.ts'

import type { PromptCard, PromptDrafts } from './prompt-model.ts'
import type { ModelWriteUi } from './model-detail.ts'

export interface PromptsPageState {
  readonly drafts: PromptDrafts
  /** 跨页跳转落点（滚动 + 高亮）；null = 没有高亮。 */
  readonly highlighted: string | null
}

export const INITIAL_PROMPTS_PAGE_STATE: PromptsPageState = {
  drafts: EMPTY_PROMPT_DRAFTS,
  highlighted: null,
}

export interface PromptsPageViewProps {
  readonly snapshot: ControlSnapshot
  readonly state: PromptsPageState
  readonly write?: ModelWriteUi | undefined
  readonly writeBusy?: boolean | undefined
  /** 草稿变化；文本回到已保存值时调用方应删键。 */
  readonly onDraft?: ((name: string, text: string) => void) | undefined
  readonly onSave?: ((card: PromptCard) => void) | undefined
  readonly onRevert?: ((card: PromptCard) => void) | undefined
}

/** 受控视图：全部状态由外部传入，SSR / 组件测试按状态直接渲染。 */
export function PromptsPageView(props: PromptsPageViewProps): ReactNode {
  const cards = useMemo(() => buildPromptCards(props.snapshot), [props.snapshot])
  const dirty = dirtyPromptCount(cards, props.state.drafts)
  const bodyRef = useRef<HTMLElement | null>(null)

  // 高亮落点滚动到视口中央；找不到卡片（目标刚离开快照）就什么都不做。
  useLayoutEffect(() => {
    const name = props.state.highlighted
    if (name === null) return
    findCardElement(bodyRef.current, name)?.scrollIntoView({ block: 'center' })
  }, [props.state.highlighted, cards])

  return h(
    'section',
    { className: 'prompts-page', 'data-registry-view': 'prompts', 'aria-label': '系统提示词' },
    h(
      ListPane,
      {
        listRef: bodyRef,
        className: 'prompts-list',
        title: '系统提示词',
        count: dirty === 0 ? `${cards.length} 条目` : `${cards.length} 条目 · ${dirty} 未保存`,
        headAction: null,
        children: promptsBody(props, cards),
      },
    ),
  )
}

function promptsBody(props: PromptsPageViewProps, cards: readonly PromptCard[]): ReactNode {
  if (promptsEmptyOf(props.snapshot)) {
    return h(
      'div',
      { className: 'list-empty' },
      h('div', { className: 'model-empty-title' }, '还没有任何模型条目'),
      h('div', { className: 'dim' }, '模型条目来自 registry.yaml 的 models: 段；先在「模型关联」页新增条目，再回来调提示词。'),
    )
  }
  return h(
    'div',
    { className: 'prompts-grid' },
    cards.map((card) => h(PromptCardView, {
      key: card.name,
      card,
      draft: promptTextOf(card, props.state.drafts),
      dirty: isPromptDirty(card, props.state.drafts),
      highlighted: props.state.highlighted === card.name,
      write: props.write,
      writeBusy: props.writeBusy === true,
      onDraft: props.onDraft,
      onSave: props.onSave,
      onRevert: props.onRevert,
    })),
  )
}

interface PromptCardViewProps {
  readonly card: PromptCard
  readonly draft: string
  readonly dirty: boolean
  readonly highlighted: boolean
  readonly write?: ModelWriteUi | undefined
  readonly writeBusy: boolean
  readonly onDraft?: ((name: string, text: string) => void) | undefined
  readonly onSave?: ((card: PromptCard) => void) | undefined
  readonly onRevert?: ((card: PromptCard) => void) | undefined
}

function PromptCardView(props: PromptCardViewProps): ReactNode {
  const card = props.card
  const editable = canEditPrompt(card)
  // 只读条目、没有写通道、写通道在途：都不能保存。回退只清本地草稿，仍然可用。
  const canSave = editable && props.onSave !== undefined && !props.writeBusy && props.dirty
  return h(
    'article',
    {
      className: 'prompt-card' + (props.highlighted ? ' focus' : '') + (card.available ? '' : ' off'),
      'data-prompt-card': card.name,
      'aria-label': card.name + ' 的系统提示词',
    },
    h(
      'div',
      { className: 'prompt-card-head' },
      h('span', { className: 'prompt-card-name', title: card.name }, card.name),
      h('span', { className: 'tag ' + sourceTagClass(card.source) }, registryLayerLabel(card.source)),
      card.available ? null : h('span', { className: 'tag tag-warn' }, '停用 · 解析时跳过'),
      card.readOnly ? h('span', { className: 'tag tag-bundled' }, '只读') : null,
      h('span', { className: 'prompt-card-fill' }),
      props.dirty ? h('span', { className: 'tag tag-warn' }, '未保存') : null,
    ),
    h('div', { className: 'prompt-card-route' }, h('code', null, card.route)),
    // 只读条目用 readOnly 而不是 disabled：disabled 的 textarea 不能选中文本，
    // 而「看一眼 / 复制现成提示词」正是只读卡片唯一的用途。
    h('textarea', {
      className: 'input prompt-area',
      rows: 3,
      value: props.draft,
      readOnly: !editable || props.onDraft === undefined,
      placeholder: '（无 sysPrompt —— 未调优）',
      'aria-label': card.name + ' 的 sysPrompt',
      'data-prompt-area': card.name,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => props.onDraft?.(card.name, event.target.value),
    }),
    h(
      'div',
      { className: 'prompt-card-foot' },
      h(
        'span',
        { className: 'prompt-card-meta' },
        h('span', { className: 'dim prompt-card-path', title: promptPathLabel(card) }, promptPathLabel(card)),
        h('span', { className: 'dim' }, card.aliases.length === 0 ? '无别名指向' : '别名 ×' + String(card.aliases.length)),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          'data-prompt-revert': card.name,
          'aria-label': promptActionLabel('revert', card.name),
          disabled: !props.dirty || props.onRevert === undefined,
          onClick: () => props.onRevert?.(card),
        },
        '回退',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          'data-prompt-save': card.name,
          'aria-label': promptActionLabel('save', card.name),
          disabled: !canSave,
          onClick: () => props.onSave?.(card),
        },
        '保存',
      ),
    ),
    editable ? null : h('p', { className: 'dim prompt-card-note' }, '内置 / 合成条目只读：没有 registry 层文件可写。'),
    props.onSave === undefined
      ? h('p', { className: 'dim prompt-card-note' }, '当前没有接入写通道，提示词只读。')
      : null,
    props.write === undefined ? null : h(WriteFeedback, { write: props.write }),
  )
}

/** 按模型名找卡片根节点：属性值只含条目名，直接按 dataset 比对（不引 CSS.escape）。 */
function findCardElement(root: HTMLElement | null, name: string): HTMLElement | undefined {
  if (root === null) return undefined
  return Array.from(root.querySelectorAll<HTMLElement>('[data-prompt-card]'))
    .find((element) => element.dataset.promptCard === name)
}

/** chunk 入口：草稿、写状态与高亮都在这里。 */
export function PromptRegistryView(props: RegistryViewProps): ReactNode {
  const [state, setState] = useState<PromptsPageState>(INITIAL_PROMPTS_PAGE_STATE)
  const [write, setWrite] = useState<ModelWriteUi>({ status: 'idle' })
  const cards = useMemo(() => buildPromptCards(props.snapshot), [props.snapshot])

  // 高亮定时器：只在卸载时清理，绝不在「焦点被消费」引起的重跑里清（反例见文件头）。
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current)
  }, [])

  const changeDraft = (name: string, text: string): void => {
    const card = cards.find((entry) => entry.name === name)
    setState((previous) => {
      const next = { ...previous.drafts }
      // 回到已保存值即不算未保存改动（不打扰视图，只记账）。
      if (card !== undefined && text === card.prompt) delete next[name]
      else next[name] = text
      return { ...previous, drafts: next }
    })
  }

  const revertDraft = (card: PromptCard): void => {
    setState((previous) => {
      if (!(card.name in previous.drafts)) return previous
      const next = { ...previous.drafts }
      delete next[card.name]
      return { ...previous, drafts: next }
    })
  }

  const runWrite = (edits: readonly RegistryEdit[], label: string, afterOk?: () => void): void => {
    const handler = props.onRegistryWrite
    if (handler === undefined) return
    setWrite({ status: 'writing', label })
    handler(edits)
      .then((outcome) => {
        setWrite({ status: 'done', outcome })
        if (outcome.changedCount > 0) afterOk?.()
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          setWrite({ status: 'idle' })
          return
        }
        setWrite({ status: 'error', message: errorMessage(error) })
      })
  }

  const save = (card: PromptCard): void => {
    const text = promptTextOf(card, state.drafts)
    const edit = setSysPromptEditOf(card, text)
    if (edit === null) return
    runWrite([edit], '保存 ' + card.name + ' 的 sysPrompt', () => {
      // 写后回读会让新值进入快照；此刻清掉草稿，卡片直接显示已保存值。
      setState((previous) => {
        if (!(card.name in previous.drafts)) return previous
        const next = { ...previous.drafts }
        delete next[card.name]
        return { ...previous, drafts: next }
      })
    })
  }

  // 跨页聚焦：目标在快照里才消费（滚动 + 高亮 + 定时退场）；不在就等下一份快照。
  useEffect(() => {
    const name = promptFocusTarget(props.focus, props.snapshot)
    if (name === null) return
    setState((previous) => ({ ...previous, highlighted: name }))
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null
      setState((previous) => ({ ...previous, highlighted: null }))
    }, PROMPT_HIGHLIGHT_MS)
    props.onFocusConsumed?.()
  }, [props.focus, props.snapshot, props.onFocusConsumed])

  return h(PromptsPageView, {
    snapshot: props.snapshot,
    state,
    write,
    writeBusy: props.registryWriteBusy === true || write.status === 'writing',
    onDraft: props.onRegistryWrite === undefined ? undefined : changeDraft,
    onSave: props.onRegistryWrite === undefined ? undefined : save,
    onRevert: revertDraft,
  })
}
