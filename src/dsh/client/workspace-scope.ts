/**
 * 工作空间范围（票 37）：把宿主的「工作区列表 + 会话列表」折算成面板的范围选择。
 *
 * 纯函数 + 结构化读：宿主包不能 import（ADR-0001），所以只认形状，不认品牌类型；
 * 空值、坏值、服务缺失一律退化成「用户全局」，不抛错。
 *
 * 推导顺序（grilling Q11 裁决，与 DSH 自己的 `recentWorkspace` 规则同形）：
 * 1. 本会话记住的显式选择（`sessionStorage`）；
 * 2. 当前会话（`retainedBy.mainView > 0`）的 cwd 命中的工作区；
 * 3. 没有当前会话时，按「工作区内会话最新 `updatedAt`（无会话用 `createdAt`）」
 *    取最近活跃的工作区；
 * 4. 否则用户全局。
 *
 * 第 2 步命中失败**不**跳到别的工作区：用户正在看的目录没注册，就诚实落到用户全局。
 */
import type { ObservableSnapshot } from './observable.ts'

/** 面板读取的一条宿主工作区记录（`WorkspaceView` 的结构切片）。 */
export interface WorkspaceRow {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** `ctx.workspaces.list.getSnapshot()` 的结构切片。 */
export interface WorkspaceListLike {
  readonly items: readonly WorkspaceRow[]
  readonly state?: 'idle' | 'loading' | 'error' | undefined
  readonly phase?: 'pending' | 'ready' | undefined
}

/** `ctx.sessions.list.getSnapshot()` 的行切片（只读推导要用的字段）。 */
export interface SessionRowLike {
  readonly cwd?: string | undefined
  readonly updatedAt?: number | undefined
  readonly retainedBy?: Readonly<Partial<Record<string, number>>> | undefined
}

/** `ctx.sessions.list.getSnapshot()` 的结构切片。 */
export interface SessionListLike {
  readonly byId: Readonly<Record<string, SessionRowLike>>
}

/**
 * 面板可用的两个宿主快照；读取是**惰性函数**，因为客户端的服务挂载顺序不保证
 * （本插件可能先于 `ui-workspace` 加载）。缺失即「列表不可用」，面板仍可用。
 */
export interface ScopeSource {
  readWorkspaces(): ObservableSnapshot<WorkspaceListLike> | undefined
  readSessions(): ObservableSnapshot<SessionListLike> | undefined
  readonly storage?: WriteOnceStorage | undefined
}

/** 只读写字符串的最小存储面（`sessionStorage` 的结构切片，测试可直接伪造）。 */
export interface WriteOnceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 用户全局：没有项目层。 */
export interface UserChoice {
  readonly kind: 'user'
}

/** 选中一个宿主工作区。 */
export interface WorkspaceScopedChoice {
  readonly kind: 'workspace'
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

export type WorkspaceChoice = UserChoice | WorkspaceScopedChoice

/** 最终选择是怎么来的（UI 用来区分「跟随会话」与「显式选择」）。 */
export type ScopeReason = 'remembered' | 'current-session' | 'recent' | 'fallback'

/** 列表服务的可用状态。 */
export type ScopeListStatus = 'ready' | 'pending' | 'unavailable'

/** 用户全局的唯一实例，便于相等比较。 */
export const USER_CHOICE: UserChoice = Object.freeze({ kind: 'user' })

/** 记住「用户全局」的存储值；其余存储值是 workspaceId。 */
export const REMEMBERED_USER = 'user'

/** `sessionStorage` 键；改语义就换版本，旧值自然作废。 */
export const SCOPE_STORAGE_KEY = 'dsh-agent-atelier/workspace-scope/v1'

/** 范围的稳定键：状态按它分桶。 */
export function choiceKey(choice: WorkspaceChoice): string {
  return choice.kind === 'user' ? REMEMBERED_USER : choice.workspaceId
}

/** 传给控制端口的 cwd；用户全局用 `undefined`（端口以「未指定」表达用户全局）。 */
export function cwdOf(choice: WorkspaceChoice): string | undefined {
  return choice.kind === 'user' ? undefined : choice.path
}

/** 路径比较口径：去掉尾斜杠（根除外），不做 realpath（客户端拿不到）。 */
export function normalizeWorkspacePath(path: string): string {
  let normalized = path
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return normalized
}

/** 按规范化路径找命中行；没有就是没有，不猜。 */
export function matchWorkspaceByPath(
  items: readonly WorkspaceRow[],
  cwd: string,
): WorkspaceRow | undefined {
  const target = normalizeWorkspacePath(cwd)
  return items.find((row) => normalizeWorkspacePath(row.path) === target)
}

/** 把一行工作区折成选择。 */
export function workspaceChoiceOf(row: WorkspaceRow): WorkspaceScopedChoice {
  return { kind: 'workspace', workspaceId: row.workspaceId, title: row.title, path: row.path }
}

/**
 * 当前会话的 cwd：`retainedBy.mainView > 0` 的那一行（DSH 客户端通用判法）。
 * 多行同时命中时取 `updatedAt` 最大者，保证确定性。
 */
export function currentSessionCwd(sessions: SessionListLike | undefined): string | undefined {
  if (sessions === undefined) return undefined
  let best: string | undefined
  let bestAt = Number.NEGATIVE_INFINITY
  for (const row of Object.values(sessions.byId)) {
    if ((row.retainedBy?.mainView ?? 0) <= 0) continue
    if (row.cwd === undefined || row.cwd === '') continue
    if (row.updatedAt !== undefined && row.updatedAt > bestAt) {
      best = row.cwd
      bestAt = row.updatedAt
    } else if (best === undefined) {
      best = row.cwd
    }
  }
  return best
}

/**
 * 最近活跃的工作区（照抄 DSH `ui-workspace` 的 `recentWorkspace`）：
 * 取工作区内会话最新 `updatedAt` 的最大者，没有会话时用工作区 `createdAt`。
 */
export function recentWorkspaceId(
  items: readonly WorkspaceRow[],
  sessions: SessionListLike | undefined,
): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const row of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of row.sessionIds) {
      const session = sessions?.byId[sessionId]
      const updatedAt = session?.updatedAt
      if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) latest = Math.max(latest, updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) {
      const created = Date.parse(row.createdAt)
      latest = Number.isFinite(created) ? created : 0
    }
    if (selected === undefined || latest > selectedTime) {
      selected = row.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/** 一次推导的完整答案。 */
export interface DerivedChoice {
  readonly choice: WorkspaceChoice
  readonly reason: ScopeReason
  /**
   * 记住的 workspaceId 已经不在列表里（用户上次选的工作区被删了）。
   * 界面据此说明「这次是被迫重选」，而不是静默换一个范围。
   */
  readonly staleRemembered?: string | undefined
}

function derivedChoice(choice: WorkspaceChoice, reason: ScopeReason, staleRemembered?: string): DerivedChoice {
  return staleRemembered === undefined ? { choice, reason } : { choice, reason, staleRemembered }
}

/**
 * 推导默认范围。`remembered` 是上次显式选择（workspaceId 或 `REMEMBERED_USER`）；
 * 记住的行已经不存在时重新推导，不留下悬空选择，并带上 `staleRemembered` 让界面
 * 说明这次是被迫重选。
 *
 * `listsReady: false` 表示工作区列表还没就绪（`items` 可能只是空占位）——
 * 此时「找不到记住的行」不构成失效，不设 `staleRemembered`。
 */
export function deriveChoice(input: {
  readonly items: readonly WorkspaceRow[]
  readonly sessions: SessionListLike | undefined
  readonly remembered?: string | undefined
  readonly listsReady?: boolean | undefined
}): DerivedChoice {
  const remembered = input.remembered
  if (remembered === REMEMBERED_USER) return derivedChoice(USER_CHOICE, 'remembered')
  if (remembered !== undefined) {
    const rememberedRow = input.items.find((row) => row.workspaceId === remembered)
    if (rememberedRow !== undefined) return derivedChoice(workspaceChoiceOf(rememberedRow), 'remembered')
  }
  // 记住的工作区不在列表里、列表已就绪、且列表非空：这才算真正失效。
  // 空列表更可能是服务刚起（或用户把工作区都删了），不据此报「已不存在」。
  const stale = remembered !== undefined && input.listsReady !== false && input.items.length > 0
    ? remembered
    : undefined

  const sessionCwd = currentSessionCwd(input.sessions)
  if (sessionCwd !== undefined) {
    const row = matchWorkspaceByPath(input.items, sessionCwd)
    // 当前看着的目录没注册成工作区：诚实落用户全局，不跳到别的工作区。
    return row === undefined
      ? derivedChoice(USER_CHOICE, 'fallback', stale)
      : derivedChoice(workspaceChoiceOf(row), 'current-session', stale)
  }

  const recentId = recentWorkspaceId(input.items, input.sessions)
  if (recentId !== undefined) {
    const recentRow = input.items.find((row) => row.workspaceId === recentId)
    if (recentRow !== undefined) return derivedChoice(workspaceChoiceOf(recentRow), 'recent', stale)
  }
  return derivedChoice(USER_CHOICE, 'fallback', stale)
}

/** 读回上次显式选择；存储缺失或抛错就是没有记住。 */
export function readRemembered(storage: WriteOnceStorage | undefined): string | undefined {
  if (storage === undefined) return undefined
  try {
    const value = storage.getItem(SCOPE_STORAGE_KEY)
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** 记住这次显式选择；写失败不影响本次会话内的选择。 */
export function writeRemembered(storage: WriteOnceStorage | undefined, choice: WorkspaceChoice): void {
  if (storage === undefined) return
  try {
    storage.setItem(SCOPE_STORAGE_KEY, choiceKey(choice))
  } catch {
    // 隐私模式下 sessionStorage 可能拒写：记住失败不是错误。
  }
}

/** 列表服务给 UI 的状态：不可用 / 还在到 / 就绪。 */
export function listStatusOf(list: WorkspaceListLike | undefined): ScopeListStatus {
  if (list === undefined) return 'unavailable'
  return list.phase === 'pending' ? 'pending' : 'ready'
}

/** 一次宿主快照的读取结果；服务缺失或抛错都退化成空值。 */
export interface ScopeSnapshot {
  readonly items: readonly WorkspaceRow[]
  readonly list: WorkspaceListLike | undefined
  readonly sessions: SessionListLike | undefined
}

/** 读一次宿主快照；任何一层形状不对都当成「没有」，不抛错。 */
export function snapshotScope(source: ScopeSource | undefined): ScopeSnapshot {
  const list = safeSnapshot<WorkspaceListLike>(safeRead(() => source?.readWorkspaces()))
  const sessions = safeSnapshot<SessionListLike>(safeRead(() => source?.readSessions()))
  return { items: Array.isArray(list?.items) ? list.items : [], list, sessions }
}

function safeRead<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

function safeSnapshot<T>(snapshot: { getSnapshot(): T } | undefined): T | undefined {
  if (snapshot === undefined) return undefined
  try {
    return snapshot.getSnapshot()
  } catch {
    return undefined
  }
}

/** 头部状态区的提示（null = 不提示）。 */
export interface ScopeNotice {
  readonly severity: 'warn' | 'info'
  readonly text: string
}

/**
 * 把「列表不可用 / 服务端已回退 / 项目根与所选目录不同」折算成一条提示。
 * 主动选「用户全局」不产生提示——那是用户的决定，不是异常。
 *
 * `scopeSettled: false` 表示手里这份快照还是切换前那次读的（用户刚改了选择、
 * 新快照未到）。此时 `scope` 描述的是上一个范围，拿它判断「已回退」会报出与
 * 事实相反的警告，所以整段跳过——列表不可用的提示与快照无关，照常给出。
 */
export function scopeNoticeOf(input: {
  readonly choice: WorkspaceChoice
  readonly listStatus: ScopeListStatus
  readonly scope: { readonly cwd: string | null; readonly projectRoot: string | null } | undefined
  /** 默认 `true`：快照就是当前选择读出来的那份。 */
  readonly scopeSettled?: boolean | undefined
}): ScopeNotice | undefined {
  if (input.listStatus === 'unavailable') {
    return { severity: 'warn', text: '工作区列表不可用' }
  }
  if (input.choice.kind !== 'workspace') return undefined
  if (input.scopeSettled === false) return undefined
  if (input.scope === undefined) return undefined
  if (input.scope.projectRoot === null) {
    return { severity: 'warn', text: '该工作空间不可用，已回退到用户全局' }
  }
  if (normalizeWorkspacePath(input.scope.projectRoot) !== normalizeWorkspacePath(input.choice.path)) {
    return { severity: 'info', text: `项目根：${input.scope.projectRoot}` }
  }
  return undefined
}
