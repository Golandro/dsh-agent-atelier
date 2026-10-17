/**
 * PROTOTYPE — 一次性原型，验证后即弃。
 *
 * 「智能体控制」设置页的 UI 数据结构：
 * - Agent/Clip/Model/Alias/Finding 镜像冻结契约（本仓 src/types.ts 的 01/02 读面）与
 *   spec §5.1（agent 文档全字段）/ §5.2（registry.yaml）。
 * - DocBlock / ComposedDocument / ComposedRow 是 P1 标注的「组合文本编辑器」文档模型，
 *   属本原型的新增提案（clip 引用语法 `$ name`、切片落盘布局），见 README 开放问题。
 */

/** 发现根（镜像 01 冻结契约 AgentSource；rank 见 model.ts） */
export type AgentSource = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents' | 'bundled'

export type AgentOrigin = 'built-in' | 'user'

/** UI 展示的层标签：project-* 归 workspace，user-* 归 user（D2：同名 workspace 胜） */
export type LayerTag = 'workspace' | 'user' | 'bundled'

export interface ModelTarget {
  provider: string
  model: string
}

/** spec §5.1 frontmatter 全字段（D19：身份=目录名无 id；D20：skills） */
export interface AgentFrontmatter {
  name?: string
  description?: string
  color?: string
  emoji?: string
  /** 别名链，优先于 model（D5 正道） */
  modelOrder?: string[]
  /** 传统 raw 数组兜底（D5 显式逃逸口，lint 警告） */
  model?: ModelTarget[]
  requiredTools?: string[]
  skills?: string[]
  spawn?: 'spawn' | 'fork'
  reasoningEffort?: string
}

export interface AgentDoc {
  /** 目录名 = 身份（D19） */
  agentName: string
  frontmatter: AgentFrontmatter
  /** 未知 frontmatter 键，原文保留（D14 回写不丢） */
  extra: Record<string, string>
  /** 正文：自由文本 + `$ clip-name` 引用行（原型提案语法） */
  body: string
  source: AgentSource
  origin: AgentOrigin
  /** <发现根>/<agent-name>/<agent-name>.agent.md */
  path: string
}

/** P1「切片」：一个具名提示词片段 = 一个文件（D14 1:1，无隐藏状态） */
export interface PromptClip {
  name: string
  /** <发现根>/sections/<name>.md（落盘布局 = 原型提案） */
  file: string
  source: AgentSource
  content: string
}

/** spec §5.2 models 条目（镜像 02 冻结 ModelDefinition） */
export interface ModelDef {
  modelName: string
  provider: string
  model: string
  /** per-model 系统提示词（D6：调优层挂真实模型条目） */
  sysPrompt?: string
  /** v1 手动开关；false 在解析时跳过 */
  available: boolean
  source: AgentSource
  synthesized?: boolean
  path?: string
}

/** spec §5.2 aliases 条目（镜像 02 冻结 AliasDefinition；v1 单目标数组） */
export interface AliasDef {
  alias: string
  targets: string[]
  source: AgentSource
  path?: string
  /** dsh-default：内置指针，只读（D4；装载时快照 DSH 默认对，invalidate 重读） */
  builtin?: boolean
}

/** 02 findings 四类 + 05 范围的警告项（requiredTools 超界 / 预置技能缺失） */
export type FindingCode =
  | 'unknown-alias'
  | 'unknown-model-target'
  | 'raw-model-escape'
  | 'alias-fan-in'
  | 'required-tools-missing'
  | 'skills-missing'

export interface Finding {
  severity: 'error' | 'hint'
  code: FindingCode
  message: string
  agentName?: string
  alias?: string
}

/* ── P1 编辑器组合文档模型（原型新增提案）─────────────────────────
 * 编辑器把 agent 文档渲染成带全局行号的文本视图：
 * front-matter 块打头；body 中 `$ clip-name` 引用行展开为 clip 块
 * （header 行 + 内容行）；块与块之间强制空行分隔（= 各块的 Header）。
 * 保存 = 改动按块回写各自文件（frontmatter/prose → agent.md；clip → sections/<name>.md），
 * 一次保存可以写多个文件（P1 标注：「编辑 Clip 保存时确实会改涉及的所有 clip 文件」）。
 */
export type DocBlockKind = 'frontmatter' | 'prose' | 'clip'

export interface DocBlock {
  id: string
  kind: DocBlockKind
  /** 块内容落盘的文件（D14 1:1） */
  file: string
  /** 块文本（clip 块 = clip 文件内容；frontmatter 块 = 序列化 YAML） */
  text: string
  /** clip 块的引用名 */
  clipName?: string
  /** 引用的 clip 不存在（悬空引用，演示诊断呈现） */
  missing?: boolean
  /** 块来源层（clip 块的 tag 展示） */
  source?: AgentSource
}

export interface ComposedRow {
  blockId: string
  role: 'header' | 'text' | 'separator'
  text: string
  editable: boolean
}

export interface ComposedDocument {
  agentName: string
  agentPath: string
  blocks: DocBlock[]
  /** 渲染行；行号 = 下标 + 1（compact 折叠 clip 内容行后重算） */
  rows: ComposedRow[]
}

/** 保存动作的产物：一个文件一笔 */
export interface FileWrite {
  file: string
  reason: string
  lines: number
}

/** spec §6 通道表静态行（缓存断点可视化数据；Q2 裁决的最小面板数据源） */
export interface ChannelRow {
  content: string
  channel: string
  mechanism: string
  /** 什么变化会在此打断前缀缓存 */
  breakOn: 'model' | 'agent' | 'registry' | 'tools' | 'never' | 'native'
}
