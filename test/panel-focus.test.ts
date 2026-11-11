/**
 * 跨页聚焦通道的纯规则（票 60）：路由、智能体落点与「不丢目标」。
 *
 * 页内定位（滚动 / 高亮 / 切合并空间）归目的页（#63 / #68），这里只钉死
 * 壳层能回答的事：目标该去哪个页签、智能体是否真的在快照里。
 */
import { describe, expect, it } from 'vitest'

import { focusedAgentName, panelTabOfFocus, routeFocusRequest } from '../src/dsh/client/panel-focus.ts'

import type { PanelFocus } from '../src/dsh/client/chunk-contracts.ts'
import type { AgentDefinition } from '../src/contract/index.ts'
import type { ControlSnapshot } from '../src/control/index.ts'

const AGENT: AgentDefinition = {
  agentName: 'fast-agent',
  name: 'Fast Agent',
  description: '',
  body: '',
  source: 'user-dsh',
  origin: 'user',
  providerId: 'fs',
  extra: {},
  path: '/home/u/.dsh/agents/fast-agent/fast-agent.agent.md',
}

function snapshotWithAgents(agents: readonly AgentDefinition[]): ControlSnapshot {
  return {
    agents,
    models: [],
    aliases: [],
    registryLayers: [],
    agentDiagnostics: [],
    aliasDiagnostics: [],
    findings: [],
    assemblies: {},
    scope: { cwd: null, projectRoot: null },
  }
}

describe('跨页聚焦路由', () => {
  const model: PanelFocus = { kind: 'model', name: 'fast' }
  const alias: PanelFocus = { kind: 'alias', name: 'fast-alias' }
  const agent: PanelFocus = { kind: 'agent', name: 'fast-agent' }

  it('默认：模型 → 提示词页、别名 → 模型关联页、智能体 → 智能体列表', () => {
    expect(panelTabOfFocus(model)).toBe('prompts')
    expect(panelTabOfFocus(alias)).toBe('models')
    expect(panelTabOfFocus(agent)).toBe('agents')
  })

  it('模型目标可显式落模型关联页（新建模型后的聚焦）', () => {
    expect(panelTabOfFocus(model, 'models')).toBe('models')
    expect(panelTabOfFocus(model, 'prompts')).toBe('prompts')
  })

  it('智能体目标永远是智能体列表，destination 不参与', () => {
    expect(panelTabOfFocus(agent, 'models')).toBe('agents')
    expect(panelTabOfFocus(agent, 'prompts')).toBe('agents')
  })
})

describe('跳转结果（页面只照做不判断）', () => {
  const snapshot = snapshotWithAgents([AGENT])

  it('模型目标挂起到提示词页，待消费后才清空', () => {
    const focus: PanelFocus = { kind: 'model', name: 'fast', source: 'project-dsh' }
    expect(routeFocusRequest(focus, undefined, snapshot)).toEqual({
      tab: 'prompts',
      selection: null,
      pending: { destination: 'prompts', focus },
    })
  })

  it('模型显式落模型关联页；别名默认落模型关联页', () => {
    const model: PanelFocus = { kind: 'model', name: 'fast' }
    expect(routeFocusRequest(model, 'models', snapshot).pending).toEqual({ destination: 'models', focus: model })
    const alias: PanelFocus = { kind: 'alias', name: 'fast-alias' }
    expect(routeFocusRequest(alias, undefined, snapshot).pending).toEqual({ destination: 'models', focus: alias })
  })

  it('智能体目标当场消费：在快照里就选中，不在就只切页签', () => {
    expect(routeFocusRequest({ kind: 'agent', name: 'fast-agent' }, undefined, snapshot)).toEqual({
      tab: 'agents',
      selection: 'fast-agent',
      pending: null,
    })
    expect(routeFocusRequest({ kind: 'agent', name: 'missing-agent' }, 'models', snapshot)).toEqual({
      tab: 'agents',
      selection: null,
      pending: null,
    })
  })
})

describe('智能体落点', () => {
  const snapshot = snapshotWithAgents([AGENT])

  it('目标在快照里才选中；不在时只切页签，不假装列表里有它', () => {
    expect(focusedAgentName({ kind: 'agent', name: 'fast-agent' }, snapshot)).toBe('fast-agent')
    expect(focusedAgentName({ kind: 'agent', name: 'missing-agent' }, snapshot)).toBeNull()
  })

  it('模型 / 别名目标不由壳层解析（目的页按自己的空间定位）', () => {
    expect(focusedAgentName({ kind: 'model', name: 'fast-agent' }, snapshot)).toBeNull()
    expect(focusedAgentName({ kind: 'alias', name: 'fast-agent' }, snapshot)).toBeNull()
  })
})
