/**
 * Browser half of ticket 12: the `settings.section` page shell with loading /
 * failure / retry, registered through `ctx.slots`. The HTTP control client it
 * consumes lives in `src/control/http-client.ts` (Node-free), so the in-memory
 * and HTTP adapters share one contract suite.
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

/** Structural slice of the settings page owner props this entry receives. */
interface SettingsSectionOwnerProps {
  readonly close: () => void
}

interface ClientSlots {
  inject(name: string, register: () => () => void): void
  register(
    options: {
      readonly name: 'settings.section'
      readonly id: string
      readonly order?: number | undefined
      readonly label?: string | undefined
    },
    component: (props: SettingsSectionOwnerProps) => unknown,
  ): () => void
}

/** The client context this plugin's `apply` receives. */
export interface ClientContext {
  readonly slots: ClientSlots
}

/** Cordis client services this entry waits for. */
export const inject = ['slots'] as const

/** Register the Agents Manager page in the settings dialog. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'agents-manager', order: 40, label: 'Agents Manager' },
      SettingsPage,
    ),
  )
}

/** The page shell: one snapshot read, loading / failure / retry, no domain rules. */
export function SettingsPage(_props: SettingsSectionOwnerProps): unknown {
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
    h('h2', { className: 'agents-manager-title' }, 'Agents Manager'),
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
