/**
 * 系统提示词页的纯投影（票 68）：把宿主已解析的快照折成「每模型名一张生效层
 * 卡片」，并给出草稿 / 脏标记 / 保存编辑 / 跨页定位的纯判定。
 *
 * 数据纪律：卡片只读合并快照（宿主已按层解析，工作区压过用户）；本模块不重跑
 * 层合并、不读 registryLayers 去猜赢家，也不重算 available（组折叠已由装载期
 * 完成，见 #35）。被覆盖的低层同名条目不会出现在这里——它们的查看入口是「模型
 * 关联」页的层空间。
 *
 * 无 React、无 IO；视图层只消费这里的行与词表。
 */
import type { PanelFocus } from '../../../dsh/client/chunk-contracts.ts'
import type { ControlSnapshot, RegistryEdit } from '../../../control/index.ts'
import { routeKey } from './registry-model.ts'

import type { RegistrySource } from './registry-model.ts'

/** 一张生效层卡片的只读事实；提示词正文由草稿层叠加。 */
export interface PromptCard {
  /** 模型条目名（合并后唯一）。 */
  readonly name: string
  readonly provider: string
  readonly model: string
  /** 声明路线 `provider/model`。 */
  readonly route: string
  /** 生效声明所在层（built-in = 内置 / 合成条目）。 */
  readonly source: RegistrySource
  readonly path?: string | undefined
  /** 运行时生效的 sysPrompt；缺省读作空串（= 不注入额外提示词）。 */
  readonly prompt: string
  /** 内置 / 合成条目只读：没有可写文件。 */
  readonly readOnly: boolean
  /** 合并后的 available（组折叠已完成，本模块不再判一遍）。 */
  readonly available: boolean
  /** 指向本条目的生效别名名，按名称排序。 */
  readonly aliases: readonly string[]
}

/** 草稿层：模型名 → 未保存文本；没有键 = 跟已保存值。 */
export type PromptDrafts = Readonly<Record<string, string>>

export const EMPTY_PROMPT_DRAFTS: PromptDrafts = Object.freeze({})

/** 跨页高亮的停留时长（与原型 SystemPrompts.tsx 同口径）。 */
export const PROMPT_HIGHLIGHT_MS = 1800

/**
 * 卡片网格的单栏断点（rem）：两张卡片各需约 20rem 加间距，再窄就单栏。
 * CSS 的 `@container prompts` 用同一个数字，test/registry-prompts-page.test.ts
 * 断言两边一致（与 pane.tsx 的断点单一事实源同法）。
 */
export const PROMPTS_SINGLE_COLUMN_REM = 42

/** 每模型名一张卡片：快照已合并，这里再按名字去重一次并稳定排序。 */
export function buildPromptCards(snapshot: ControlSnapshot): readonly PromptCard[] {
  const aliasesByModel = new Map<string, string[]>()
  for (const alias of snapshot.aliases) {
    for (const target of alias.targets) {
      const bucket = aliasesByModel.get(target)
      if (bucket === undefined) aliasesByModel.set(target, [alias.alias])
      else bucket.push(alias.alias)
    }
  }
  const seen = new Set<string>()
  const cards: PromptCard[] = []
  for (const entry of snapshot.models) {
    // 合并快照本应唯一；重复名字只保留第一条（优先级最高的那条），不造第二张卡。
    if (seen.has(entry.modelName)) continue
    seen.add(entry.modelName)
    cards.push({
      name: entry.modelName,
      provider: entry.provider,
      model: entry.model,
      route: routeKey(entry),
      source: entry.source,
      ...(entry.path === undefined ? {} : { path: entry.path }),
      prompt: entry.sysPrompt ?? '',
      readOnly: entry.source === 'built-in' || entry.synthesized === true,
      available: entry.available,
      aliases: [...(aliasesByModel.get(entry.modelName) ?? [])].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    })
  }
  // 排序稳定：名称升序，同名的（不应出现）按路线兜底，保证跨页跳转落点不漂。
  return cards.sort((left, right) => {
    const byName = left.name.localeCompare(right.name, 'zh-CN')
    return byName !== 0 ? byName : left.route.localeCompare(right.route, 'zh-CN')
  })
}

/** 空态：全局没有任何模型条目（不是筛选无命中——本页没有筛选）。 */
export function promptsEmptyOf(snapshot: ControlSnapshot): boolean {
  return snapshot.models.length === 0
}

/** 卡片当前显示的文本：草稿优先，否则已保存值。 */
export function promptTextOf(card: PromptCard, drafts: PromptDrafts): string {
  return drafts[card.name] ?? card.prompt
}

/**
 * 脏标记：草稿存在且与已保存值不同。与已保存值相同的草稿不算未保存改动
 * （入口在写入时即清掉这种键，这里只兜底判定）。
 */
export function isPromptDirty(card: PromptCard, drafts: PromptDrafts): boolean {
  const draft = drafts[card.name]
  return draft !== undefined && draft !== card.prompt
}

/** 页面头部与卡片上的未保存计数。 */
export function dirtyPromptCount(cards: readonly PromptCard[], drafts: PromptDrafts): number {
  return cards.filter((card) => isPromptDirty(card, drafts)).length
}

/** 可写：非内置 / 合成，且有写通道（由视图按 onRegistryWrite 是否缺席决定）。 */
export function canEditPrompt(card: PromptCard): boolean {
  return !card.readOnly
}

/**
 * 草稿 → 一笔 setSysPrompt。
 *
 * - 空白草稿 = 移除字段：宿主侧 `sysPrompt: undefined` 走删行分支（空串在
 *   registry-edit.ts 也按「缺席」处理，这里显式给 undefined，语义更直白）；
 * - 只读条目没有编辑（视图不给入口，这里再拦一次）。
 */
export function setSysPromptEditOf(card: PromptCard, text: string): RegistryEdit | null {
  if (!canEditPrompt(card)) return null
  const value = text.trim() === '' ? undefined : text
  return { kind: 'setSysPrompt', modelName: card.name, sysPrompt: value }
}

/** 卡片第二行的 path 文案：内置与合成条目没有文件。 */
export function promptPathLabel(card: PromptCard): string {
  if (card.path !== undefined) return card.path
  return card.source === 'built-in' ? '（内置，无文件）' : '（合成，无文件）'
}

/**
 * 跨页定位落点：只有模型目标落本页，且目标必须已在合并快照里。
 * 找不到 ⇒ null（目标可能刚写入、回读未到；页面等下一份快照再消费，不丢弃）。
 */
export function promptFocusTarget(
  focus: PanelFocus | null | undefined,
  snapshot: ControlSnapshot,
): string | null {
  if (focus === null || focus === undefined || focus.kind !== 'model') return null
  return snapshot.models.some((entry) => entry.modelName === focus.name) ? focus.name : null
}

/** 保存 / 回退按钮的读屏名（卡片内按钮不止一个，名称要能定位到卡片）。 */
export function promptActionLabel(action: 'save' | 'revert', name: string): string {
  return (action === 'save' ? '保存 ' : '回退 ') + name + ' 的 sysPrompt'
}
