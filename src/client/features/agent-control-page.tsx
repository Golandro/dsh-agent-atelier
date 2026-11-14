/** 面板壳：唯一 HTTP client 与快照状态机；工作区业务流程在 page.tsx。 */
import { createElement as h, useEffect, useState } from 'react'

import { createHttpControlClient } from '../../control/http-client.ts'
import { PAGE_ROOT_CLASS } from '../ui-core/class-names.ts'
import { STALE_SCOPE_NOTICE, bootstrapScopeChoice } from '../ui-core/scope-bootstrap.ts'
import { cwdOf } from '../ui-core/workspace-scope.ts'
import { useAbortableLoad } from '../ui-react/abortable-load.ts'
import { AgentsWorkspace } from './page.tsx'
import * as pageStyles from './styles.css'

import type { ScopeSource } from '../ui-core/workspace-scope.ts'
import type { ReactNode } from 'react'

/** 测试锚点：壳各态共用的 DOM 查询入口。 */
const PAGE_TEST_ID = 'agent-atelier-page'

/** 页面壳：唯一 client 实例 + 快照状态机（loading / error / 重试），域规则全在页面组件。 */
export interface AgentControlPageProps {
  /** 工作空间范围的宿主读面（票 37）。 */
  readonly scope: ScopeSource
}

export function AgentControlPage({ scope }: AgentControlPageProps): ReactNode {
  // useState 惰性初始化：整个面板生命周期共用一个 HTTP 客户端实例。
  const [client] = useState(createHttpControlClient)
  // 首帧就要知道范围：先在壳里推导一次，首次快照直接带 cwd，避免先闪一次用户全局。
  const [boot] = useState(() => bootstrapScopeChoice(scope))
  const initialChoice = boot.choice
  // 宿主重建 head / 插件重挂载时补一次（CSS 模块导出幂等的 ensure）。
  useEffect(() => { pageStyles.ensure?.() }, [])

  // 快照状态机与三处懒加载共用（票 26 / 簇 G）：挂载即读一次，重试重跑同一个 loader。
  const page = useAbortableLoad(
    (signal) => client.snapshot({ signal, cwd: cwdOf(initialChoice) }),
    [client, initialChoice],
  )

  // 就绪后整个舞台交给工作区：作用域根仍由壳持有（token / 前缀样式 / 拖拽 closest）。
  if (page.status === 'ready') {
    return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
      h(AgentsWorkspace, {
        client,
        initialSnapshot: page.value,
        initialChoice,
        initialNotice: boot.staleRemembered === undefined ? undefined : STALE_SCOPE_NOTICE,
        scope,
      }))
  }
  // 引导态复用 list-chunk-status 的居中样式（加载中 / 失败 + 重试）。
  if (page.status === 'error') {
    return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
      h('div', { className: 'list-chunk-status', role: 'alert' },
        h('p', null, `快照加载失败：${page.error}`),
        h('button', { type: 'button', className: 'btn btn-sm', onClick: page.retry }, '重试')))
  }
  return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
    h('div', { className: 'list-chunk-status' }, h('p', null, '正在加载智能体…')))
}
