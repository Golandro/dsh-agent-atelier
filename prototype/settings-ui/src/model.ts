/**
 * PROTOTYPE — 纯函数：组合文档、校验（02 四类 + 警告项）、解析链、断点推演、保存回写。
 * 全部是数据进数据出，不碰 DOM；正式实现时这些函数的对应物住宿主侧（01/02 读面 + 05 写器）。
 */
import type {
  AgentDoc,
  AgentListQuery,
  AgentSource,
  AliasDef,
  ChannelRow,
  ComposedDocument,
  ComposedRow,
  DocBlock,
  Finding,
  FileWrite,
  LayerTag,
  ModelDef,
  PromptClip,
} from './types'

/* ── 层 ─────────────────────────────────────────────────────────── */

const SOURCE_RANK: Record<AgentSource, number> = {
  'project-dsh': 100,
  'project-agents': 200,
  'user-dsh': 300,
  'user-agents': 400,
  'bundled': 600,
}

export function layerTag(source: AgentSource): LayerTag {
  if (source === 'bundled') return 'bundled'
  return source.startsWith('project') ? 'workspace' : 'user'
}

export function layerLabel(source: AgentSource): string {
  switch (source) {
    case 'project-dsh': return 'workspace · .dsh'
    case 'project-agents': return 'workspace · .agents'
    case 'user-dsh': return 'user · ~/.dsh'
    case 'user-agents': return 'user · ~/.agents'
    case 'bundled': return 'bundled'
  }
}

/* ── Agent List 查询（接口 + 简单实现）──────────────────────────── */

export interface AgentListRow {
  agent: AgentDoc
  errs: number
  hints: number
}

const LAYER_ORDER: Record<LayerTag, number> = { workspace: 0, user: 1, bundled: 2 }

const displayName = (agent: AgentDoc) => agent.frontmatter.name ?? agent.agentName

const modelCount = (agent: AgentDoc) =>
  (agent.frontmatter.modelOrder?.length ?? 0) + (agent.frontmatter.model?.length ?? 0)

/** 先做接口：文本 / 层 / 仅问题过滤 + 名称 / 层级 / 诊断 / 模型数排序。 */
export function queryAgents(agents: AgentDoc[], findings: Finding[], query: AgentListQuery): AgentListRow[] {
  const text = query.text.trim().toLowerCase()
  const rows: AgentListRow[] = agents
    .map((agent) => {
      const own = findings.filter((f) => f.agentName === agent.agentName)
      return {
        agent,
        errs: own.filter((f) => f.severity === 'error').length,
        hints: own.filter((f) => f.severity === 'hint').length,
      }
    })
    .filter(({ agent, errs, hints }) => {
      if (query.layer !== 'all' && layerTag(agent.source) !== query.layer) return false
      if (query.onlyIssues && errs + hints === 0) return false
      if (!text) return true
      const haystack = [
        agent.agentName,
        agent.frontmatter.name,
        agent.frontmatter.description,
        agent.path,
        ...(agent.frontmatter.modelOrder ?? []),
        ...(agent.frontmatter.model ?? []).map((m) => `${m.provider}/${m.model}`),
        ...(agent.frontmatter.requiredTools ?? []),
        ...(agent.frontmatter.skills ?? []),
        ...Object.entries(agent.extra).flatMap(([k, v]) => [k, v]),
      ]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ')
        .toLowerCase()
      return haystack.includes(text)
    })

  const direction = query.direction === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    switch (query.sort) {
      case 'name':
        return direction * displayName(a.agent).localeCompare(displayName(b.agent), 'zh-CN')
      case 'layer':
        return direction * (LAYER_ORDER[layerTag(a.agent.source)] - LAYER_ORDER[layerTag(b.agent.source)])
      case 'diagnostics':
        return direction * ((a.errs * 10 + a.hints) - (b.errs * 10 + b.hints))
      case 'models':
        return direction * (modelCount(a.agent) - modelCount(b.agent))
    }
  })
  return rows
}

/** 同名 clip 取低 rank 层（D2：workspace 胜 user） */
export function resolveClip(name: string, clips: PromptClip[]): PromptClip | undefined {
  return clips
    .filter((c) => c.name === name)
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source])[0]
}

/** 被多层同名遮蔽的 clip 名 → 层数（>1 才有遮蔽） */
export function shadowedClipNames(clips: PromptClip[]): Map<string, number> {
  const byName = new Map<string, number>()
  for (const c of clips) byName.set(c.name, (byName.get(c.name) ?? 0) + 1)
  return byName
}

/** 哪些 agent 的 body 引用了某 clip（`$ name` 行） */
export function referencedBy(clipName: string, agents: AgentDoc[]): string[] {
  const re = new RegExp(`^\\$\\s*${clipName}\\s*$`, 'm')
  return agents.filter((a) => re.test(a.body)).map((a) => a.agentName)
}

/* ── frontmatter 序列化（演示：只序列化，不解析往返 —— 见 README 开放问题）── */

export function serializeFrontmatter(agent: AgentDoc): string {
  const fm = agent.frontmatter
  const lines: string[] = ['---']
  if (fm.name !== undefined) lines.push(`name: ${fm.name}`)
  if (fm.description !== undefined) lines.push(`description: ${fm.description}`)
  if (fm.color !== undefined) lines.push(`color: "${fm.color}"`)
  if (fm.emoji !== undefined) lines.push(`emoji: "${fm.emoji}"`)
  if (fm.modelOrder !== undefined) lines.push(`modelOrder: [${fm.modelOrder.join(', ')}]`)
  if (fm.model !== undefined) {
    lines.push('model:')
    for (const t of fm.model) lines.push(`  - { provider: ${t.provider}, model: ${t.model} }`)
  }
  if (fm.requiredTools !== undefined) lines.push(`requiredTools: [${fm.requiredTools.join(', ')}]`)
  if (fm.skills !== undefined) lines.push(`skills: [${fm.skills.join(', ')}]`)
  if (fm.spawn !== undefined) lines.push(`spawn: ${fm.spawn}`)
  if (fm.reasoningEffort !== undefined) lines.push(`reasoningEffort: ${fm.reasoningEffort}`)
  for (const [k, v] of Object.entries(agent.extra)) lines.push(`${k}: ${v}`)
  lines.push('---')
  return lines.join('\n')
}

/* ── P1 组合文档 ────────────────────────────────────────────────── */

const CLIP_REF_RE = /^\$\s*([a-z0-9][a-z0-9-]*)\s*$/

export interface ComposeOptions {
  /** compact 模式：折叠 clip 内容行，只留 header（P1：「自认为 Prompt 封装好的话」） */
  compact: boolean
  /** 已保存的块文本（模拟磁盘；blockId → text） */
  overrides: Record<string, string>
}

export function composeDocument(agent: AgentDoc, clips: PromptClip[], opts: ComposeOptions): ComposedDocument {
  const blocks: DocBlock[] = []
  const fmId = 'fm'
  blocks.push({
    id: fmId,
    kind: 'frontmatter',
    file: agent.path,
    text: opts.overrides[fmId] ?? serializeFrontmatter(agent),
  })

  const bodyText = opts.overrides['body'] ?? agent.body
  let proseBuf: string[] = []
  let proseIdx = 0
  const flushProse = () => {
    if (proseBuf.length === 0) return
    const id = `prose-${proseIdx++}`
    blocks.push({ id, kind: 'prose', file: agent.path, text: proseBuf.join('\n') })
    proseBuf = []
  }
  for (const line of bodyText.split('\n')) {
    const m = CLIP_REF_RE.exec(line)
    if (m) {
      flushProse()
      const clipName = m[1]!
      const clip = resolveClip(clipName, clips)
      const id = `clip-${clipName}`
      if (clip) {
        blocks.push({ id, kind: 'clip', file: clip.file, text: opts.overrides[id] ?? clip.content, clipName, source: clip.source })
      } else {
        blocks.push({ id, kind: 'clip', file: `（未找到切片 ${clipName}）`, text: '', clipName, missing: true })
      }
    } else {
      proseBuf.push(line)
    }
  }
  flushProse()

  const rows: ComposedRow[] = []
  blocks.forEach((b, bi) => {
    if (bi > 0) rows.push({ blockId: b.id, role: 'separator', text: '', editable: false })
    if (b.kind === 'clip') {
      rows.push({ blockId: b.id, role: 'header', text: `$ ${b.clipName ?? ''}`, editable: false })
      if (!opts.compact && !b.missing) {
        for (const l of b.text.split('\n')) rows.push({ blockId: b.id, role: 'text', text: l, editable: true })
      }
    } else {
      for (const l of b.text.split('\n')) rows.push({ blockId: b.id, role: 'text', text: l, editable: true })
    }
  })

  return { agentName: agent.agentName, agentPath: agent.path, blocks, rows }
}

/* ── 校验（02 findings 四类 + 05 警告项；数据进数据出，同 inspectAliasRegistry 哲学）── */

export function inspectAll(
  agents: AgentDoc[],
  models: ModelDef[],
  aliases: AliasDef[],
  knownTools: string[],
  knownSkills: string[],
): Finding[] {
  const findings: Finding[] = []
  const aliasNames = new Set(aliases.map((a) => a.alias))
  const modelNames = new Set(models.map((m) => m.modelName))

  for (const agent of agents) {
    for (const a of agent.frontmatter.modelOrder ?? []) {
      if (!aliasNames.has(a)) {
        findings.push({ severity: 'error', code: 'unknown-alias', agentName: agent.agentName, alias: a, message: `${agent.agentName} 的 modelOrder 引用了不存在的别名「${a}」` })
      }
    }
    if ((agent.frontmatter.model ?? []).length > 0) {
      findings.push({ severity: 'hint', code: 'raw-model-escape', agentName: agent.agentName, message: `${agent.agentName} 仍在使用 raw model 数组（D5 逃逸口），建议改用别名` })
    }
    const missingTools = (agent.frontmatter.requiredTools ?? []).filter((t) => !knownTools.includes(t))
    if (missingTools.length > 0) {
      findings.push({ severity: 'hint', code: 'required-tools-missing', agentName: agent.agentName, message: `${agent.agentName} 的 requiredTools 超出有效工具集：${missingTools.join(', ')}（只警告不保证，D9）` })
    }
    const missingSkills = (agent.frontmatter.skills ?? []).filter((s) => !knownSkills.includes(s))
    if (missingSkills.length > 0) {
      findings.push({ severity: 'hint', code: 'skills-missing', agentName: agent.agentName, message: `${agent.agentName} 预置技能不存在：${missingSkills.join(', ')}（06 警告的 UI 呈现，D20）` })
    }
  }

  for (const al of aliases) {
    if (al.builtin) continue
    for (const t of al.targets) {
      if (!modelNames.has(t)) {
        findings.push({ severity: 'error', code: 'unknown-model-target', alias: al.alias, message: `别名 ${al.alias} 指向不存在的模型条目「${t}」` })
      }
    }
  }

  const byTarget = new Map<string, string[]>()
  for (const al of aliases) {
    if (al.builtin) continue
    const t = al.targets[0]
    if (t && modelNames.has(t)) byTarget.set(t, [...(byTarget.get(t) ?? []), al.alias])
  }
  for (const [t, names] of byTarget) {
    if (names.length > 1) {
      findings.push({ severity: 'hint', code: 'alias-fan-in', alias: names.join(','), message: `别名 ${names.join(' / ')} 同指 ${t}（无害，意图重叠提示）` })
    }
  }

  return findings
}

/* ── 解析链（§5.3 语义的 UI 投影）──────────────────────────────── */

export interface ChainStep {
  label: string
  status: 'hit' | 'skip' | 'broken'
  detail: string
}

export interface ChainResult {
  steps: ChainStep[]
  hit?: ModelDef
  via?: string
}

export function resolveChain(agent: AgentDoc, aliases: AliasDef[], models: ModelDef[]): ChainResult {
  const steps: ChainStep[] = []
  for (const name of agent.frontmatter.modelOrder ?? []) {
    const al = aliases.find((a) => a.alias === name)
    if (!al) {
      steps.push({ label: name, status: 'broken', detail: '别名不存在' })
      continue
    }
    const target = al.targets[0]
    const m = models.find((mm) => mm.modelName === target)
    if (!m) {
      steps.push({ label: `${name} → ${target ?? '?'}`, status: 'broken', detail: '目标模型条目不存在' })
      continue
    }
    if (!m.available) {
      steps.push({ label: `${name} → ${m.modelName}`, status: 'skip', detail: 'available: false，沿声明顺序回退' })
      continue
    }
    steps.push({ label: `${name} → ${m.provider}/${m.model}`, status: 'hit', detail: '命中' })
    return { steps, hit: m, via: name }
  }
  for (const raw of agent.frontmatter.model ?? []) {
    steps.push({ label: `${raw.provider}/${raw.model}`, status: 'hit', detail: 'raw 逃逸口直连（lint 警告）' })
    return {
      steps,
      hit: { modelName: '(raw)', provider: raw.provider, model: raw.model, available: true, source: agent.source },
      via: '(raw)',
    }
  }
  return { steps }
}

/* ── 保存回写（P1：一次保存写涉及的所有文件）────────────────────── */

export function saveWrites(doc: ComposedDocument, drafts: Record<string, string>): FileWrite[] {
  const byFile = new Map<string, { lines: number; blocks: string[] }>()
  for (const b of doc.blocks) {
    const text = drafts[b.id]
    if (text === undefined) continue
    const cur = byFile.get(b.file) ?? { lines: 0, blocks: [] }
    cur.lines += text.split('\n').length
    cur.blocks.push(b.id)
    byFile.set(b.file, cur)
  }
  return [...byFile].map(([file, v]) => ({
    file,
    lines: v.lines,
    reason: `回写 ${v.blocks.length} 个块（${v.blocks.join(' / ')}）`,
  }))
}

/* ── S5 别名重映射即时影响预览 ──────────────────────────────────── */

export interface RemapImpact {
  aliasName: string
  before?: ModelDef
  after?: ModelDef
  affectedAgents: string[]
}

export function remapImpact(aliasName: string, newTarget: string, agents: AgentDoc[], models: ModelDef[], aliases: AliasDef[]): RemapImpact {
  const al = aliases.find((a) => a.alias === aliasName)
  return {
    aliasName,
    before: models.find((m) => m.modelName === al?.targets[0]),
    after: models.find((m) => m.modelName === newTarget),
    affectedAgents: agents.filter((a) => (a.frontmatter.modelOrder ?? []).includes(aliasName)).map((a) => a.agentName),
  }
}

/* ── §6 断点推演（静态表驱动）──────────────────────────────────── */

export const BREAK_LABEL: Record<ChannelRow['breakOn'], string> = {
  model: '切模型在此断',
  agent: '切 Agent 在此断',
  registry: '注册表变 → digest 变 → 发新消息',
  tools: '工具集变化在此断',
  never: '天然尾巴（不影响前缀）',
  native: 'DSH 原生行为（不可控）',
}
