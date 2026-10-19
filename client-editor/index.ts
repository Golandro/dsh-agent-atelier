/**
 * Editor chunk entry (ticket 05) — `lib/client.editor.js`.
 *
 * 组合 agent 文档的命令式 CodeMirror 编辑器，移植自原型 DocumentEditor 并按
 * 票面 v1 裁剪（无 clip 行、无折叠系统）：fence 布局围绕可编辑块展开且受结构
 * 保护，frontmatter 块头携带逐块保存/回退，用户编辑逐块发出草稿文本。
 * 按契约零 React（`src/dsh/client/chunk-contracts.ts`）；命令式 handle 让主
 * bundle 的 React 包装层持有生命周期。
 */
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { Annotation, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import type { Extension, Range, TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type {
  DocumentEditorHandle,
  DocumentEditorOptions,
  EditorFraming,
} from '../src/dsh/client/chunk-contracts.ts'
import { layoutDocument } from './layout.ts'
import type { EditorModel, FenceRange, LiveBlock } from './layout.ts'
import { createRegionGutter, FrontmatterHeaderWidget } from './chrome.ts'
import type { EditorHooks, HeadMeta } from './chrome.ts'

/* ── 主题（原型逐字段移植；--dsh-* 变量由主 bundle 注入的样式解析）── */

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

/* ── 状态模型 ──────────────────────────────────────────────────────── */

/** 外部同步事务的 annotation：放行结构过滤、跳过草稿发射、不入 undo 历史。 */
const externalSync = Annotation.define<boolean>()
/** 已存块文本变化（保存、回退、外部手改后对齐块头状态）：blockId → saved。 */
const syncMeta = StateEffect.define<Record<string, string>>()
/** 结构变化（framing 或块序列变了）：整篇按新布局重置。 */
const resetModel = StateEffect.define<{ blocks: readonly LiveBlock[]; fences: readonly FenceRange[] }>()

function buildDecorations(
  state: EditorState,
  blocks: readonly LiveBlock[],
  readonly: boolean,
  hooks: EditorHooks,
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  for (const block of blocks) {
    if (block.kind !== 'frontmatter') continue // prose 不标注（v1 无 clip 行）
    const text = state.sliceDoc(block.from, block.to)
    const dirty = text !== block.saved
    const startLine = state.doc.lineAt(block.from).number
    const endLine = block.to > block.from ? state.doc.lineAt(block.to - 1).number : startLine
    const meta: HeadMeta = {
      id: block.id,
      kind: block.kind,
      dirty,
      range: `L${startLine}–${Math.max(startLine, endLine)}`,
      readonly,
    }
    decorations.push(
      Decoration.widget({
        widget: new FrontmatterHeaderWidget(meta, hooks),
        side: -1,
        block: true,
      }).range(block.from),
    )

    // 正文行只标注区域语义；视觉边界由 gutter 左栏和首末横线完成。
    // 不给内容行铺底色——CodeMirror 的选区层在内容层之后，行底色会盖住选区。
    if (block.to > block.from) {
      const lastLine = state.doc.lineAt(block.to - 1).number
      for (let lineNo = startLine; lineNo <= lastLine; lineNo += 1) {
        const classes = ['cm-region-body', 'cm-region-kind-frontmatter', 'cm-fm-line']
        if (lineNo === lastLine) classes.push('cm-region-last')
        decorations.push(Decoration.line({ class: classes.join(' ') }).range(state.doc.line(lineNo).from))
      }
    }
  }
  return Decoration.set(decorations, true)
}

function createEditorField(
  initial: { blocks: readonly LiveBlock[]; fences: readonly FenceRange[] },
  readonly: boolean,
  hooks: EditorHooks,
): StateField<EditorModel> {
  return StateField.define<EditorModel>({
    create(state) {
      return {
        blocks: initial.blocks,
        fences: initial.fences,
        decorations: buildDecorations(state, initial.blocks, readonly, hooks),
      }
    },

    update(value, tr) {
      let blocks = value.blocks
      let fences = value.fences
      if (tr.docChanged) {
        // 块范围随事务映射，输入后仍能精确回写各自块（原型同款 bias）。
        blocks = blocks.map((block) => ({
          ...block,
          from: tr.changes.mapPos(block.from, -1),
          to: tr.changes.mapPos(block.to, 1),
        }))
        // fence 范围受结构过滤保护，不会被用户编辑直接触及；assoc -1 让
        // 紧贴 fence 末尾的插入（prose 行首输入）不会被并进 fence。
        fences = fences.map((fence) => ({
          from: tr.changes.mapPos(fence.from, -1),
          to: tr.changes.mapPos(fence.to, -1),
        }))
      }

      let rebuild = false
      for (const effect of tr.effects) {
        if (effect.is(syncMeta)) {
          const meta = effect.value
          blocks = blocks.map((block) => {
            const next = meta[block.id]
            return next === undefined ? block : { ...block, saved: next }
          })
          rebuild = true
        } else if (effect.is(resetModel)) {
          // reset 的位置按事务后的新文档坐标给出，直接覆盖映射结果。
          blocks = effect.value.blocks
          fences = effect.value.fences
          rebuild = true
        }
      }

      if (!tr.docChanged && !rebuild) return value
      return {
        blocks,
        fences,
        decorations: buildDecorations(tr.state, blocks, readonly, hooks),
      }
    },
  })
}

/** fence 行是结构行：禁止任何修改；外部同步事务带 annotation 放行。 */
function createStructureFilter(field: StateField<EditorModel>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(externalSync)) return tr
    const fences = tr.startState.field(field, false)?.fences ?? []
    if (fences.length === 0) return tr
    let blocked = false

    tr.changes.iterChangedRanges((fromA, toA) => {
      if (blocked) return
      for (const fence of fences) {
        // fence 若不以换行收尾，连同行尾换行一起保护，避免 fence 与相邻内容粘连。
        const protectedTo =
          fence.to < tr.startState.doc.length &&
          tr.startState.doc.sliceString(fence.to - 1, fence.to) !== '\n'
            ? Math.min(tr.startState.doc.length, fence.to + 1)
            : fence.to
        if (fromA === toA) {
          if (fromA >= fence.from && fromA < protectedTo) blocked = true
        } else if (fromA < protectedTo && toA > fence.from) {
          blocked = true
        }
        if (blocked) return
      }
    })

    return blocked ? [] : tr
  })
}

/** 用户编辑（非 externalSync 事务）时，逐块把当前文本作为草稿发出去。 */
function createEmitPlugin(field: StateField<EditorModel>, hooks: EditorHooks): Extension {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return
        if (update.transactions.some((tr) => tr.annotation(externalSync))) return
        const blocks = update.state.field(field).blocks
        for (const block of blocks) {
          hooks.onDraftText(block.id, update.state.sliceDoc(block.from, block.to))
        }
      }
    },
  )
}

/* ── 句柄 ─────────────────────────────────────────────────────────── */

/** fence 布局由 framing 决定：fence 字节本身变化也视为结构变化。 */
function framingEqual(a: EditorFraming, b: EditorFraming): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind !== 'fenced' || b.kind !== 'fenced') return true
  return a.opening === b.opening && a.closing === b.closing
}

export function createDocumentEditor(container: HTMLElement, options: DocumentEditorOptions): DocumentEditorHandle {
  // 回调走可变槽位（原型 actionsRef 模式）：sync 换入最新回调，
  // widget / emit plugin 始终读同一个恒定对象。
  const hooks: EditorHooks = {
    onDraftText: options.onDraftText,
    onSaveBlock: options.onSaveBlock,
    onRevertBlock: options.onRevertBlock,
  }

  let framing: EditorFraming = options.framing
  let agentName = options.agentName
  let readonly = options.readonly ?? false
  let field: StateField<EditorModel> | null = null
  let view: EditorView | null = null

  // 原型把 .doc-editor / .readonly 挂在自己的宿主 div 上；这里容器由调用方
  // 提供，补挂同名类保证主 bundle 的作用域 CSS 生效，destroy 时按需移除。
  const hadDocEditorClass = container.classList.contains('doc-editor')
  const hadReadonlyClass = container.classList.contains('readonly')
  container.classList.add('doc-editor')

  const mount = (next: DocumentEditorOptions): void => {
    const nextReadonly = next.readonly ?? false
    const layout = layoutDocument(next.framing, next.blocks, next.drafts)
    const nextField = createEditorField({ blocks: layout.blocks, fences: layout.fences }, nextReadonly, hooks)
    const state = EditorState.create({
      doc: layout.text,
      extensions: [
        basicSetup,
        oneDark,
        theme,
        markdown(),
        EditorView.lineWrapping,
        EditorView.editable.of(!nextReadonly),
        EditorState.readOnly.of(nextReadonly),
        EditorView.contentAttributes.of({
          'aria-label': `${next.agentName} 定义文件`,
          'aria-multiline': 'true',
        }),
        nextField,
        EditorView.decorations.from(nextField, (value) => value.decorations),
        createRegionGutter(nextField),
        createStructureFilter(nextField),
        createEmitPlugin(nextField, hooks),
      ],
    })
    view = new EditorView({ state, parent: container })
    field = nextField
    container.classList.toggle('readonly', nextReadonly)
  }

  mount(options)

  return {
    sync(next) {
      hooks.onDraftText = next.onDraftText
      hooks.onSaveBlock = next.onSaveBlock
      hooks.onRevertBlock = next.onRevertBlock

      const nextReadonly = next.readonly ?? false
      // readonly / agentName 参与静态扩展或 aria：整体重建视图（原型即以
      // useEffect [readonly] 重新挂载）；其余变化走对账。
      if (nextReadonly !== readonly || next.agentName !== agentName) {
        view?.destroy()
        readonly = nextReadonly
        agentName = next.agentName
        framing = next.framing
        mount(next)
        return
      }

      const editorView = view
      const editorField = field
      if (editorView === null || editorField === null) return

      const live = editorView.state.field(editorField)

      // 对账判据：framing 一致且块 id+kind 序列一致，否则整篇 reset。
      const sameStructure =
        framingEqual(framing, next.framing) &&
        live.blocks.length === next.blocks.length &&
        live.blocks.every((block, i) => {
          const nextBlock = next.blocks[i]
          return nextBlock !== undefined && block.id === nextBlock.id && block.kind === nextBlock.kind
        })

      if (!sameStructure) {
        const layout = layoutDocument(next.framing, next.blocks, next.drafts)
        const spec: TransactionSpec = {
          effects: resetModel.of({ blocks: layout.blocks, fences: layout.fences }),
          annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
        }
        if (editorView.state.doc.toString() !== layout.text) {
          spec.changes = { from: 0, to: editorView.state.doc.length, insert: layout.text }
        }
        editorView.dispatch(spec)
        framing = next.framing
        return
      }

      // 外部状态与编辑器内部文本对齐。草稿优先：有草稿的块保留编辑器当前
      // 文本，其余块采用新的已存文本。
      const meta: Record<string, string> = {}
      for (const block of next.blocks) meta[block.id] = block.text

      const changes: { from: number; to: number; insert: string }[] = []
      for (const block of live.blocks) {
        const saved = meta[block.id] ?? block.saved
        const desired = next.drafts[block.id] ?? saved
        if (editorView.state.sliceDoc(block.from, block.to) !== desired) {
          changes.push({ from: block.from, to: block.to, insert: desired })
        }
      }

      const metaChanged = live.blocks.some((block) => {
        const nextMeta = meta[block.id]
        return nextMeta === undefined || nextMeta !== block.saved
      })

      if (changes.length === 0 && !metaChanged) return

      const spec: TransactionSpec = {
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
      }
      if (changes.length > 0) spec.changes = changes
      if (metaChanged) spec.effects = syncMeta.of(meta)
      editorView.dispatch(spec)
    },

    destroy() {
      view?.destroy()
      view = null
      field = null
      if (!hadDocEditorClass) container.classList.remove('doc-editor')
      if (!hadReadonlyClass) container.classList.remove('readonly')
    },
  }
}
