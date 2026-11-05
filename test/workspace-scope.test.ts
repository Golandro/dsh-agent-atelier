/**
 * 工作空间范围推导（票 37 / Q11）的门：显式记忆 → 当前会话 → 最近活跃 → 用户全局。
 * 纯函数，不挂载 React，也不碰宿主服务对象。
 */
import { describe, expect, it } from 'vitest'

import {
  REMEMBERED_USER,
  SCOPE_STORAGE_KEY,
  USER_CHOICE,
  choiceKey,
  cwdOf,
  currentSessionCwd,
  deriveChoice,
  matchWorkspaceByPath,
  normalizeWorkspacePath,
  readRemembered,
  recentWorkspaceId,
  workspaceChoiceOf,
  scopeNoticeOf,
  writeRemembered,
} from '../src/dsh/client/workspace-scope.ts'

import type { SessionListLike, WorkspaceRow, WorkspaceListLike, WriteOnceStorage } from '../src/dsh/client/workspace-scope.ts'

function row(overrides: Partial<WorkspaceRow> & { readonly workspaceId: string }): WorkspaceRow {
  return {
    path: `/work/${overrides.workspaceId}`,
    title: overrides.workspaceId,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

const LIST: WorkspaceListLike = {
  items: [row({ workspaceId: 'alpha' }), row({ workspaceId: 'beta' })],
}

function sessions(entries: Record<string, { cwd?: string; updatedAt?: number; retainedBy?: Record<string, number> }>): SessionListLike {
  return { byId: entries }
}

function storage(initial: Record<string, string> = {}): WriteOnceStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('工作空间范围：路径口径', () => {
  it('去掉尾斜杠（根除外）后比较', () => {
    expect(normalizeWorkspacePath('/work/alpha/')).toBe('/work/alpha')
    expect(normalizeWorkspacePath('/')).toBe('/')
    expect(matchWorkspaceByPath(LIST.items, '/work/alpha/')?.workspaceId).toBe('alpha')
    expect(matchWorkspaceByPath(LIST.items, '/work/gamma')).toBeUndefined()
  })

  it('选中的 cwd 用户全局为空、工作区为路径', () => {
    expect(cwdOf(USER_CHOICE)).toBeUndefined()
    expect(cwdOf(workspaceChoiceOf(LIST.items[0]!))).toBe('/work/alpha')
    expect(choiceKey(USER_CHOICE)).toBe(REMEMBERED_USER)
    expect(choiceKey(workspaceChoiceOf(LIST.items[1]!))).toBe('beta')
  })
})

describe('工作空间范围：推导顺序', () => {
  it('显式记忆优先于当前会话', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({ s1: { cwd: '/work/beta', updatedAt: 5, retainedBy: { mainView: 1 } } }),
      remembered: 'alpha',
    })
    expect(derived.reason).toBe('remembered')
    expect(derived.choice).toMatchObject({ kind: 'workspace', workspaceId: 'alpha' })
  })

  it('记住「用户全局」也优先', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({ s1: { cwd: '/work/beta', updatedAt: 5, retainedBy: { mainView: 1 } } }),
      remembered: REMEMBERED_USER,
    })
    expect(derived).toEqual({ choice: USER_CHOICE, reason: 'remembered' })
  })

  it('记住的工作区已不存在时重新推导', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({ s1: { cwd: '/work/beta', updatedAt: 5, retainedBy: { mainView: 1 } } }),
      remembered: 'gone',
    })
    expect(derived.reason).toBe('current-session')
    expect(derived.choice).toMatchObject({ workspaceId: 'beta' })
  })

  it('记住的工作区已不存在时带失效标记（界面要说明是被迫重选）', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({ s1: { cwd: '/work/beta', updatedAt: 5, retainedBy: { mainView: 1 } } }),
      remembered: 'gone',
    })
    expect(derived.staleRemembered).toBe('gone')
  })

  it('记忆命中、没记住、列表未就绪都不算失效', () => {
    expect(deriveChoice({ items: LIST.items, sessions: undefined, remembered: 'alpha' }).staleRemembered).toBeUndefined()
    expect(deriveChoice({ items: LIST.items, sessions: undefined }).staleRemembered).toBeUndefined()
    expect(deriveChoice({ items: LIST.items, sessions: undefined, remembered: REMEMBERED_USER }).staleRemembered).toBeUndefined()
    // 列表服务还没就绪：items 只是空占位，不能据此判定记忆失效。
    const pending = deriveChoice({ items: [], sessions: undefined, remembered: 'alpha', listsReady: false })
    expect(pending.staleRemembered).toBeUndefined()
    expect(pending).toEqual({ choice: USER_CHOICE, reason: 'fallback' })
  })

  it('当前会话的 cwd 命中工作区即选中（尾斜杠不影响）', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({ s1: { cwd: '/work/alpha/', updatedAt: 1, retainedBy: { mainView: 1 } } }),
    })
    expect(derived.reason).toBe('current-session')
    expect(derived.choice).toMatchObject({ workspaceId: 'alpha' })
  })

  it('当前会话的目录没注册时落用户全局，不跳到别的工作区', () => {
    const derived = deriveChoice({
      items: LIST.items,
      sessions: sessions({
        current: { cwd: '/elsewhere', updatedAt: 9, retainedBy: { mainView: 1 } },
        other: { cwd: '/work/beta', updatedAt: 99, retainedBy: {} },
      }),
    })
    expect(derived).toEqual({ choice: USER_CHOICE, reason: 'fallback' })
  })

  it('没有当前会话时用最近活跃工作区（会话 updatedAt 最大）', () => {
    const derived = deriveChoice({
      items: [
        row({ workspaceId: 'older', sessionIds: ['a'] }),
        row({ workspaceId: 'newer', sessionIds: ['b'] }),
      ],
      sessions: sessions({ a: { updatedAt: 10 }, b: { updatedAt: 20 } }),
    })
    expect(derived.reason).toBe('recent')
    expect(derived.choice).toMatchObject({ workspaceId: 'newer' })
  })

  it('工作区没有会话时按 createdAt 参与比较', () => {
    const derived = deriveChoice({
      items: [
        row({ workspaceId: 'fresh', createdAt: '2026-06-01T00:00:00.000Z' }),
        row({ workspaceId: 'stale', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
      sessions: undefined,
    })
    expect(derived.choice).toMatchObject({ workspaceId: 'fresh' })
  })

  it('列表为空落用户全局', () => {
    expect(deriveChoice({ items: [], sessions: undefined })).toEqual({ choice: USER_CHOICE, reason: 'fallback' })
  })
})

describe('工作空间范围：会话与最近活跃口径', () => {
  it('当前会话只认 retainedBy.mainView > 0 的行', () => {
    expect(currentSessionCwd(sessions({
      idle: { cwd: '/work/alpha', updatedAt: 50, retainedBy: {} },
      shown: { cwd: '/work/beta', updatedAt: 1, retainedBy: { mainView: 1 } },
    }))).toBe('/work/beta')
    expect(currentSessionCwd(sessions({ idle: { cwd: '/work/alpha' } }))).toBeUndefined()
    expect(currentSessionCwd(undefined)).toBeUndefined()
  })

  it('同分时 recentWorkspaceId 取先出现的行（稳定）', () => {
    const items = [
      row({ workspaceId: 'first', sessionIds: ['x'] }),
      row({ workspaceId: 'second', sessionIds: ['y'] }),
    ]
    expect(recentWorkspaceId(items, sessions({ x: { updatedAt: 5 }, y: { updatedAt: 5 } }))).toBe('first')
    expect(recentWorkspaceId([], undefined)).toBeUndefined()
  })
})

describe('工作空间范围：头部提示', () => {
  const alpha = workspaceChoiceOf(LIST.items[0]!)

  it('服务端回退到用户全局时给警告', () => {
    expect(scopeNoticeOf({
      choice: alpha,
      listStatus: 'ready',
      scope: { cwd: '/work/alpha', projectRoot: null },
    })).toEqual({ severity: 'warn', text: '该工作空间不可用，已回退到用户全局' })
  })

  it('项目根与所选目录不同时给信息提示', () => {
    expect(scopeNoticeOf({
      choice: alpha,
      listStatus: 'ready',
      scope: { cwd: '/work/alpha', projectRoot: '/work' },
    })).toEqual({ severity: 'info', text: '项目根：/work' })
  })

  it('用户全局与正常解析都不提示', () => {
    expect(scopeNoticeOf({ choice: USER_CHOICE, listStatus: 'ready', scope: { cwd: null, projectRoot: null } })).toBeUndefined()
    expect(scopeNoticeOf({
      choice: alpha,
      listStatus: 'ready',
      scope: { cwd: '/work/alpha', projectRoot: '/work/alpha' },
    })).toBeUndefined()
  })

  it('切换途中快照还属于上一个范围：不拿它判「已回退」', () => {
    // 用户刚选了 alpha，snapshot 还是用户全局那份（cwd/projectRoot 都是 null）。
    // 这一瞬间汇报「已回退到用户全局」与事实相反。
    expect(scopeNoticeOf({
      choice: alpha,
      listStatus: 'ready',
      scope: { cwd: null, projectRoot: null },
      scopeSettled: false,
    })).toBeUndefined()
  })

  it('列表不可用与快照无关，切换途中照样提示', () => {
    expect(scopeNoticeOf({
      choice: alpha,
      listStatus: 'unavailable',
      scope: undefined,
      scopeSettled: false,
    })).toEqual({ severity: 'warn', text: '工作区列表不可用' })
  })
})

describe('工作空间范围：记忆读写', () => {
  it('写入后读回同一选择', () => {
    const store = storage()
    writeRemembered(store, workspaceChoiceOf(LIST.items[0]!))
    expect(store.values.get(SCOPE_STORAGE_KEY)).toBe('alpha')
    expect(readRemembered(store)).toBe('alpha')

    writeRemembered(store, USER_CHOICE)
    expect(readRemembered(store)).toBe(REMEMBERED_USER)
  })

  it('存储缺失或抛错都当作没有记住', () => {
    expect(readRemembered(undefined)).toBeUndefined()
    const broken: WriteOnceStorage = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
    }
    expect(readRemembered(broken)).toBeUndefined()
    expect(() => writeRemembered(broken, USER_CHOICE)).not.toThrow()
  })
})
