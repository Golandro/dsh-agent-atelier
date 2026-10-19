/**
 * Editor chunk — document layout（纯函数，无 DOM）。
 *
 * fenced 文档排成 `opening + frontmatter + closing + prose`：fence 行保留在
 * 组合文本中可见，但受结构保护（保护逻辑见 index.ts 的 structure filter），
 * 每个块的范围在组合文本内单独标注。plain 文档只有单个 prose 块，覆盖全文。
 *
 * 布局没有独立生命周期：每次 sync 都从当前 options 重算；编辑器内部只做
 * 位置映射（mapPos），不持有布局规则。
 */
import type { DecorationSet } from '@codemirror/view'
import type { EditorBlock, EditorBlockKind, EditorFraming } from '../src/dsh/client/chunk-contracts.ts'

/** 组合文档里的一个活动块（位置为文档坐标）。 */
export interface LiveBlock {
  readonly id: string
  readonly kind: EditorBlockKind
  readonly from: number
  readonly to: number
  /** 该块上次保存的文本；脏态 = 编辑器内文本 !== saved。 */
  readonly saved: string
}

/** 结构保护范围（一行 fence）：用户编辑落进区间即被拒绝。 */
export interface FenceRange {
  readonly from: number
  readonly to: number
}

/** 编辑器 StateField 的模型：块 + fence 保护范围 + 派生的装饰集。 */
export interface EditorModel {
  readonly blocks: readonly LiveBlock[]
  readonly fences: readonly FenceRange[]
  readonly decorations: DecorationSet
}

/** 一次布局的结果：组合文本 + 各块位置 + fence 保护范围。 */
export interface DocumentLayout {
  readonly text: string
  readonly blocks: readonly LiveBlock[]
  readonly fences: readonly FenceRange[]
}

/** 逐块取当前文本：草稿优先，无草稿回落到已存文本。 */
function currentText(block: EditorBlock, drafts: Readonly<Record<string, string>>): string {
  return drafts[block.id] ?? block.text
}

/** 由 framing + 块列表 + 草稿重算组合文档布局。 */
export function layoutDocument(
  framing: EditorFraming,
  blocks: readonly EditorBlock[],
  drafts: Readonly<Record<string, string>>,
): DocumentLayout {
  if (framing.kind === 'plain') {
    // plain 文档：全文就是 prose 文本，单块覆盖整个文档，没有 fence 保护。
    const prose = blocks.find((block) => block.kind === 'prose') ?? blocks[0]
    if (prose === undefined) return { text: '', blocks: [], fences: [] }
    const text = currentText(prose, drafts)
    return {
      text,
      blocks: [{ id: prose.id, kind: prose.kind, from: 0, to: text.length, saved: prose.text }],
      fences: [],
    }
  }

  const { opening, closing } = framing
  const frontmatter = blocks.find((block) => block.kind === 'frontmatter')
  const prose = blocks.find((block) => block.kind === 'prose')

  const frontmatterText = frontmatter === undefined ? '' : currentText(frontmatter, drafts)
  const proseText = prose === undefined ? '' : currentText(prose, drafts)
  const text = opening + frontmatterText + closing + proseText

  const frontmatterFrom = opening.length
  const frontmatterTo = frontmatterFrom + frontmatterText.length
  const proseFrom = frontmatterTo + closing.length

  const layoutBlocks: LiveBlock[] = []
  if (frontmatter !== undefined) {
    layoutBlocks.push({
      id: frontmatter.id,
      kind: 'frontmatter',
      from: frontmatterFrom,
      to: frontmatterTo,
      saved: frontmatter.text,
    })
  }
  if (prose !== undefined) {
    layoutBlocks.push({
      id: prose.id,
      kind: 'prose',
      from: proseFrom,
      to: text.length,
      saved: prose.text,
    })
  }

  // fence 行可见但受结构保护；空 fence（异常输入）没有可保护的字节。
  const fences: FenceRange[] = [
    { from: 0, to: opening.length },
    { from: frontmatterTo, to: frontmatterTo + closing.length },
  ].filter((fence) => fence.to > fence.from)

  return { text, blocks: layoutBlocks, fences }
}
