/**
 * PROTOTYPE — 单个 CodeMirror 组合文档编辑器。
 *
 * 实际定义文件里的 `{% include clip <name> %}` 模板行原样保留在文档中，
 * 并原地渲染成 clip header（整行样式 + 行内状态/文件/块操作）；
 * front-matter 在 `---` 上方渲染自己的 header。
 *
 * header 的 chrome（文件、状态、按钮、行范围）全部是 widget：不可编辑、
 * 不进入文本选区；而模板行本身仍是文档文本，跨切片选取复制时会照常被选中。
 * 块范围随 transaction 映射，因此折叠/换行/输入后仍能精确回写各自文件。
 *
 * 折叠完全交给 CodeMirror 的 gutter + replace decoration：
 * clip 模板行在 fold gutter 里有折叠按钮，折叠态由装饰器渲染占位符。
 */
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  Annotation,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import type { Range, TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter } from '@codemirror/view'
import type { BlockInfo, DecorationSet, ViewUpdate } from '@codemirror/view'
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
      // 整数行高让内容行与 gutter 单元严格对齐，区域横线不会在亚像素处断开。
      lineHeight: '21px',
    },
    // 横向 padding 放到 .cm-line 上，让首末横线能从 gutter 边缘一直画到内容右缘。
    '.cm-content': { padding: '10px 0 112px', caretColor: 'var(--dsh-accent)' },
    '.cm-line': { padding: '0 14px' },
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
  toggleFold: (id: string) => void
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
  /** 显式逐块折叠覆盖；缺省时 clip 块跟随 compact */
  folds: Record<string, boolean>
  decorations: DecorationSet
}

const externalSync = Annotation.define<boolean>()
const setCompact = StateEffect.define<boolean>()
const toggleFold = StateEffect.define<string>()
const syncMeta = StateEffect.define<Record<string, SavedMeta>>()
const resetBlocks = StateEffect.define<LiveBlock[]>()

const isClipFoldable = (block: LiveBlock) =>
  block.kind === 'clip' && !block.missing && block.headerTo !== undefined && block.to > block.from

const effectiveFold = (block: LiveBlock, compact: boolean, folds: Record<string, boolean>) =>
  isClipFoldable(block) && (folds[block.id] ?? compact)

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

/** 窄宽度下把保存/回退收进一个按钮，避免 header 行内空间被操作区吃光。 */
function compactMenu(meta: HeadMeta, actions: MutableRefObject<Actions>) {
  const menu = document.createElement('details')
  menu.className = 'cm-head-menu'

  const toggle = document.createElement('summary')
  toggle.className = 'cm-head-menu-toggle'
  toggle.textContent = '⋯'
  toggle.title = '块操作'
  toggle.setAttribute('aria-label', '块操作')
  toggle.addEventListener('mousedown', (e) => e.preventDefault())
  toggle.addEventListener('click', (e) => e.stopPropagation())

  const pop = document.createElement('div')
  pop.className = 'cm-head-menu-pop'
  const closeThen = (run: () => void) => {
    menu.open = false
    run()
  }
  pop.append(
    actionButton('保存', `只回写此块 → ${meta.file}`, !meta.dirty, () => closeThen(() => actions.current.save(meta.id))),
    actionButton('回退', '撤回此块的未保存改动', !meta.dirty, () => closeThen(() => actions.current.revert(meta.id))),
  )

  menu.append(toggle, pop)
  return menu
}

type ChromeDom = HTMLElement & { chromeObserver?: ResizeObserver }

/** clip header 的 chrome 是绝对定位的，需要把它的实际宽度写回行内预留列。 */
function trackChromeWidth(dom: HTMLElement) {
  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(() => {
    const line = dom.closest<HTMLElement>('.cm-line')
    if (!line) return
    line.style.setProperty('--cm-head-chrome-w', `${Math.ceil(dom.getBoundingClientRect().width)}px`)
  })
  observer.observe(dom)
  ;(dom as ChromeDom).chromeObserver = observer
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
    kind.className = `cm-head-badge kind-${meta.kind}`
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

  // 撑开剩余空间，让保存/回退固定在 header 最右侧。
  const fill = document.createElement('span')
  fill.className = 'cm-head-fill'
  container.append(fill)

  // 禁用按钮不占位：已保存时 chrome 只保留只读信息，宽度足够时也不会挤占模板行。
  if (!meta.readonly && !meta.missing && meta.dirty) {
    container.append(
      actionButton('保存', `只回写此块 → ${meta.file}`, false, () => actions.current.save(meta.id)),
      actionButton('回退', '撤回此块的未保存改动', false, () => actions.current.revert(meta.id)),
      compactMenu(meta, actions),
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
    trackChromeWidth(chrome)
    return chrome
  }

  destroy(dom: HTMLElement) {
    ;(dom as ChromeDom).chromeObserver?.disconnect()
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

class FoldPlaceholderWidget extends WidgetType {
  constructor(
    readonly blockId: string,
    readonly lines: number,
    readonly actions: MutableRefObject<Actions>,
  ) {
    super()
  }

  eq(other: WidgetType) {
    return (
      other instanceof FoldPlaceholderWidget &&
      other.blockId === this.blockId &&
      other.lines === this.lines &&
      other.actions === this.actions
    )
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-foldPlaceholder'
    span.textContent = `… ${this.lines} 行`
    span.title = '展开此块正文'
    span.contentEditable = 'false'
    span.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    span.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.actions.current.toggleFold(this.blockId)
    })
    return span
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
  folds: Record<string, boolean>,
  readonly: boolean,
  actions: MutableRefObject<Actions>,
): DecorationSet {
  const decorations: Range<Decoration>[] = []

  for (const block of blocks) {
    const text = state.sliceDoc(block.from, block.to)
    const dirty = text !== block.saved
    const folded = effectiveFold(block, compact, folds)
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
    const kindClass = `cm-region-kind-${block.kind}`

    if (block.kind === 'clip' && block.headerFrom !== undefined) {
      const line = state.doc.lineAt(block.headerFrom)
      const headClasses = ['cm-region-head', kindClass, 'cm-block-head-line']
      // 折叠或空块没有可见正文：header 同时承担末行底线。
      if (folded || (block.to <= block.from && !block.missing)) headClasses.push('cm-region-last')
      decorations.push(Decoration.line({ class: headClasses.join(' ') }).range(line.from))
      decorations.push(Decoration.widget({ widget: new KindBadgeWidget('clip'), side: -1 }).range(line.from))
      // side 1：chrome 属于行尾内容，折叠占位符从行尾替换时不会吞掉它。
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
    }

    // 正文只标注区域语义；视觉边界由 gutter 左栏和首末横线完成。
    // 不给内容行铺底色——CodeMirror 的选区层在内容层之后，行底色会盖住选区。
    if (
      (block.kind === 'clip' || block.kind === 'frontmatter') &&
      !block.missing &&
      block.to > block.from &&
      !folded
    ) {
      const firstLine = state.doc.lineAt(block.from).number
      const lastLine = state.doc.lineAt(block.to - 1).number
      for (let lineNo = firstLine; lineNo <= lastLine; lineNo += 1) {
        const classes = ['cm-region-body', kindClass]
        if (block.kind === 'frontmatter') classes.push('cm-fm-line')
        if (lineNo === lastLine) classes.push('cm-region-last')
        decorations.push(Decoration.line({ class: classes.join(' ') }).range(state.doc.line(lineNo).from))
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
    } else if (folded) {
      // 折叠从模板行行尾开始，连同换行一起替换，占位符留在 header 行上。
      decorations.push(
        Decoration.replace({
          widget: new FoldPlaceholderWidget(block.id, text.split('\n').length, actions),
        }).range(block.headerTo ?? block.from, block.to),
      )
    }
  }

  return Decoration.set(decorations, true)
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
      return {
        blocks,
        compact: initialCompact,
        folds: {},
        decorations: buildDecorations(state, blocks, initialCompact, {}, readonlyRef.current, actions),
      }
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
      let folds = value.folds
      let rebuild = false
      for (const effect of tr.effects) {
        if (effect.is(setCompact)) {
          compact = effect.value
          // 全局 compact 与逐块折叠分层：切换全局时清空覆盖。
          folds = {}
          rebuild = true
        } else if (effect.is(toggleFold)) {
          const block = blocks.find((b) => b.id === effect.value)
          if (block && isClipFoldable(block)) {
            folds = { ...folds, [block.id]: !(folds[block.id] ?? compact) }
            rebuild = true
          }
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
          const ids = new Set(blocks.map((block) => block.id))
          folds = Object.fromEntries(Object.entries(folds).filter(([id]) => ids.has(id)))
          rebuild = true
        }
      }

      if (!tr.docChanged && !rebuild) return value
      return {
        blocks,
        compact,
        folds,
        decorations: buildDecorations(tr.state, blocks, compact, folds, readonlyRef.current, actions),
      }
    },
  })
}

class ClipFoldMarker extends GutterMarker {
  constructor(readonly folded: boolean) {
    super()
  }

  eq(other: GutterMarker) {
    return other instanceof ClipFoldMarker && other.folded === this.folded
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-clip-fold-marker'
    span.textContent = this.folded ? '›' : '⌄'
    span.title = this.folded ? '展开此块' : '折叠此块'
    return span
  }
}

const openFoldMarker = new ClipFoldMarker(false)
const closedFoldMarker = new ClipFoldMarker(true)

/** 只带 class、不产生 DOM 的 gutter 标记：用于绘制区域左栏与首末横线。 */
class RegionRailMarker extends GutterMarker {
  elementClass: string

  constructor(readonly classes: string) {
    super()
    this.elementClass = classes
  }

  eq(other: GutterMarker) {
    return other instanceof RegionRailMarker && other.classes === this.classes
  }
}

/** 找出某一行属于哪个区域的哪一段：head / body / last。 */
function regionRailForLine(
  state: EditorState,
  blocks: LiveBlock[],
  compact: boolean,
  folds: Record<string, boolean>,
  line: BlockInfo,
): GutterMarker | null {
  const lineNo = state.doc.lineAt(line.from).number

  for (const block of blocks) {
    if (block.kind === 'prose') continue

    // front-matter 的 header 是块 widget；它的 gutter 顶栏由 widgetMarker 提供，
    // 文档行只负责左侧栏和末行底线。
    if (block.kind === 'frontmatter') {
      if (block.to <= block.from) continue
      const startLine = state.doc.lineAt(block.from).number
      const endLine = state.doc.lineAt(block.to - 1).number
      if (lineNo < startLine || lineNo > endLine) continue
      const classes = ['cm-region-rail', 'cm-region-rail-kind-frontmatter', 'cm-region-rail-body']
      if (lineNo === endLine) classes.push('cm-region-rail-last')
      return new RegionRailMarker(classes.join(' '))
    }

    const startPos = block.headerFrom ?? block.from
    const startLine = state.doc.lineAt(Math.min(startPos, state.doc.length)).number
    if (lineNo < startLine) continue

    const folded = effectiveFold(block, compact, folds)
    const endLine =
      folded || block.missing || block.to <= block.from
        ? startLine
        : state.doc.lineAt(block.to - 1).number
    if (lineNo > endLine) continue

    const classes = ['cm-region-rail', 'cm-region-rail-kind-clip']
    if (lineNo === startLine) classes.push('cm-region-rail-head')
    // 缺失切片的说明 widget 会作为区域末行，header 只保留顶线。
    if (!block.missing && lineNo === endLine) classes.push('cm-region-rail-last')
    if (lineNo !== startLine && lineNo !== endLine) classes.push('cm-region-rail-body')
    return new RegionRailMarker(classes.join(' '))
  }

  return null
}

const frontmatterHeadRail = new RegionRailMarker(
  'cm-region-rail cm-region-rail-kind-frontmatter cm-region-rail-head cm-region-rail-widget',
)
const missingTailRail = new RegionRailMarker(
  'cm-region-rail cm-region-rail-kind-clip cm-region-rail-last cm-region-rail-widget',
)

/** 切片级折叠按钮与区域左栏都放在 CodeMirror 的 gutter 里，而不是 header 内联。 */
function createFoldGutter(field: StateField<BlocksState>) {
  return gutter({
    class: 'cm-clipFoldGutter',
    markers(view) {
      const state = view.state.field(field)
      const builder = new RangeSetBuilder<GutterMarker>()
      for (const block of state.blocks) {
        if (!isClipFoldable(block) || block.headerFrom === undefined) continue
        const folded = effectiveFold(block, state.compact, state.folds)
        builder.add(block.headerFrom, block.headerFrom, folded ? closedFoldMarker : openFoldMarker)
      }
      return builder.finish()
    },
    lineMarker(view, line) {
      const state = view.state.field(field)
      return regionRailForLine(view.state, state.blocks, state.compact, state.folds, line)
    },
    widgetMarker(_view, widget) {
      if (widget instanceof FrontmatterHeaderWidget) return frontmatterHeadRail
      if (widget instanceof MissingNoteWidget) return missingTailRail
      return null
    },
    lineMarkerChange(update) {
      return update.startState.field(field, false) !== update.state.field(field, false)
    },
    initialSpacer: () => openFoldMarker,
    domEventHandlers: {
      click(view, line) {
        const state = view.state.field(field)
        const block = state.blocks.find(
          (b) => b.kind === 'clip' && b.headerFrom === line.from,
        )
        if (!block || !isClipFoldable(block)) return false
        view.dispatch({ effects: toggleFold.of(block.id) })
        return true
      },
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

  const actionsRef = useRef<Actions>({
    save: () => {},
    revert: () => {},
    toggleFold: () => {},
  })
  actionsRef.current = {
    save: props.onSaveBlock,
    revert: props.onRevertBlock,
    toggleFold: (id) => {
      viewRef.current?.dispatch({ effects: toggleFold.of(id) })
    },
  }

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
        createFoldGutter(field),
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

  // compact 是切片级折叠的批量开关：只折叠显示，不改文档与草稿。
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
