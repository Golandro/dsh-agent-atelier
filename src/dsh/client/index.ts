/**
 * Browser half of the Agents Manager shell: the "智能体控制" left-sidebar
 * panel. Registered through `ctx.slots` as a `sidebar.panellist` row — the same
 * global-panel list the Plugins button occupies — plus the matching
 * root-scoped `main` keyed panel under the same id, which is how the sidebar
 * shell addresses the central column (owner contract in
 * `@deepseek-ai/dsh-client-ui-sidebar` `contract/slots.d.ts`; registration
 * precedent in `@deepseek-ai/dsh-client-ui-schedule`). The former
 * `settings.section` shell was replaced by maintainer decision (ticket 05,
 * 2026-10-19).
 *
 * The HTTP control client it consumes lives in `src/control/http-client.ts`
 * (Node-free), so the in-memory and HTTP adapters share one contract suite.
 *
 * The module is deliberately dependency-free apart from the platform-provided
 * `react` (the shell's module loader injects it through `require`); the build
 * is plain `tsc` transpile plus a CJS-factory wrapper
 * (`scripts/build-client.mjs`), so no out-of-tree bundler dependency is needed.
 * It never imports a node builtin or host code.
 */
import { createElement as h, useEffect, useState } from 'react'

import { createHttpControlClient } from '../../control/http-client.ts'

import type { ControlSnapshot } from '../../control/index.ts'

/** Sidebar row id and the matching `main` panel key: one string, two seats. */
const PANEL_ID = 'agents-manager'

/**
 * Owner share of a `sidebar.panellist` row: the requested square edge and
 * whether the panel is selected (`SidebarPanelIconOwnerProps`).
 */
interface PanelIconOwnerProps {
  readonly size: number
  readonly active: boolean
}

/** The `main` panel occupant receives the framework runtime share; we use none. */
type MainPanelOwnerProps = Record<never, never>

/** Registration options across the two seats this entry occupies. */
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

/** The client context this plugin's `apply` receives. */
export interface ClientContext {
  readonly slots: ClientSlots
}

/** Cordis client services this entry waits for. */
export const inject = ['slots'] as const

/**
 * Register the "智能体控制" panel: one left-sidebar row beside Plugins
 * (`plugins` is order 0, `schedules` 10 — 5 lands between them) and the central
 * `main` panel that the row selects.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: '智能体控制' },
      AgentControlIcon,
    ),
  )
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, AgentControlPage))
}

/**
 * Decorative sidebar glyph: a three-channel mixer (one knob per channel).
 * Inheriting `currentColor` keeps it on-theme in both rail and wide states.
 */
export function AgentControlIcon({ size }: PanelIconOwnerProps): unknown {
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

/** The page shell: one snapshot read, loading / failure / retry, no domain rules. */
export function AgentControlPage(_props: MainPanelOwnerProps): unknown {
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    createHttpControlClient()
      .snapshot({ signal: controller.signal })
      .then((snapshot) => {
        if (!controller.signal.aborted) setState({ status: 'ready', snapshot })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
        setState({ status: 'error', message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [attempt])

  return h(
    'div',
    { className: 'agents-manager-page', 'data-testid': 'agents-manager-page' },
    h('h1', { className: 'agents-manager-title' }, '智能体控制'),
    renderBody(state, () => setAttempt(attempt + 1)),
  )
}

type PageState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: ControlSnapshot }
  | { readonly status: 'error'; readonly message: string }

function renderBody(state: PageState, retry: () => void): unknown {
  if (state.status === 'loading') {
    return h('p', { className: 'agents-manager-status' }, 'Loading agents…')
  }
  if (state.status === 'error') {
    return h(
      'div',
      { className: 'agents-manager-error', role: 'alert' },
      h('p', null, `Failed to load agents: ${state.message}`),
      h('button', { type: 'button', onClick: retry }, 'Retry'),
    )
  }
  const { snapshot } = state
  return h(
    'div',
    { className: 'agents-manager-ready' },
    h(
      'p',
      { className: 'agents-manager-summary' },
      `${snapshot.agents.length} agents · ${snapshot.models.length} models · ${snapshot.aliases.length} aliases`,
    ),
    h('p', { className: 'agents-manager-findings' }, `${snapshot.findings.length} findings`),
    h('button', { type: 'button', onClick: retry }, 'Reload'),
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
