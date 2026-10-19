/**
 * Editor chunk — 块头 chrome 与区域 rail gutter（命令式 DOM，无 React）。
 *
 * 移植自原型 DocumentEditor 的 widget/gutter 部分，按票面 v1 裁剪：
 * 只保留 frontmatter 块头（badge、文件、状态、行范围、保存/回退按钮）与
 * 左栏 rail（含首末横线）；clip 相关的 inline chrome、折叠、缺失说明全部不移植。
 *
 * chrome 放在 widget 里：不可编辑、不进入文本选区；rail 放在 gutter 里：
 * 只带 class 的 marker 借 CSS ::before 画线，不产生额外 DOM 内容。
 */
import { GutterMarker, WidgetType, gutter } from '@codemirror/view'
import type { BlockInfo } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { Extension, StateField } from '@codemirror/state'
import type { EditorBlockKind } from '../src/dsh/client/chunk-contracts.ts'
import type { EditorModel, LiveBlock } from './layout.ts'

/**
 * 块头回调集合。对象身份恒定（原型 actionsRef 模式）：handle 的 sync 只换
 * 内部槽位，widget 的 eq 依赖这个恒定身份，避免回调更新导致 widget 重建。
 */
export interface EditorHooks {
  onDraftText(blockId: string, text: string): void
  onSaveBlock(blockId: string): void
  onRevertBlock(blockId: string): void
}

/**
 * widget 渲染所需的块头元数据；逐字段比较（sameHeadMeta）决定是否重建。
 * 契约的 `EditorBlock` 只携带 id/kind/text，没有块文件路径，故不渲染 file 段
 * （原型 fillChrome 的 file/layer 两段在 v1 契约下一起省略）。
 */
export interface HeadMeta {
  readonly id: string
  readonly kind: EditorBlockKind
  readonly dirty: boolean
  readonly range: string
  readonly readonly: boolean
}

export const sameHeadMeta = (a: HeadMeta, b: HeadMeta): boolean =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.dirty === b.dirty &&
  a.range === b.range &&
  a.readonly === b.readonly

function actionButton(label: string, title: string, onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn btn-sm cm-head-btn'
  button.textContent = label
  button.dataset.icon = label === '保存' ? '✓' : '↩'
  button.setAttribute('aria-label', label)
  button.title = title
  // mousedown preventDefault：按钮点击不吞编辑器焦点。
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return button
}

/**
 * 填充块头 chrome：badge、保存状态、全局行范围；未保存时追加保存/回退按钮
 * （点击始终走 hooks 里的最新回调）。
 */
export function fillChrome(container: HTMLElement, meta: HeadMeta, hooks: EditorHooks, withKind: boolean): void {
  container.classList.add('cm-head-chrome')
  container.contentEditable = 'false'

  if (withKind) {
    const kind = document.createElement('span')
    kind.className = `cm-head-badge kind-${meta.kind}`
    kind.textContent = meta.kind === 'frontmatter' ? 'front-matter' : meta.kind
    container.append(kind)
  }

  const state = document.createElement('span')
  state.className = `cm-head-state${meta.dirty ? ' dirty' : ''}`
  state.textContent = meta.dirty ? '未保存' : '已保存'
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

  // 禁用按钮不占位：已保存时 chrome 只保留只读信息。
  if (!meta.readonly && meta.dirty) {
    container.append(
      actionButton('保存', '只回写此块', () => hooks.onSaveBlock(meta.id)),
      actionButton('回退', '撤回此块的未保存改动', () => hooks.onRevertBlock(meta.id)),
    )
  }
}

/** frontmatter 块头：块级 widget，占自己的一行，渲染在 frontmatter 内容之前。 */
export class FrontmatterHeaderWidget extends WidgetType {
  constructor(
    readonly meta: HeadMeta,
    readonly hooks: EditorHooks,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof FrontmatterHeaderWidget &&
      this.hooks === other.hooks &&
      sameHeadMeta(this.meta, other.meta)
    )
  }

  override toDOM(): HTMLElement {
    const header = document.createElement('div')
    header.className = 'cm-fm-head'
    fillChrome(header, this.meta, this.hooks, true)
    return header
  }

  // 块级 widget 有真实高度：预留 header 行高，避免首次布局跳动。
  override get estimatedHeight(): number {
    return 31
  }
}

/** 只带 class、不产生 DOM 的 gutter 标记：用于绘制区域左栏与首末横线。 */
export class RegionRailMarker extends GutterMarker {
  constructor(classes: string) {
    super()
    this.elementClass = classes
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof RegionRailMarker && other.elementClass === this.elementClass
  }
}

const frontmatterHeadRail = new RegionRailMarker(
  'cm-region-rail cm-region-rail-kind-frontmatter cm-region-rail-head cm-region-rail-widget',
)

/**
 * 找出某一行属于哪个区域的哪一段：head / body / last。
 * v1 只标注 frontmatter（prose 不标记）；frontmatter 的 header 是块 widget，
 * 它那一行的 gutter 顶栏由 widgetMarker 提供，文档行只负责左侧栏和末行底线。
 */
function regionRailForLine(
  state: EditorState,
  blocks: readonly LiveBlock[],
  line: BlockInfo,
): GutterMarker | null {
  const lineNo = state.doc.lineAt(line.from).number
  for (const block of blocks) {
    if (block.kind !== 'frontmatter' || block.to <= block.from) continue
    const startLine = state.doc.lineAt(block.from).number
    const endLine = state.doc.lineAt(block.to - 1).number
    if (lineNo < startLine || lineNo > endLine) continue
    const classes = ['cm-region-rail', 'cm-region-rail-kind-frontmatter', 'cm-region-rail-body']
    if (lineNo === endLine) classes.push('cm-region-rail-last')
    return new RegionRailMarker(classes.join(' '))
  }
  return null
}

/**
 * 区域左栏 gutter：rail 与首末横线都在 gutter 里画，而不是 header 内联。
 * gutter 类名沿用原型的 `cm-clipFoldGutter`，主 bundle 的 CSS 移植即可逐行复用。
 */
export function createRegionGutter(field: StateField<EditorModel>): Extension {
  return gutter({
    class: 'cm-clipFoldGutter',
    lineMarker(view, line) {
      return regionRailForLine(view.state, view.state.field(field).blocks, line)
    },
    widgetMarker(_view, widget) {
      if (widget instanceof FrontmatterHeaderWidget) return frontmatterHeadRail
      return null
    },
    lineMarkerChange(update) {
      return update.startState.field(field, false) !== update.state.field(field, false)
    },
  })
}
