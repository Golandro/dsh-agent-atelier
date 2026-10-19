/**
 * 「智能体工坊」面板壳（票 05 收口件）。
 *
 * 注册：经 `ctx.slots` 占两个座——`sidebar.panellist` 行（与 Plugins 按钮同一
 * 全局面板列表，order 5 落在 plugins 0 与 schedules 10 之间）+ 同 id 的根级
 * `main` 键控面板（owner 契约见 @deepseek-ai/dsh-client-ui-sidebar
 * contract/slots.d.ts；注册先例 @deepseek-ai/dsh-client-ui-schedule）。
 * 原 settings.section 外壳按维护者裁决移除（票 05，2026-10-19）。
 *
 * 页面：本模块持有唯一一个 createHttpControlClient() 实例（useState 惰性初始化）；
 * 壳只负责快照状态机（loading / error / 重试 + AbortController 清理），就绪后把
 * client 与初始快照交给 AgentsWorkspace（./page.tsx）——compose / plan / commit /
 * invalidate 的业务流程全部在页面组件内，壳不再持有域状态。
 *
 * 作用域根：AgentsWorkspace 返回页头（智能体 / 操作历史 / 配置页签 + 刷新）与
 * `.agents-page` / 操作历史两个保持挂载的视图；本壳负责渲染
 * `.agent-atelier-page` 基座——styles.css 的全部前缀化规则、`--dsh-*`
 * token 与 pane.tsx 拖拽态的 closest() 查找都挂在这层上。
 *
 * 样式：`./styles.css` 是普通静态资源（styles.css → 构建期内联为一次幂等
 * `<style>` 注入），不再在 TS 里握手拼字符串；挂载时再 ensure 一次，兼顾宿主
 * 重建 head 的情况。
 *
 * 依赖纪律：外部包只准 react；运行时相对 import 只许层内 + control 层白名单
 * （http-client / client-errors）；node: 内建禁止——build-client.mjs 的本地模块
 * 映射按此收集，越层 require 会报 unexpected relative require（修 import 不修脚本）。
 */
import { createElement as h, useEffect, useState } from 'react'

import { createHttpControlClient } from '../../control/http-client.ts'
import { PAGE_ROOT_CLASS } from './class-names.ts'
import { AgentsWorkspace } from './page.tsx'
import * as pageStyles from './styles.css'

import type { ControlSnapshot } from '../../control/index.ts'
import type { ReactNode } from 'react'

/** 侧栏行 id 与对应 `main` 面板键：同一字符串，两个座。 */
const PANEL_ID = 'agent-atelier'

/** 测试锚点：壳各态共用的 DOM 查询入口。 */
const PAGE_TEST_ID = 'agent-atelier-page'

/**
 * Owner 侧的 `sidebar.panellist` 行份额：请求的方形边长与是否选中
 * （SidebarPanelIconOwnerProps）。
 */
interface PanelIconOwnerProps {
  readonly size: number
  readonly active: boolean
}

/** `main` 面板占位者收到框架运行时份额；我们不用。 */
type MainPanelOwnerProps = Record<never, never>

/** 本入口占的两个座的注册选项。 */
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
}

/** 本入口等待的 cordis 客户端服务。 */
export const inject = ['slots'] as const

/**
 * 注册「智能体工坊」面板：左栏一行（紧邻 Plugins）+ 该行选中的中央 `main`
 * 面板。页面样式由 `./styles.css` 的模块加载时注入器负责（构建期静态内联）。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: '智能体工坊' },
      AgentControlIcon,
    ),
  )
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, AgentControlPage))
}

/**
 * 装饰性侧栏图标：三路调音台（每通道一枚旋钮）。继承 currentColor，
 * 在窄轨与宽栏两种状态下都随主题。
 */
export function AgentControlIcon({ size }: PanelIconOwnerProps): ReactNode {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M4 7h7.4M16.6 7H20M4 12h1.4M10.6 12H20M4 17h9.4M18.6 17H20' }),
    h('circle', { cx: 14, cy: 7, r: 2.2 }),
    h('circle', { cx: 8, cy: 12, r: 2.2 }),
    h('circle', { cx: 16, cy: 17, r: 2.2 }),
  )
}

/** 页面壳：唯一 client 实例 + 快照状态机（loading / error / 重试），域规则全在页面组件。 */
export function AgentControlPage(_props: MainPanelOwnerProps): ReactNode {
  // useState 惰性初始化：整个面板生命周期共用一个 HTTP 客户端实例。
  const [client] = useState(createHttpControlClient)
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // 宿主重建 head / 插件重挂载时补一次（CSS 模块导出幂等的 ensure）。
  useEffect(() => { pageStyles.ensure?.() }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    client
      .snapshot({ signal: controller.signal })
      .then((snapshot) => {
        if (!controller.signal.aborted) setState({ status: 'ready', snapshot })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setState({ status: 'error', message: errorMessage(error) })
      })
    // 卸载 / 重试即中止在途请求（清理语义与页面内写路径一致）。
    return () => controller.abort()
  }, [client, attempt])

  // 就绪后整个舞台交给工作区：作用域根仍由壳持有（token / 前缀样式 / 拖拽 closest）。
  if (state.status === 'ready') {
    return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
      h(AgentsWorkspace, { client, initialSnapshot: state.snapshot }))
  }
  // 引导态复用 list-chunk-status 的居中样式（加载中 / 失败 + 重试）。
  if (state.status === 'error') {
    return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
      h('div', { className: 'list-chunk-status', role: 'alert' },
        h('p', null, `快照加载失败：${state.message}`),
        h('button', { type: 'button', className: 'btn btn-sm', onClick: () => setAttempt((a) => a + 1) }, '重试')))
  }
  return h('div', { className: PAGE_ROOT_CLASS, 'data-testid': PAGE_TEST_ID },
    h('div', { className: 'list-chunk-status' }, h('p', null, '正在加载智能体…')))
}

type PageState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: ControlSnapshot }
  | { readonly status: 'error'; readonly message: string }

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
