/**
 * 顾问面板（票 05，Q2 裁决的最小口径，从 prototype AdvisorPanel/model/fixtures 移植）：
 * ① snapshot.findings 按家族分组呈现（分组映射写死，不做二次合并）
 * ② 通道表与断点推演改为渲染 `snapshot.assemblies` 的规划器输出（票 04）：
 *    节序、变维度、断点与 lint 全部来自服务端规划，客户端不做第二次推导
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
  /** 快照所属的工作空间名（票 37）；缺省时头部不显示范围行。 */
  readonly workspaceTitle?: string | undefined
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

/* ── 组装规划视图（票 04：服务端计划是唯一来源） ───────────────── */

/** 快照携带的一个 Agent 规划（缺 key = 模型链不可解析或组装服务未挂载）。 */
type SnapshotPlan = NonNullable<ControlSnapshot['assemblies'][string]>
type SnapshotSection = SnapshotPlan['sections'][number]
type SnapshotDimension = SnapshotPlan['breakpoints'][number]['dimension']

/** 已知节的中文说明；规划新增的节回落到原始节名。 */
const SECTION_LABEL: Readonly<Record<string, string>> = {
  'atelier:model-sys': 'per-model 系统提示词',
  'channel:tools': 'mode 工具集',
  'deployment:persona-prefix': 'persona',
  'atelier:skills': '预置技能（skills）',
  'channel:digest': 'agent/别名目录',
  'channel:first-message': 'brief',
  'channel:pre-step': 'compaction / 提醒',
}

const DIMENSION_LABEL: Readonly<Record<SnapshotDimension, string>> = {
  model: '切模型在此断',
  agent: '切 Agent 在此断',
  registry: '注册表变 → digest 变 → 发新消息',
  tools: '工具集变化在此断',
}

/** 某节最初依赖的维度（规划里只有第一个依赖行算断点）；天然尾巴为空。 */
function breakpointDimensions(plan: SnapshotPlan): ReadonlyMap<string, readonly SnapshotDimension[]> {
  const bySection = new Map<string, SnapshotDimension[]>()
  for (const breakpoint of plan.breakpoints) {
    const found = bySection.get(breakpoint.section)
    if (found === undefined) bySection.set(breakpoint.section, [breakpoint.dimension])
    else found.push(breakpoint.dimension)
  }
  return bySection
}

/** 一行里展示的变维度；没有则说明它是天然尾巴。 */
function sectionDependencies(section: SnapshotSection): string {
  return section.variesWith.length === 0 ? '无（天然尾巴）' : section.variesWith.join(' / ')
}

export function AdvisorPanel(props: AdvisorPanelProps): ReactNode {
  const { snapshot } = props
  const [switchKind, setSwitchKind] = useState<'agent' | 'model'>('agent')
  const [aliasDraft, setAliasDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')

  /* ── ② 选中 Agent 的组装规划（缺 key 即不可用，不编造） ── */
  const plan = props.selectedAgent === null ? undefined : snapshot.assemblies[props.selectedAgent]

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
    props.workspaceTitle !== undefined && h('div', { className: 'advisor-scope dim' }, `工作空间：${props.workspaceTitle}`),

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

    /* ② 组装规划 + 断点推演（票 04：服务端计划是唯一来源） */
    h('section', { className: 'advisor-sec' },
      h('h4', null, '缓存断点推演 ', h('span', { className: 'dim' }, '（组装规划器输出）')),
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
      plan === undefined
        ? h('div', { className: 'dim' }, '模型链无法解析，或组装服务未挂载；该 Agent 当前不可召唤，没有可渲染的规划。')
        : renderAssemblyPlan(plan, switchKind),
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
        h('p', null, h('span', { className: 'tag tag-ok' }, '推荐'), ' 按「最可能的断点最晚」排序；换档发生在 persona 之后，前面的公共前缀（model-sys 等）保住。'),
        h('p', null, h('b', null, '插值边界：'), '模型条目的 ', h('code', null, 'sysPrompt'), ' 只代入 ', h('code', null, '{{provider}}'), ' / ', h('code', null, '{{model}}'), '；其他 ', h('code', null, '{{...}}'), ' 以 ', h('code', null, 'interpolate: false'), ' 保持字面。persona 保留宿主原生插值。')),

      h('h4', null, 'DSH 原生行为 ', h('span', { className: 'dim' }, '（不在本插件规划内）')),
      h('div', { className: 'card kb-card' },
        h('p', null, 'AGENTS.md 作为 unfiltered 上下文按 change 门控；compaction / 提醒走 pre-step 通道。它们由宿主管理，规划器只建模锚点、不接管其行为。'))),

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
 * 规划表：节序、变维度、断点与 lint 全部来自服务端计划。
 * 高亮由 `plan.breakpoints` 查得，客户端不另算「什么变化会断」。
 */
function renderAssemblyPlan(
  plan: SnapshotPlan,
  switchKind: 'agent' | 'model',
): ReactNode {
  const breakpointsBySection = breakpointDimensions(plan)
  const switchBreakpoint = plan.breakpoints.find((breakpoint) => breakpoint.dimension === switchKind)
  const switchLabel = switchKind === 'agent' ? '切 Agent' : '切模型'
  return h('div', null,
    h('table', { className: 'channel-table' },
      h('thead', null, h('tr', null,
        h('th', null, '内容'),
        h('th', null, '通道'),
        h('th', null, '放置'),
        h('th', null, '变维度'),
        h('th', null, '断点'))),
      h('tbody', null,
        plan.sections.map((section, index) => {
          const broken = switchBreakpoint?.section === section.name && switchBreakpoint.channel === section.channel
          const breakpoints = breakpointsBySection?.get(section.name) ?? []
          return h('tr', { key: `${section.channel}-${section.name}-${index}`, className: broken ? 'bp' : undefined },
            h('td', null,
              SECTION_LABEL[section.name] ?? section.name,
              h('span', { className: 'dim' }, ` ${section.name}`),
              broken && h('span', { className: 'bp-mark', title: DIMENSION_LABEL[switchKind] }, '⚡')),
            h('td', { className: 'dim' }, section.channel),
            h('td', { className: 'dim' }, section.channel === 'system'
              ? `${section.executable ? '注册' : '锚点'} · order ${section.order}`
              : '计划数组'),
            h('td', { className: 'dim' }, sectionDependencies(section)),
            h('td', { className: 'dim' }, breakpoints.length === 0
              ? '—'
              : breakpoints.map((dimension) => DIMENSION_LABEL[dimension]).join(' / ')))
        }))),
    switchBreakpoint === undefined
      && h('p', { className: 'dim advisor-note' }, `当前规划没有「${switchLabel}」断点。`),
    h('h4', null, '顺序 lint ', h('span', { className: 'dim' }, `${plan.lints.length} 条`)),
    plan.lints.length === 0
      ? h('div', { className: 'dim' }, '无顺序反模式。')
      : plan.lints.map((lint, index) => h('div', { key: `${lint.code}-${index}`, className: 'finding hint' },
          h('span', { className: 'tag tag-warn' }, lint.code),
          h('span', { className: 'finding-msg' }, lint.message))),
    h('p', { className: 'dim advisor-note' },
      '推荐顺序 = 缓存分层（D10）：model-sys → tools → persona → skills → digest → 首消息 → pre-step。'))
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
