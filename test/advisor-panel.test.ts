/**
 * 顾问面板的规划渲染（票 04）：通道表来自 `snapshot.assemblies`，不再维护
 * 静态表；缺 key 时显示不可用，lint 与断点高亮也都由规划驱动。
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { planAssembly } from '../src/agent-assembly/index.ts'
import { AdvisorPanel } from '../src/dsh/client/advisor.tsx'

import type {
  AgentDefinition,
  AssemblySession,
  ModelDefinition,
} from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

const ROUTE = { provider: 'deepseek', model: 'deepseek-chat' }

const AGENT: AgentDefinition = {
  agentName: 'atlas',
  name: 'Atlas',
  description: 'code reviewer',
  body: 'You review code.',
  source: 'project-dsh',
  origin: 'user',
  providerId: 'test',
  extra: {},
  path: '/fixtures/atlas/atlas.agent.md',
}

const MODEL: ModelDefinition = {
  modelName: 'chat',
  provider: 'deepseek',
  model: 'deepseek-chat',
  sysPrompt: 'Provider {{provider}} runs {{model}}.',
  available: true,
  source: 'user-dsh',
}

const SESSION: AssemblySession = {
  agent: AGENT,
  parameters: { route: ROUTE, persona: 'You review code.' },
  model: MODEL,
}

function snapshot(assemblies: ControlSnapshot['assemblies']): ControlSnapshot {
  return {
    agents: [AGENT],
    models: [MODEL],
    aliases: [],
    agentDiagnostics: [],
    aliasDiagnostics: [],
    findings: [],
    assemblies,
  }
}

function render(snapshotValue: ControlSnapshot, selectedAgent: string | null): string {
  return renderToStaticMarkup(h(AdvisorPanel, { snapshot: snapshotValue, selectedAgent, onSelectAgent: () => {} }))
}

describe('顾问面板：组装规划', () => {
  it('renders rows, placement and breakpoints from the plan', () => {
    const html = render(snapshot({ atlas: planAssembly(SESSION) }), 'atlas')

    expect(html).toContain('组装规划器输出')
    expect(html).toContain('atelier:model-sys')
    expect(html).toContain('deployment:persona-prefix')
    expect(html).toContain('order -500')
    // The selected switch is agent, whose breakpoint is the persona row.
    expect(html).toContain('<tr class="bp">')
    expect(html).toContain('bp-mark')
  })

  it('does not fall back to the old static channel table', () => {
    const html = render(snapshot({ atlas: planAssembly(SESSION) }), 'atlas')

    expect(html).not.toContain('sha256 pre-step 门控')
    expect(html).not.toContain('spec §6 通道表，静态')
  })

  it('renders the planner lint findings', () => {
    const plan = planAssembly(SESSION, {
      sectionOrder: ['deployment:persona-prefix', 'atelier:model-sys'],
    })
    const html = render(snapshot({ atlas: plan }), 'atlas')

    expect(html).toContain('volatile-before-stable')
    expect(html).toContain('atelier:model-sys')
    expect(html).toContain('顺序 lint')
  })

  it('shows an unavailable row when the selected agent has no plan', () => {
    const html = render(snapshot({}), 'atlas')

    expect(html).toContain('模型链无法解析，或组装服务未挂载')
    expect(html).not.toContain('channel:tools')
  })
})
