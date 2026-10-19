/**
 * 列表行的纯派生与视图辅助（chunk 内部模块，无 JSX）。
 *
 * 行派生只做视图级聚合：每 agent 一行，诊断计数从 `snapshot.findings`
 * 里能归到该 agent 的条目按严重度统计；域事实（agent / finding 本体）
 * 全部来自 11 的 ControlSnapshot，这里不重算任何域逻辑。
 *
 * 11 冻结求值器的 AgentRow 只有 errors / hints 两档，原型的 error / hint
 * 语义直接落进去；原型 Finding 的 warning 档在冻结形状里不存在，不臆测。
 */
import type { AgentRow, ControlSnapshot } from '../src/control/index.ts'

/** Agent 定义的冻结形状：从 ControlSnapshot 投影出来，不直接依赖 src/contract。 */
export type AgentDefinition = ControlSnapshot['agents'][number]

/** agent-scan 诊断的码值（同上，从冻结形状投影）。 */
type ScanDiagnosticCode = ControlSnapshot['agentDiagnostics'][number]['code']

/**
 * 「仍可用的标记」码集合：发现模块（src/core/catalog/discovery.ts）把
 * unexpected-id / no-model-order 归为 ADVISORY_CODES——只标记不隐藏；
 * 其余码会让 agent 不可见（或受信根内的硬错误），计为 error。
 * AgentDiagnostic 没有 severity 字段，这里按发现模块自己的分类落档，
 * 与跨层 AliasFinding 自带的 severity 字段汇成同一套计数。
 */
const ADVISORY_SCAN_CODES: ReadonlySet<ScanDiagnosticCode> = new Set<ScanDiagnosticCode>([
  'unexpected-id',
  'no-model-order',
])

/** 把 ControlSnapshot 派生成一行一 agent 的列表行（诊断计数以 agentName 归属）。 */
export function deriveRows(snapshot: ControlSnapshot): AgentRow[] {
  const errors = new Map<string, number>()
  const hints = new Map<string, number>()
  const bump = (counts: Map<string, number>, agentName: string): void => {
    counts.set(agentName, (counts.get(agentName) ?? 0) + 1)
  }
  for (const entry of snapshot.findings) {
    if (entry.origin === 'cross-layer') {
      // cross-layer 的 AliasFinding 自带 severity 与 agentName，按字段直接计。
      const { finding } = entry
      if (finding.agentName !== undefined) bump(finding.severity === 'error' ? errors : hints, finding.agentName)
    } else if (entry.origin === 'agent-scan') {
      const { diagnostic } = entry
      if (diagnostic.agentName !== undefined) {
        bump(ADVISORY_SCAN_CODES.has(diagnostic.code) ? hints : errors, diagnostic.agentName)
      }
    }
    // registry-layer 的 AliasDiagnostic 只针对 layer 文件、没有 agentName，
    // 无法归属到任何 agent 行，跳过（它在快照的其他呈现面单独展示）。
  }
  return snapshot.agents.map((agent) => ({
    agent,
    errors: errors.get(agent.agentName) ?? 0,
    hints: hints.get(agent.agentName) ?? 0,
  }))
}

/* ── 层标签 / 视图辅助（展示词沿用原型 model.ts）────────────────── */

/** UI 展示的层标签：project-* 归 workspace，user-* 归 user（D2：同名 workspace 胜）。 */
export type LayerTag = 'workspace' | 'user' | 'bundled'

export function layerTag(source: AgentDefinition['source']): LayerTag {
  if (source === 'bundled') return 'bundled'
  return source.startsWith('project') ? 'workspace' : 'user'
}

/** 层的完整展示词（tag 的 title 与行的 aria-label 用）。 */
export function layerLabel(source: AgentDefinition['source']): string {
  switch (source) {
    case 'project-dsh':
      return 'workspace · .dsh'
    case 'project-agents':
      return 'workspace · .agents'
    case 'user-dsh':
      return 'user · ~/.dsh'
    case 'user-agents':
      return 'user · ~/.agents'
    case 'bundled':
      return 'bundled'
  }
}

const LAYER_ORDER: Readonly<Record<LayerTag, number>> = { workspace: 0, user: 1, bundled: 2 }

/** 层排序秩，仅作为逻辑列取值；行序由冻结求值器按 source 的层序执行。 */
export function layerRank(source: AgentDefinition['source']): number {
  return LAYER_ORDER[layerTag(source)]
}

/** 显示名：冻结 AgentDefinition.name 已回退到 agentName，无需再兜底。 */
export function displayName(agent: AgentDefinition): string {
  return agent.name
}

/** 模型链长度：别名序 + raw 兜底数组（与冻结求值器的 models 轴同口径）。 */
export function modelCount(agent: AgentDefinition): number {
  return (agent.modelOrder?.length ?? 0) + (agent.model?.length ?? 0)
}
