/**
 * 票 84：注册侧账本。
 *
 * 定义是「注册方自己记自己注册了什么」（规格 §3 / ADR-0009）——所以它记的恰好是
 * **真的进了宿主注册表的那些节**：规划里 `executable: false` 的行没有注册动作，
 * 账本不记它（否则投影要替它编一段）。
 *
 * 它也不记 waterfall 改写、遮蔽与配置文件：那些是 `assemble()` 时刻或发现期的事实，
 * 注册时还不知道。缺席就是缺席，不猜。
 *
 * 无 React、无 IO、无宿主类型：本模块只持有一个按 scope 分桶的普通数据表。它是
 * 独立对象而不是服务面成员——`AgentAssembly` 是冻结面（成员表有测试守着），
 * 账本由持有它的那一行注入给 sink（`AssemblyServiceOptions.ledger`）。
 */
import type { PromptSectionLedgerEntry } from './segments.ts'

/**
 * 注册侧账本：按 scope 记「本仓 sink 注册了哪些节」。
 *
 * 表按 scope 分桶且不强引用 scope：挂载表本身是 `WeakMap` 语义，账本跟着走，
 * 一个 scope 的注册被撤销后它的记录也消失。
 */
export interface PromptLedger {
  /**
   * 记下一次挂载注册的节（整批替换该 scope 的记录）。
   *
   * 传空数组等价于清空：全量替换语义下，新一次挂载的记录就是全部记录。
   */
  record(scope: object, entries: readonly PromptSectionLedgerEntry[]): void
  /** 撤销该 scope 的全部记录（dispose 时调用）。 */
  forget(scope: object): void
  /** 该 scope 当前的记录；没记过就是空表。 */
  of(scope: object): readonly PromptSectionLedgerEntry[]
}

/** 建一份空账本。 */
export function createPromptLedger(): PromptLedger {
  const tables = new WeakMap<object, readonly PromptSectionLedgerEntry[]>()
  return {
    record(scope, entries) {
      tables.set(scope, entries)
    },
    forget(scope) {
      tables.delete(scope)
    },
    of(scope) {
      return tables.get(scope) ?? []
    },
  }
}
