/**
 * 顾问面板（票 05，Q2 裁决的最小口径，从 prototype AdvisorPanel/model/fixtures 移植）：
 * ① snapshot.findings 按家族分组呈现（分组映射写死，不做二次合并）
 * ② §6 通道表 + 断点推演（静态表驱动：切 Agent / 切模型高亮断点行）
 * ③ S5 别名重映射即时影响预览（纯客户端按快照推导；注册表写属票 14，此处不做任何写操作）
 * ④ fork 断点知识库 + 顺序反模式（静态条目）
 * ⑤ requiredTools/skills 声明清单（wire 契约没有已知工具/技能集，不自行核验）
 *
 * 诊断非阻挡：发现是解读与建议，不是门禁。这里只做「对快照数据的视图级派生」，
 * 不重新实现 compose/resolve/写路径（别名→条目的生效查找仅为预览所需的最小投影）。
 */
import { createElement as h, useState } from 'react'
import type { ChangeEvent as ReactChangeEvent, ReactNode } from 'react'
import type { ControlFinding, ControlSnapshot } from '../../control/index.ts'

/** 快照携带的别名 / 模型条目形状（经索引访问取得，不越层引 contract）。 */
type SnapshotAlias = ControlSnapshot['aliases'][number]
type SnapshotModel = ControlSnapshot['models'][number]

/** cross-layer 家族的发现形状（判别联合收窄）。 */
type CrossLayerItem = Extract<ControlFinding, { readonly origin: 'cross-layer' }>
type AgentScanItem = Extract<ControlFinding, { readonly origin: 'agent-scan' }>
type RegistryLayerItem = Extract<ControlFinding, { readonly origin: 'registry-layer' }>

export interface AdvisorPanelProps {
  readonly snapshot: ControlSnapshot
  /** 当前选中的 agent（通道表的选择器与发现的「打开」跳转用）；可为 null。 */
  readonly selectedAgent: string | null
  /** 跳转选中某个 agent。 */
  onSelectAgent(agentName: string): void
}

/* ── 生效条目查找（视图级最小投影：同名按层取低 rank） ─────────────── */

const REGISTRY_RANK: Record<SnapshotAlias['source'], number> = {
  'project-dsh': 0,
  'user-dsh': 1,
  'built-in': 2,
}

/** 同名别名取低 rank 层的生效版本（注入名不变，命中随层变化）。 */
function resolveEffectiveAlias(name: string, aliases: readonly SnapshotAlias[]): SnapshotAlias | undefined {
  let best: SnapshotAlias | undefined
  for (const a of aliases) {
    if (a.alias === name && (best === undefined || REGISTRY_RANK[a.source] < REGISTRY_RANK[best.source])) best = a
  }
  return best
}

/** 同名模型条目取低 rank 层的生效版本。 */
function resolveEffectiveModel(name: string, models: readonly SnapshotModel[]): SnapshotModel | undefined {
  let best: SnapshotModel | undefined
  for (const m of models) {
    if (m.modelName === name && (best === undefined || REGISTRY_RANK[m.source] < REGISTRY_RANK[best.source])) best = m
  }
  return best
}

/* ── §6 通道表（静态数据，照搬原型 fixtures/model） ───────────────── */

type BreakOn = 'model' | 'agent' | 'registry' | 'tools' | 'never' | 'native'

interface ChannelRow {
  readonly content: string
  readonly channel: string
  readonly mechanism: string
  /** 什么变化会在此打断前缀缓存。 */
  readonly breakOn: BreakOn
}

const CHANNEL_TABLE: readonly ChannelRow[] = [
  { content: 'per-model 系统提示词', channel: '① system 节', mechanism: 'section order 低于 persona（在 persona 之前）', breakOn: 'model' },
  { content: 'persona', channel: '① system 节', mechanism: 'deployment:persona-prefix（order 0）', breakOn: 'agent' },
  { content: '预置技能（skills）', channel: '待定（04/07）', mechanism: '按名引用原生 skills 注册表', breakOn: 'agent' },
  { content: 'mode 工具集', channel: '④ tools 字段', mechanism: 'toolFilter → ctx.tools.restrict', breakOn: 'tools' },
  { content: 'agent/别名目录', channel: '② digest 门控 user 消息', mechanism: 'sha256 pre-step 门控（不变不发）', breakOn: 'registry' },
  { content: 'AGENTS.md', channel: '②（DSH 原生）', mechanism: 'unfiltered，change 门控', breakOn: 'native' },
  { content: 'brief', channel: '⑤ 首条消息', mechanism: 'SubagentStartRequest.prompt', breakOn: 'never' },
  { content: 'compaction / 提醒', channel: '③ pre-step', mechanism: 'DSH 原生', breakOn: 'native' },
]

const BREAK_LABEL: Record<BreakOn, string> = {
  model: '切模型在此断',
  agent: '切 Agent 在此断',
  registry: '注册表变 → digest 变 → 发新消息',
  tools: '工具集变化在此断',
  never: '天然尾巴（不影响前缀）',
  native: 'DSH 原生行为（不可控）',
}

export function AdvisorPanel(props: AdvisorPanelProps): ReactNode {
  const { snapshot } = props
  const [switchKind, setSwitchKind] = useState<'agent' | 'model'>('agent')
  const [aliasDraft, setAliasDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')

  /* ── ① findings 按家族分组（映射写死） ── */
  const crossLayer = snapshot.findings.filter((f): f is CrossLayerItem => f.origin === 'cross-layer')
  const agentScan = snapshot.findings.filter((f): f is AgentScanItem => f.origin === 'agent-scan')
  const registryLayer = snapshot.findings.filter((f): f is RegistryLayerItem => f.origin === 'registry-layer')
  const crossErrors = crossLayer.filter((f) => f.finding.severity === 'error').length
  const crossHints = crossLayer.length - crossErrors

  /* ── ③ S5 预览：生效别名 / 模型名单（不含内置指针） ── */
  const userAliases = [...new Set(snapshot.aliases.map((a) => a.alias))]
    .map((name) => resolveEffectiveAlias(name, snapshot.aliases))
    .filter((a): a is SnapshotAlias => a !== undefined && a.source !== 'built-in')
  const modelOptions = [...new Set(snapshot.models.map((m) => m.modelName))]
    .map((name) => resolveEffectiveModel(name, snapshot.models))
    .filter((m): m is SnapshotModel => m !== undefined)

  const aliasDef = userAliases.find((a) => a.alias === aliasDraft) ?? userAliases[0]
  const aliasName = aliasDef?.alias ?? ''
  const currentTarget = aliasDef?.targets[0] ?? ''
  // 目标草案失效（快照刷新后不在名单里）时回落到当前目标。
  const targetName = modelOptions.some((m) => m.modelName === targetDraft) ? targetDraft : currentTarget

  const before = aliasDef !== undefined ? resolveEffectiveModel(currentTarget, snapshot.models) : undefined
  const after = resolveEffectiveModel(targetName, snapshot.models)
  const affectedAgents = aliasName === ''
    ? []
    : snapshot.agents
      .filter((a) => (a.modelOrder ?? []).includes(aliasName))
      .map((a) => a.agentName)
  const impactVisible = aliasName !== '' && targetName !== ''

  /* ── ⑤ requiredTools/skills 声明清单 ── */
  const declaringAgents = snapshot.agents.filter(
    (a) => (a.requiredTools?.length ?? 0) > 0 || (a.skills?.length ?? 0) > 0,
  )

  return h('div', { className: 'advisor' },
    h('h3', { className: 'advisor-title' }, '顾问面板 ', h('span', { className: 'dim' }, '（诊断非阻挡 · 建议不是门禁）')),

    /* ① 校验发现：三个家族各自成组，分组映射写死 */
    h('section', { className: 'advisor-sec' },
      h('h4', null,
        '跨层校验 ',
        h('span', { className: 'dim' }, `${crossErrors} error / ${crossHints} hint`),
        h('span', { className: 'dim' }, '（unknown-alias / unknown-model-target / raw-model-escape / alias-fan-in）')),
      crossLayer.length === 0 && h('div', { className: 'dim' }, '无发现。'),
      crossLayer.map((item, i) => renderFindingRow(
        `${item.finding.code}-${i}`,
        item.finding.code,
        item.finding.severity,
        item.finding.message,
        item.finding.agentName,
        props.onSelectAgent,
      ))),

    h('section', { className: 'advisor-sec' },
      h('h4', null, 'agent 扫描诊断 ', h('span', { className: 'dim' }, `${agentScan.length} 条`)),
      agentScan.length === 0 && h('div', { className: 'dim' }, '无发现。'),
      agentScan.map((item, i) => renderFindingRow(
        `agent-scan-${i}`,
        item.diagnostic.code,
        undefined,
        item.diagnostic.message,
        item.diagnostic.agentName,
        props.onSelectAgent,
      ))),

    h('section', { className: 'advisor-sec' },
      h('h4', null, 'registry 层诊断 ', h('span', { className: 'dim' }, `${registryLayer.length} 条`)),
      registryLayer.length === 0 && h('div', { className: 'dim' }, '无发现。'),
      registryLayer.map((item, i) => renderFindingRow(
        `registry-layer-${i}`,
        item.diagnostic.code,
        undefined,
        item.diagnostic.message,
        undefined,
        props.onSelectAgent,
      ))),

    /* ② §6 通道表 + 断点推演（静态表驱动） */
    h('section', { className: 'advisor-sec' },
      h('h4', null, '缓存断点推演 ', h('span', { className: 'dim' }, '（spec §6 通道表，静态）')),
      h('div', { className: 'bp-controls' },
        h('span', { className: 'dim' }, '当前'),
        h('select',
          {
            className: 'select',
            value: props.selectedAgent ?? '',
            onChange: (e: ReactChangeEvent<HTMLSelectElement>) => props.onSelectAgent(e.target.value),
          },
          props.selectedAgent === null && h('option', { value: '' }, '（未选择）'),
          snapshot.agents.map((a) => h('option', { key: a.agentName, value: a.agentName }, a.agentName))),
        h('span', { className: 'editor-spacer' }),
        h('button',
          { type: 'button', className: `btn btn-sm${switchKind === 'agent' ? ' btn-primary' : ''}`, onClick: () => setSwitchKind('agent') },
          '切 Agent'),
        h('button',
          { type: 'button', className: `btn btn-sm${switchKind === 'model' ? ' btn-primary' : ''}`, onClick: () => setSwitchKind('model') },
          '切模型')),
      h('table', { className: 'channel-table' },
        h('thead', null, h('tr', null, h('th', null, '内容'), h('th', null, '通道'), h('th', null, '机制'), h('th', null, '断点'))),
        h('tbody', null,
          CHANNEL_TABLE.map((row, i) => {
            const broken = row.breakOn === switchKind
            return h('tr', { key: i, className: broken ? 'bp' : undefined },
              h('td', null, row.content, broken && h('span', { className: 'bp-mark', title: BREAK_LABEL[row.breakOn] }, '⚡')),
              h('td', { className: 'dim' }, row.channel),
              h('td', { className: 'dim' }, row.mechanism),
              h('td', { className: 'dim' }, BREAK_LABEL[row.breakOn]))
          }))),
      h('p', { className: 'dim advisor-note' }, '推荐别名顺序 = 最可能的断点最晚（D10）。例：smart→fast 把换档断点推到 persona 之后尽可能晚的位置。')),

    /* ③ S5 别名重映射 · 即时影响预览（纯预览，无写操作——注册表写属票 14） */
    h('section', { className: 'advisor-sec' },
      h('h4', null, 'S5 别名重映射 · 即时影响预览'),
      h('div', { className: 'bp-controls' },
        h('select',
          {
            className: 'select',
            value: aliasName,
            onChange: (e: ReactChangeEvent<HTMLSelectElement>) => {
              setAliasDraft(e.target.value)
              const next = userAliases.find((a) => a.alias === e.target.value)
              setTargetDraft(next?.targets[0] ?? '')
            },
          },
          userAliases.length === 0 && h('option', { value: '' }, '（无可用别名）'),
          userAliases.map((a) => h('option', { key: a.alias, value: a.alias }, a.alias))),
        h('span', { className: 'dim' }, '→'),
        h('select',
          {
            className: 'select',
            value: targetName,
            onChange: (e: ReactChangeEvent<HTMLSelectElement>) => setTargetDraft(e.target.value),
          },
          modelOptions.map((m) => h('option', { key: m.modelName, value: m.modelName }, m.modelName)))),
      impactVisible && h('div', { className: 'card impact-card' },
        h('div', null, '注入名 ', h('code', null, aliasName), ' ', h('b', null, '不变'), '（registry-order 契约不暴露实际模型名）'),
        h('div', null,
          '实际命中：',
          before !== undefined ? `${before.provider}/${before.model}` : '（无）',
          ' → ',
          h('b', null, after !== undefined ? `${after.provider}/${after.model}` : '?'),
          after !== undefined && !after.available && h('span', { className: 'dim' }, '（该条目 available: false，解析时会跳过）')),
        h('div', null,
          '受影响 agent：',
          affectedAgents.length > 0
            ? affectedAgents.map((name) => h('button',
                { key: name, type: 'button', className: 'btn btn-sm', onClick: () => props.onSelectAgent(name) }, name))
            : h('span', { className: 'dim' }, '无')),
        h('div', { className: 'dim' }, '重映射落盘（registry 写）属票 14：此处仅预览，不做任何写操作。'))),

    /* ④ fork 断点知识库（静态条目） */
    h('section', { className: 'advisor-sec' },
      h('h4', null, 'fork 断点知识库 ', h('span', { className: 'dim' }, '（spec §2.1–§2.4）')),
      h('div', { className: 'card kb-card' },
        h('p', null, h('b', null, 'fork ≠ 缓存延续。'), 'fork 继承的是父会话的', h('b', null, '前缀消息史'), '（重放），但子代理的 system 头由子的组装器', h('b', null, '重新生成'), '——前缀缓存从头部就断了。'),
        h('p', null, 'fork 省的是「组装」（不用重述上下文），不是「缓存」。选 spawn/fork 时别拿缓存当理由。')),

      h('h4', null, '顺序反模式 ', h('span', { className: 'dim' }, '（D10）')),
      h('div', { className: 'card kb-card' },
        h('p', null, h('span', { className: 'tag tag-err' }, '反例'), ' 把最稳的别名放最前：每次换档都在最早位置断，长任务反复重建前缀。'),
        h('p', null, h('span', { className: 'tag tag-ok' }, '推荐'), ' 按「最可能的断点最晚」排序；换档发生在 persona 之后，前面的公共前缀（model-sys 等）保住。'))),

    /* ⑤ requiredTools/skills 声明清单（不核验——06 接入后核验） */
    h('section', { className: 'advisor-sec' },
      h('h4', null, 'requiredTools / skills 声明清单'),
      declaringAgents.length === 0 && h('div', { className: 'dim' }, '没有 agent 声明工具或技能。'),
      declaringAgents.map((agent) => h('div', { key: agent.agentName, className: 'card kb-card declare-card' },
        h('p', null, h('b', null, agent.name === '' ? agent.agentName : agent.name), h('span', { className: 'dim' }, `（${agent.agentName}）`)),
        (agent.requiredTools?.length ?? 0) > 0 && h('p', null,
          h('span', { className: 'dim' }, 'requiredTools：'),
          agent.requiredTools?.map((tool) => h('code', { key: tool, className: 'declare-item' }, tool))),
        (agent.skills?.length ?? 0) > 0 && h('p', null,
          h('span', { className: 'dim' }, 'skills：'),
          agent.skills?.map((skill) => h('code', { key: skill, className: 'declare-item' }, skill))))),
      h('p', { className: 'dim advisor-note' }, 'wire 契约没有已知工具/技能集，这里只呈现声明、不自行核验；「06 接入后核验」——工具集交集（D9）与预置技能存在性（D20）由票 06 的警告通道提供。')),
  )
}

/**
 * 单条发现行：code 徽标 + 文案 +（可跳转时）打开按钮。
 * cross-layer 携带 severity（error/hint）；agent-scan 与 registry-layer 的诊断
 * 没有严重度字段，用中性徽标呈现。
 */
function renderFindingRow(
  key: string,
  code: string,
  severity: 'error' | 'hint' | undefined,
  message: string,
  agentName: string | undefined,
  onSelectAgent: (agentName: string) => void,
): ReactNode {
  const tagClass = severity === 'error' ? 'tag tag-err' : severity === 'hint' ? 'tag tag-warn' : 'tag'
  return h('div', { key, className: `finding ${severity ?? 'info'}` },
    h('span', { className: tagClass }, code),
    h('span', { className: 'finding-msg' }, message),
    agentName !== undefined && agentName !== ''
      && h('button', { type: 'button', className: 'btn btn-sm', onClick: () => onSelectAgent(agentName) }, '打开'))
}
