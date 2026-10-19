/**
 * The agent list's single query evaluator (ticket 11): the view's filter and
 * sort configuration compiles into one {@link AgentListQuery} and this module
 * is the only place that interprets it — the same rows a test asserts are the
 * rows the table renders.
 *
 * Issue weights follow the prototype's formula (`errors * 10 + hints`), which
 * used to be rewritten inline by the list it now serves.
 */
import type { AgentDefinition, AgentSource } from '../contract/index.ts'
import type { AgentListQuery, AgentRow } from './types.ts'

/** Discovery-root precedence order, used by the `layer` sort. */
const LAYER_ORDER: Readonly<Record<AgentSource, number>> = {
  'project-dsh': 0,
  'project-agents': 1,
  'user-dsh': 2,
  'user-agents': 3,
  bundled: 4,
}

/** Evaluate one query against the rows: filter first, then sort. Stable on ties. */
export function evaluateAgentQuery(rows: readonly AgentRow[], query: AgentListQuery): readonly AgentRow[] {
  let result = rows
  if (query.layer !== undefined) result = result.filter((row) => layerOf(row.agent.source) === query.layer)
  const text = query.text?.trim().toLowerCase() ?? ''
  if (text !== '') result = result.filter((row) => haystack(row.agent).includes(text))
  if (query.onlyIssues === true) result = result.filter((row) => row.errors + row.hints > 0)
  const direction = query.direction === 'desc' ? -1 : 1
  const sort = query.sort ?? 'name'
  return [...result].sort((left, right) => {
    const bySort = compareBySort(sort, left, right) * direction
    if (bySort !== 0) return bySort
    return left.agent.agentName.localeCompare(right.agent.agentName)
  })
}

/** Compare two rows on the requested axis. */
function compareBySort(sort: NonNullable<AgentListQuery['sort']>, left: AgentRow, right: AgentRow): number {
  switch (sort) {
    case 'name':
      return left.agent.agentName.localeCompare(right.agent.agentName)
    case 'layer':
      return LAYER_ORDER[left.agent.source] - LAYER_ORDER[right.agent.source]
    case 'issues':
      return issueWeight(left) - issueWeight(right)
    case 'models':
      return chainSize(left.agent) - chainSize(right.agent)
  }
}

/** `errors` weigh ten hints: the formula the prototype's list used. */
function issueWeight(row: AgentRow): number {
  return row.errors * 10 + row.hints
}

/** Size of the agent's model chain: the alias order plus the legacy chain. */
function chainSize(agent: AgentDefinition): number {
  return (agent.modelOrder?.length ?? 0) + (agent.model?.length ?? 0)
}

/** Which list layer a discovery root belongs to. */
function layerOf(source: AgentSource): NonNullable<AgentListQuery['layer']> {
  if (source.startsWith('project')) return 'project'
  if (source.startsWith('user')) return 'user'
  return 'bundled'
}

/** The lowercase haystack a text filter matches against. */
function haystack(agent: AgentDefinition): string {
  return `${agent.agentName}\n${agent.name}\n${agent.description}`.toLowerCase()
}
