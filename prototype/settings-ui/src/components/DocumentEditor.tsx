/**
 * PROTOTYPE — 单个 CodeMirror 组合文档编辑器。
 *
 * 实际定义文件里的 `{% include clip <name> %}` 模板行原样保留在文档中，
 * 并原地渲染成 clip header（整行样式 + 行内状态/文件/块操作）；
 * front-matter 在 `---` 上方渲染自己的 header。
 *
 * header 的 chrome（文件、状态、按钮、行范围）全部是 widget：不可编辑、
 * 不进入文本选区；而模板行本身仍是文档文本，跨切片选取复制时会照常被选中。
 * 块范围随 transaction 映射，因此缩放/换行/输入后仍能精确回写各自文件。
 */
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Annotation,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import type { Range, TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { AgentSource, BlockRange, ComposedDocument, DocBlock, DocBlockKind } from '../types'
import { layerLabel, layoutBlocks } from '../model'

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--dsh-ink)',
      fontSize: '13px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--dsh-mono)',
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '10px 14px 112px', caretColor: 'var(--dsh-accent)' },
    '.cm-line': { padding: '0 6px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--dsh-ink-faint)',
      border: 'none',
      borderRight: '1px solid var(--dsh-border)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsh-accent) 7%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsh-accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--dsh-accent) 24%, transparent)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--dsh-accent)' },
  },
  { dark: true },
)

type Actions = {
  save: (id: string) => void
  revert: (id: string) => void
}

interface LiveBlock {
  id: string
  kind: DocBlockKind
  file: string
  source?: AgentSource
  clipName?: string
  missing?: boolean
  from: number
  to: number
  headerFrom?: number
  headerTo?: number
  /** 上次保存的块文本（模拟磁盘）；用于块头状态 */
  saved: string
}

interface SavedMeta {
  saved: string
  file: string
  source?: AgentSource
  clipName?: string
  missing?: boolean
}

interface BlocksState {
  blocks: LiveBlock[]
  compact: boolean
  decorations: DecorationSet
  atomic: RangeSet<Decoration>
}

const externalSync = Annotation.define<boolean>()
const setCompact = StateEffect.define<boolean>()
const syncMeta = StateEffect.define<Record<string, SavedMeta>>()
const resetBlocks = StateEffect.define<LiveBlock[]>()

function makeLiveBlocks(blocks: DocBlock[], ranges: Record<string, BlockRange>): LiveBlock[] {
  return blocks.map((block) => {
    const range = ranges[block.id] ?? { from: 0, to: 0 }
    return {
      id: block.id,
      kind: block.kind,
      file: block.file,
      source: block.source,
      clipName: block.clipName,
      missing: block.missing,
      from: range.from,
      to: range.to,
      headerFrom: range.headerFrom,
      headerTo: range.headerTo,
      saved: block.text,
    }
  })
}

interface HeadMeta {
  id: string
  kind: DocBlockKind
  file: string
  source?: AgentSource
  dirty: boolean
  missing: boolean
  range: string
  readonly: boolean
}

const sameHeadMeta = (a: HeadMeta, b: HeadMeta) =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.file === b.file &&
  a.source === b.source &&
  a.dirty === b.dirty &&
  a.missing === b.missing &&
  a.range === b.range &&
  a.readonly === b.readonly

const sourceTag = (source: AgentSource) =>
  source.startsWith('project') ? 'workspace' : source === 'bundled' ? 'bundled' : 'user'

function actionButton(label: string, title: string, disabled: boolean, onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn btn-sm cm-head-btn'
  button.textContent = label
  button.title = title
  button.disabled = disabled
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return button
}

function fillChrome(
  container: HTMLElement,
  meta: HeadMeta,
  actions: MutableRefObject<Actions>,
  withKind: boolean,
) {
  container.classList.add('cm-head-chrome')
  container.contentEditable = 'false'

  if (withKind) {
    const kind = document.createElement('span')
    kind.className = `cm-head-kind kind-${meta.kind}`
    kind.textContent = meta.kind === 'frontmatter' ? 'front-matter' : meta.kind
    container.append(kind)
  }
  if (meta.source) {
    const tag = document.createElement('span')
    tag.className = `tag cm-head-source tag-${sourceTag(meta.source)}`
    tag.textContent = layerLabel(meta.source)
    container.append(tag)
  }
  const file = document.createElement('span')
  file.className = 'cm-head-file'
  file.textContent = meta.file
  file.title = meta.file
  container.append(file)

  const state = document.createElement('span')
  state.className = `cm-head-state${meta.missing ? ' missing' : meta.dirty ? ' dirty' : ''}`
  state.textContent = meta.missing ? '引用缺失' : meta.dirty ? '未保存' : '已保存'
  container.append(state)

  const range = document.createElement('span')
  range.className = 'cm-head-range'
  range.textContent = meta.range
  range.title = '组合文档中的全局行范围'
  container.append(range)

  if (!meta.readonly && !meta.missing) {
    container.append(
      actionButton('保存', `只回写此块 → ${meta.file}`, !meta.dirty, () => actions.current.save(meta.id)),
      actionButton('回退', '撤回此块的未保存改动', !meta.dirty, () => actions.current.revert(meta.id)),
    )
  }
}

class KindBadgeWidget extends WidgetType {
  constructor(readonly kind: DocBlockKind) {
    super()
  }

  eq(other: WidgetType) {
    return other instanceof KindBadgeWidget && other.kind === this.kind
  }

  toDOM() {
    const badge = document.createElement('span')
    badge.className = `cm-head-badge kind-${this.kind}`
    badge.textContent = this.kind
    badge.contentEditable = 'false'
    return badge
  }
}

class HeaderChromeWidget extends WidgetType {
  constructor(
    readonly meta: HeadMeta,
    readonly actions: MutableRefObject<Actions>,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return (
      other instanceof HeaderChromeWidget &&
      this.actions === other.actions &&
      sameHeadMeta(this.meta, other.meta)
    )
  }

  toDOM() {
    const chrome = document.createElement('span')
    chrome.classList.add('cm-head-inline')
    fillChrome(chrome, this.meta, this.actions, false)
    return chrome
  }
}

class FrontmatterHeaderWidget extends WidgetType {
  constructor(
    readonly meta: HeadMeta,
    readonly actions: MutableRefObject<Actions>,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return (
      other instanceof FrontmatterHeaderWidget &&
      this.actions === other.actions &&
      sameHeadMeta(this.meta, other.meta)
    )
  }

  toDOM() {
    const header = document.createElement('div')
    header.className = 'cm-fm-head'
    fillChrome(header, this.meta, this.actions, true)
    return header
  }

  get estimatedHeight() {
    return 31
  }
}

class CollapsedWidget extends WidgetType {
  constructor(
    readonly lines: number,
    readonly dirty: boolean,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return other instanceof CollapsedWidget && other.lines === this.lines && other.dirty === this.dirty
  }

  toDOM() {
    const note = document.createElement('div')
    note.className = 'cm-collapsed'
    note.contentEditable = 'false'
    const label = document.createElement('span')
    label.textContent = this.dirty ? '草稿已修改' : '内容已折叠'
    const count = document.createTextNode(` · ${this.lines} 行 `)
    const hint = document.createElement('span')
    hint.className = 'dim'
    hint.textContent = '（compact；保存/回退仍按整块生效）'
    note.append(label, count, hint)
    return note
  }
}

class MissingNoteWidget extends WidgetType {
  constructor(readonly clipName: string) {
    super()
  }

  eq(other: WidgetType) {
    return other instanceof MissingNoteWidget && other.clipName === this.clipName
  }

  toDOM() {
    const note = document.createElement('div')
    note.className = 'cm-missing-note'
    note.contentEditable = 'false'
    note.append(`引用的切片文件不存在：`)
    const code = document.createElement('code')
    code.textContent = `{% include clip ${this.clipName} %}`
    note.append(code, `。在正文删除该模板行，或创建同名切片。`)
    return note
  }
}

function buildDecorations(
  state: EditorState,
  blocks: LiveBlock[],
  compact: boolean,
  readonly: boolean,
  actions: MutableRefObject<Actions>,
): { decorations: DecorationSet; atomic: RangeSet<Decoration> } {
  const decorations: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []

  for (const block of blocks) {
    const text = state.sliceDoc(block.from, block.to)
    const dirty = text !== block.saved
    const headPos = block.headerFrom ?? block.from
    const startLine = state.doc.lineAt(headPos).number
    const endLine = block.to > block.from ? state.doc.lineAt(block.to - 1).number : startLine
    const meta: HeadMeta = {
      id: block.id,
      kind: block.kind,
      file: block.file,
      source: block.source,
      dirty,
      missing: block.missing ?? false,
      range: `L${startLine}–${Math.max(startLine, endLine)}`,
      readonly,
    }

    if (block.kind === 'clip' && block.headerFrom !== undefined) {
      const line = state.doc.lineAt(block.headerFrom)
      decorations.push(Decoration.line({ class: 'cm-block-head-line' }).range(line.from))
      decorations.push(Decoration.widget({ widget: new KindBadgeWidget('clip'), side: -1 }).range(line.from))
      decorations.push(Decoration.widget({ widget: new HeaderChromeWidget(meta, actions), side: 1 }).range(line.to))
    }

    if (block.kind === 'frontmatter') {
      decorations.push(
        Decoration.widget({
          widget: new FrontmatterHeaderWidget(meta, actions),
          side: -1,
          block: true,
        }).range(block.from),
      )
      const firstLine = state.doc.lineAt(block.from).number
      const lastLine = block.to > block.from ? state.doc.lineAt(block.to - 1).number : firstLine
      for (let lineNo = firstLine; lineNo <= lastLine; lineNo += 1) {
        decorations.push(Decoration.line({ class: 'cm-fm-line' }).range(state.doc.line(lineNo).from))
      }
    }

    if (block.missing) {
      decorations.push(
        Decoration.widget({
          widget: new MissingNoteWidget(block.clipName ?? ''),
          side: 1,
          block: true,
        }).range(block.from),
      )
    } else if (compact && block.kind === 'clip' && block.to > block.from) {
      const lineCount = text.split('\n').length
      const range = Decoration.replace({
        widget: new CollapsedWidget(lineCount, dirty),
        block: true,
      }).range(block.from, block.to)
      decorations.push(range)
      atomic.push(range)
    }
  }

  return { decorations: Decoration.set(decorations, true), atomic: RangeSet.of(atomic, true) }
}

function createBlockField(
  initialDoc: ComposedDocument,
  initialCompact: boolean,
  actions: MutableRefObject<Actions>,
  readonlyRef: MutableRefObject<boolean>,
) {
  return StateField.define<BlocksState>({
    create(state) {
      const blocks = makeLiveBlocks(initialDoc.blocks, initialDoc.ranges)
      const built = buildDecorations(state, blocks, initialCompact, readonlyRef.current, actions)
      return { blocks, compact: initialCompact, ...built }
    },

    update(value, tr) {
      let blocks = value.blocks
      if (tr.docChanged) {
        blocks = blocks.map((block) => ({
          ...block,
          from: tr.changes.mapPos(block.from, -1),
          to: tr.changes.mapPos(block.to, 1),
          headerFrom:
            block.headerFrom === undefined ? undefined : tr.changes.mapPos(block.headerFrom, -1),
          headerTo: block.headerTo === undefined ? undefined : tr.changes.mapPos(block.headerTo, 1),
        }))
      }

      let compact = value.compact
      let rebuild = false
      for (const effect of tr.effects) {
        if (effect.is(setCompact)) {
          compact = effect.value
          rebuild = true
        } else if (effect.is(syncMeta)) {
          const meta = effect.value
          blocks = blocks.map((block) => {
            const next = meta[block.id]
            return next
              ? {
                  ...block,
                  saved: next.saved,
                  file: next.file,
                  source: next.source,
                  clipName: next.clipName,
                  missing: next.missing,
                }
              : block
          })
          rebuild = true
        } else if (effect.is(resetBlocks)) {
          blocks = effect.value
          rebuild = true
        }
      }

      if (!tr.docChanged && !rebuild) return value
      const built = buildDecorations(tr.state, blocks, compact, readonlyRef.current, actions)
      return { blocks, compact, ...built }
    },
  })
}

function createEmitPlugin(
  field: StateField<BlocksState>,
  onDrafts: MutableRefObject<(texts: Record<string, string>) => void>,
) {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return
        if (update.transactions.some((tr) => tr.annotation(externalSync))) return
        const blocks = update.state.field(field).blocks
        const texts: Record<string, string> = {}
        for (const block of blocks) texts[block.id] = update.state.sliceDoc(block.from, block.to)
        onDrafts.current(texts)
      }
    },
  )
}

/** 模板行是结构行：禁止任何修改；外部同步事务带 annotation 放行。 */
function createStructureFilter(field: StateField<BlocksState>) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(externalSync)) return tr
    const blocks = tr.startState.field(field, false)?.blocks ?? []
    let blocked = false

    tr.changes.iterChangedRanges((fromA, toA) => {
      if (blocked) return
      for (const block of blocks) {
        if (block.headerFrom === undefined || block.headerTo === undefined) continue
        const from = block.headerFrom
        // 连同行尾换行一起保护，避免模板行与相邻内容粘连
        const to = Math.min(tr.startState.doc.length, block.headerTo + 1)
        if (fromA === toA) {
          if (fromA >= from && fromA < to) blocked = true
        } else if (fromA < to && toA > from) {
          blocked = true
        }
      }
    })

    return blocked ? [] : tr
  })
}

export interface DocumentEditorProps {
  doc: ComposedDocument
  drafts: Record<string, string>
  compact: boolean
  readonly?: boolean
  onDrafts: (texts: Record<string, string>) => void
  onSaveBlock: (blockId: string) => void
  onRevertBlock: (blockId: string) => void
}

export function DocumentEditor(props: DocumentEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const actionsRef = useRef<Actions>({ save: () => {}, revert: () => {} })
  actionsRef.current = { save: props.onSaveBlock, revert: props.onRevertBlock }

  const onDraftsRef = useRef(props.onDrafts)
  onDraftsRef.current = props.onDrafts

  const readonly = props.readonly ?? false
  const readonlyRef = useRef(readonly)
  readonlyRef.current = readonly

  const initialDocRef = useRef(props.doc)
  const fieldRef = useRef<StateField<BlocksState> | null>(null)
  if (!fieldRef.current) {
    fieldRef.current = createBlockField(initialDocRef.current, props.compact, actionsRef, readonlyRef)
  }
  const field = fieldRef.current

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: initialDocRef.current.text,
      extensions: [
        basicSetup,
        oneDark,
        theme,
        markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!readonly),
        EditorState.readOnly.of(readonly),
        EditorView.contentAttributes.of({
          'aria-label': `${initialDocRef.current.agentName} 定义文件`,
          'aria-multiline': 'true',
        }),
        field,
        EditorView.decorations.from(field, (value) => value.decorations),
        EditorView.atomicRanges.of(
          (view) => view.state.field(field, false)?.atomic ?? RangeSet.empty,
        ),
        createStructureFilter(field),
        createEmitPlugin(field, onDraftsRef),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [field, readonly])

  // compact 只是显示层折叠：文档文本与草稿不变。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.field(field).compact === props.compact) return
    view.dispatch({ effects: setCompact.of(props.compact) })
  }, [field, props.compact])

  // 外部状态（保存 / 回退 / 外部手改 / 切片增删）与编辑器内部文本对齐。
  // 草稿优先：有草稿的块保留编辑器当前文本，其余块采用新的磁盘文本。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const state = view.state
    const live = state.field(field)

    const sameStructure =
      live.blocks.length === props.doc.blocks.length &&
      live.blocks.every((block, i) => {
        const next = props.doc.blocks[i]
        return next !== undefined && block.id === next.id && block.kind === next.kind
      })

    const meta: Record<string, SavedMeta> = {}
    for (const block of props.doc.blocks) {
      meta[block.id] = {
        saved: block.text,
        file: block.file,
        source: block.source,
        clipName: block.clipName,
        missing: block.missing,
      }
    }

    if (!sameStructure) {
      const texts: Record<string, string> = {}
      for (const block of props.doc.blocks) texts[block.id] = props.drafts[block.id] ?? block.text
      const layout = layoutBlocks(props.doc.blocks, texts)
      const next = makeLiveBlocks(props.doc.blocks, layout.ranges)
      const spec: TransactionSpec = {
        effects: resetBlocks.of(next),
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      }
      if (state.doc.toString() !== layout.text) {
        spec.changes = { from: 0, to: state.doc.length, insert: layout.text }
      }
      view.dispatch(spec)
      return
    }

    const changes: { from: number; to: number; insert: string }[] = []
    for (const block of live.blocks) {
      const saved = meta[block.id]?.saved ?? block.saved
      const desired = props.drafts[block.id] ?? saved
      if (state.sliceDoc(block.from, block.to) !== desired) {
        changes.push({ from: block.from, to: block.to, insert: desired })
      }
    }

    const metaChanged = live.blocks.some((block) => {
      const next = meta[block.id]
      return (
        next === undefined ||
        next.saved !== block.saved ||
        next.file !== block.file ||
        next.source !== block.source ||
        next.clipName !== block.clipName ||
        next.missing !== block.missing
      )
    })

    if (changes.length === 0 && !metaChanged) return

    const spec: TransactionSpec = {
      annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
    }
    if (changes.length > 0) spec.changes = changes
    if (metaChanged) spec.effects = syncMeta.of(meta)
    view.dispatch(spec)
  }, [field, props.doc, props.drafts])

  return <div ref={hostRef} className={`doc-editor${readonly ? ' readonly' : ''}`} />
}
