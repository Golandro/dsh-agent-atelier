/**
 * DSH 客户端连接器的 slots 注册面。泛页面实现归 src/client/；本模块只把
 * 宿主上下文接到 client 公共入口，并保留原有的入口 re-export。
 */
import { createElement as h } from 'react'

import { AgentControlIcon, AgentControlPage } from '../../client/index.ts'
import { createAgentControlScope } from './agent-control-scope.ts'

export { AgentControlIcon, AgentControlPage }
export type { AgentControlPageProps } from '../../client/index.ts'

/** 侧栏行 id 与对应 `main` 面板键：同一字符串，两个座。 */
const PANEL_ID = 'agent-atelier'

type RegistrationOptions =
  | {
      readonly name: 'sidebar.panellist'
      readonly id: string
      readonly order?: number | undefined
      readonly label?: string | (() => string) | undefined
    }
  | {
      readonly name: 'main'
      readonly key: string
    }

interface ClientSlots {
  inject(name: string, register: () => () => void): void
  register(options: RegistrationOptions, component: (props: never) => unknown): () => void
}

/** 本插件 `apply` 收到的客户端上下文。 */
export interface ClientContext {
  readonly slots: ClientSlots
  /** 读取已挂载的客户端服务（惰性，因为挂载顺序不保证）。 */
  get(name: string): unknown
}

/** 本入口等待的 cordis 客户端服务。 */
export const inject = ['slots'] as const

/** 注册「智能体工坊」面板：左栏一行 + 该行选中的中央 `main` 面板。 */
export function apply(ctx: ClientContext): void {
  const scope = createAgentControlScope((name) => ctx.get(name))
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: '智能体工坊' },
      AgentControlIcon,
    ),
  )
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, () => h(AgentControlPage, { scope })))
}
