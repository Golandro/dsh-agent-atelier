/**
 * PROTOTYPE — 内存虚拟文件系统：演示数据，无持久化（刷新即重置）。
 * 数据形状见 types.ts；取值刻意覆盖各诊断分支（悬空别名、逃逸口、超界工具、
 * 缺失技能、多对一、层遮蔽、available:false 回退、dsh-default 只读）。
 */
import type { AgentDoc, AliasDef, ChannelRow, ModelDef, PromptClip } from './types'

export const WORKSPACES = ['agents-manager', 'deepseek-harness', 'ChunkStellar']

/** 模式工具集（D9：有效工具集 = ToolRuntime.view() 交集；演示硬编码） */
export const KNOWN_TOOLS = ['read', 'edit', 'write', 'bash', 'grep', 'glob', 'web_fetch', 'web_search', 'subagent']

/** 原生 skills 注册表（D20；演示硬编码） */
export const KNOWN_SKILLS = ['code-review-checklist', 'tdd', 'pr', 'grilling']

export const AGENTS: AgentDoc[] = [
  {
    agentName: 'default',
    frontmatter: {
      name: '默认 Agent',
      description: '内置兼容桥：summon_agent(default) ≡ 原生 subagent',
      modelOrder: ['dsh-default'],
    },
    extra: {},
    body: '内置默认 agent：无人设。模型链指向 dsh-default —— 装载时快照 DSH 子代理默认对的内置别名（D4）。',
    source: 'bundled',
    origin: 'built-in',
    path: 'bundled/default/default.agent.md',
  },
  {
    agentName: 'code-reviewer',
    frontmatter: {
      name: '代码审查专家',
      description: '按 DL 能够列风险的 reviewer',
      color: '#7aaaff',
      emoji: '🔍',
      modelOrder: ['smart', 'fast'],
      requiredTools: ['read', 'grep', 'deploy-prod'],
      skills: ['code-review-checklist'],
      spawn: 'fork',
      reasoningEffort: 'high',
    },
    extra: { vibe: '"冷静"' },
    body: [
      '你是一名严谨的代码审查专家。只报告有证据的问题，不确定就标注待确认。',
      '$ review-checklist',
      '审查结论按严重度分级输出，每条附修复建议。',
      '$ output-format',
    ].join('\n'),
    source: 'project-dsh',
    origin: 'user',
    path: '.dsh/agents/code-reviewer/code-reviewer.agent.md',
  },
  {
    agentName: 'researcher',
    frontmatter: {
      name: '调研员',
      description: '高信任一手来源调研',
      emoji: '📚',
      modelOrder: ['smart', 'ghost'],
      skills: ['nonexistent-skill'],
      spawn: 'spawn',
    },
    extra: {},
    body: ['你是一名调研员。结论必须带一手来源链接。', '$ research-plan'].join('\n'),
    source: 'user-dsh',
    origin: 'user',
    path: '~/.dsh/agents/researcher/researcher.agent.md',
  },
  {
    agentName: 'legacy-bot',
    frontmatter: {
      name: '旧式机器人',
      description: '还在用 raw model 数组的老 agent',
      model: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    },
    extra: {},
    body: '你是一个老式问答机器人，言简意赅。',
    source: 'project-agents',
    origin: 'user',
    path: '.agents/agents/legacy-bot/legacy-bot.agent.md',
  },
]

export const CLIPS: PromptClip[] = [
  {
    name: 'review-checklist',
    file: '.dsh/agents/sections/review-checklist.md',
    source: 'project-dsh',
    content: [
      '## 审查清单',
      '- [ ] 输入校验：外部输入都有边界检查',
      '- [ ] 错误处理：异常路径有明确语义',
      '- [ ] 并发安全：共享状态无竞态',
      '- [ ] 资源释放：句柄/连接确定关闭',
      '- [ ] 注入面：拼接字符串不进命令/SQL/HTML',
      '- [ ] 日志：不泄露密钥与个人数据',
      '- [ ] 测试：新增分支有对应用例',
      '- [ ] 兼容：公开接口保持向后兼容',
      '- [ ] 性能：热路径无不必要的分配',
      '- [ ] 命名：标识符表达意图而非类型',
    ].join('\n'),
  },
  {
    // 与 workspace 层同名 → 被遮蔽（D2：低 rank 胜；演示层覆盖关系）
    name: 'review-checklist',
    file: '~/.dsh/agents/sections/review-checklist.md',
    source: 'user-dsh',
    content: '（用户层旧版清单，已被 workspace 层同名切片遮蔽 —— 演示层覆盖）',
  },
  {
    name: 'output-format',
    file: '~/.dsh/agents/sections/output-format.md',
    source: 'user-dsh',
    content: [
      '## 输出格式',
      '1. 先给结论（一句话）',
      '2. 再列证据（文件:行号）',
      '3. 严重度分级：blocker / major / minor / nit',
      '4. 每条附修复建议',
      '5. 不确定的标注「待确认」，不猜',
      '6. 末尾给总体风险评级',
      '7. 全文使用中文',
    ].join('\n'),
  },
  {
    name: 'research-plan',
    file: '~/.dsh/agents/sections/research-plan.md',
    source: 'user-dsh',
    content: [
      '## 调研步骤',
      '1. 先列已知与未知',
      '2. 每个未知点找至少两个一手来源',
      '3. 来源分级：官方文档 > 源码 > 二手文章',
      '4. 冲突信息并列呈现，标注分歧',
      '5. 结论区分「事实」与「推断」',
    ].join('\n'),
  },
  {
    // 无人引用：演示切片库的「未引用」态
    name: 'commit-message',
    file: '~/.dsh/agents/sections/commit-message.md',
    source: 'user-dsh',
    content: ['## 提交信息规范', '- 首行 ≤ 72 字，祈使句', '- type(scope): subject', '- 正文写清 why，不重复 what', '- 关联票据号'].join('\n'),
  },
]

export const MODELS: ModelDef[] = [
  {
    modelName: 'ds-chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
    sysPrompt: '你是 DeepSeek-V3，偏对话与工具调用。',
    available: true,
    source: 'user-dsh',
    path: '~/.dsh/agents/registry.yaml',
  },
  {
    modelName: 'ds-reasoner',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    sysPrompt: '你是 DeepSeek-R1：先推理，后行动。',
    available: true,
    source: 'project-dsh',
    path: '.dsh/agents/registry.yaml',
  },
  {
    modelName: 'ds-flash',
    provider: 'deepseek',
    model: 'deepseek-flash',
    sysPrompt: '你是 DeepSeek-Flash：快而轻，适合短任务。',
    available: true,
    source: 'project-dsh',
    path: '.dsh/agents/registry.yaml',
  },
  {
    // available:false —— 演示解析链跳过与回退
    modelName: 'old-v2',
    provider: 'deepseek',
    model: 'deepseek-v2',
    sysPrompt: '（旧代模型，已停用）',
    available: false,
    source: 'user-dsh',
    path: '~/.dsh/agents/registry.yaml',
  },
]

export const ALIASES: AliasDef[] = [
  { alias: 'smart', targets: ['ds-reasoner'], source: 'user-dsh', path: '~/.dsh/agents/registry.yaml' },
  { alias: 'fast', targets: ['ds-chat'], source: 'user-dsh', path: '~/.dsh/agents/registry.yaml' },
  { alias: 'cheap', targets: ['ds-flash'], source: 'project-dsh', path: '.dsh/agents/registry.yaml' },
  // 与 fast 同指 ds-chat → alias-fan-in（多对一 hint）
  { alias: 'speedy', targets: ['ds-chat'], source: 'project-dsh', path: '.dsh/agents/registry.yaml' },
  // 目标不存在 → unknown-model-target（error）
  { alias: 'broken', targets: ['missing-model'], source: 'user-dsh', path: '~/.dsh/agents/registry.yaml' },
  // 内置指针：只读（D4；装载时快照默认对，演示为合成展示）
  { alias: 'dsh-default', targets: ['ds-chat'], source: 'bundled', builtin: true },
]

/** spec §6 通道表（静态；顾问面板最小面板的断点推演数据源） */
export const CHANNEL_TABLE: ChannelRow[] = [
  { content: 'per-model 系统提示词', channel: '① system 节', mechanism: 'section order 低于 persona（在 persona 之前）', breakOn: 'model' },
  { content: 'persona', channel: '① system 节', mechanism: 'deployment:persona-prefix（order 0）', breakOn: 'agent' },
  { content: '预置技能（skills）', channel: '待定（04/07）', mechanism: '按名引用原生 skills 注册表', breakOn: 'agent' },
  { content: 'mode 工具集', channel: '④ tools 字段', mechanism: 'toolFilter → ctx.tools.restrict', breakOn: 'tools' },
  { content: 'agent/别名目录', channel: '② digest 门控 user 消息', mechanism: 'sha256 pre-step 门控（不变不发）', breakOn: 'registry' },
  { content: 'AGENTS.md', channel: '②（DSH 原生）', mechanism: 'unfiltered，change 门控', breakOn: 'native' },
  { content: 'brief', channel: '⑤ 首条消息', mechanism: 'SubagentStartRequest.prompt', breakOn: 'never' },
  { content: 'compaction / 提醒', channel: '③ pre-step', mechanism: 'DSH 原生', breakOn: 'native' },
]
