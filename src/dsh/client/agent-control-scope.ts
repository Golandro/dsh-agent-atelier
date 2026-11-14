/** 宿主服务读取面：把 slots 上下文折成 client 所需的工作空间范围。 */
import { observableOf } from './observable.ts'

import type {
  ScopeSource,
  SessionListLike,
  WorkspaceListLike,
  WriteOnceStorage,
} from '../../client/index.ts'

export function createAgentControlScope(get: (name: string) => unknown): ScopeSource {
  return {
    readWorkspaces: () => observableOf<WorkspaceListLike>(get('workspaces')),
    readSessions: () => observableOf<SessionListLike>(get('sessions')),
    storage: sessionStorageOf(),
  }
}

/** `sessionStorage`，隐私模式下可能抛错：拿不到就不记住。 */
function sessionStorageOf(): WriteOnceStorage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
