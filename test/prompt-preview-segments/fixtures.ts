/**
 * 票 84 的 fixture：每个来源一份「最小可复现产物」，外加一份完整装配。
 *
 * 每份 fixture 的断言口径是「这条来源只落进自己那一组」——所以每份只放该来源
 * 的贡献，别把它们混成一份大装配（大装配由 {@link FULL_FIXTURE} 负责）。
 *
 * 数据形状照宿主 `PromptAssembly`（`sections` / `contexts` / `variables` /
 * `tools`）；账本条目是注册方自己的记录，不是从产物反推的。
 */
import type {
  PromptAssembly,
  PromptSectionLedgerEntry,
  PromptSegmentSurface,
  PromptSourceId,
} from '../../src/assembly/index.ts'

/** 一份 fixture：产物 + 账本，断言该来源唯一命中 `name` 这一段。 */
export interface SourceFixture {
  /** 这条 fixture 声称覆盖的一级来源。 */
  readonly source: PromptSourceId
  /** 被断言的那一段的二级键（宿主装配名 / context 名 / 工具名）。 */
  readonly name: string
  readonly surface: PromptSegmentSurface
  readonly assembly: PromptAssembly
  readonly ledger: readonly PromptSectionLedgerEntry[]
}

/** 只填需要的通道，其余留空——避免每份 fixture 重复四行空数组。 */
function assemblyOf(partial: Partial<PromptAssembly>): PromptAssembly {
  return { sections: [], contexts: [], variables: {}, tools: [], ...partial }
}

/**
 * 7 条一级来源各一份，顺序与 `PROMPT_SOURCE_ORDER` 一致（有测试守着）。
 *
 * ② / ③ 的区别就是「账本说不说」：③ 靠 preset 注册方自己声明来源，② 只按宿主
 * 常量名归因；产物里两者同名，无法再分（brief §2.5）。
 */
export const SOURCE_FIXTURES: readonly SourceFixture[] = [
  {
    // ① harness identity：宿主 SystemPrompt 构造函数内联注册，order −1000。
    source: 'harness-identity',
    name: 'harness:identity',
    surface: 'section',
    assembly: assemblyOf({
      sections: [{ name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.', interpolate: false }],
    }),
    ledger: [],
  },
  {
    // ② 部署 persona：只按宿主常量名归因，没有账本。
    source: 'deployment-persona',
    name: 'deployment:persona-prefix',
    surface: 'section',
    assembly: assemblyOf({ sections: [{ name: 'deployment:persona-prefix', text: 'You review code.' }] }),
    ledger: [],
  },
  {
    // ③ preset persona：同名节，只有账本声明来源时才归到这里。
    source: 'preset-persona',
    name: 'deployment:persona-prefix',
    surface: 'section',
    assembly: assemblyOf({ sections: [{ name: 'deployment:persona-prefix', text: 'You are a preset reviewer.' }] }),
    ledger: [{ sectionName: 'deployment:persona-prefix', source: 'preset-persona' }],
  },
  {
    // ④ atelier 装配行：本仓 sink 注册的 `atelier:` 命名空间。
    source: 'atelier-section',
    name: 'atelier:model-sys',
    surface: 'section',
    assembly: assemblyOf({ sections: [{ name: 'atelier:model-sys', text: 'Provider deepseek runs deepseek-chat.', interpolate: false }] }),
    ledger: [{ sectionName: 'atelier:model-sys', planName: 'atelier:model-sys', layer: '/fixtures/atlas/models.yml' }],
  },
  {
    // ⑤ 工具说明节：只能按名字前缀 `tools:` 归因。
    source: 'tool-guidance',
    name: 'tools:bash',
    surface: 'section',
    assembly: assemblyOf({ sections: [{ name: 'tools:bash', text: 'Run a shell command.' }] }),
    ledger: [],
  },
  {
    // ⑥ 运行时 context：逐条按宿主 context 名归因。
    source: 'runtime-context',
    name: 'working-directory:current',
    surface: 'context',
    assembly: assemblyOf({ contexts: [{ name: 'working-directory:current', text: 'cwd=/repo' }] }),
    ledger: [],
  },
  {
    // ⑦ 工具声明：不在 sections 里，整组归 ToolsService。
    source: 'tool-declaration',
    name: 'bash',
    surface: 'tool',
    assembly: assemblyOf({
      tools: [{ name: 'bash', description: 'Run a shell command.', parameters: { type: 'object' } }],
    }),
    ledger: [],
  },
]

/** 一份完整装配：7 条来源里 6 条有段（② 被同名 preset 顶掉），供标注与诊断断言。 */
export const FULL_FIXTURE: {
  readonly assembly: PromptAssembly
  readonly ledger: readonly PromptSectionLedgerEntry[]
} = {
  assembly: {
    sections: [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.', interpolate: false },
      { name: 'atelier:model-sys', text: 'Provider deepseek runs deepseek-chat.', interpolate: false },
      { name: 'deployment:persona-prefix', text: 'You are a preset reviewer.' },
      { name: 'tools:sdk', text: '<tool name="bash">Run a shell command.</tool>' },
      { name: 'tools:bash', text: 'Run a shell command.' },
    ],
    contexts: [{ name: 'working-directory:current', text: 'cwd=/repo' }],
    variables: { project: 'atelier' },
    tools: [
      { name: 'bash', description: 'Run a shell command.', parameters: { type: 'object' } },
      { name: 'read', description: 'Read a file.', parameters: { type: 'object' } },
    ],
  },
  ledger: [
    {
      sectionName: 'atelier:model-sys',
      planName: 'atelier:model-sys',
      layer: '/fixtures/atlas/models.yml',
      rewrittenByWaterfall: true,
    },
    {
      sectionName: 'deployment:persona-prefix',
      planName: 'deployment:persona-prefix',
      source: 'preset-persona',
      layer: '/fixtures/preset/persona.yml',
      shadowedBy: { visibility: 'opaque' },
    },
    // `atelier:skills` 是 executable: false 的规划行，永不进产物：账本记了它，
    // 投影必须报「产物里没有」，而不是凭空造一段（brief §2.5）。
    { sectionName: 'atelier:skills', planName: 'atelier:skills', layer: '/fixtures/atlas/atlas.agent.md' },
  ],
}

/** 遮蔽可见：账本点名了遮蔽者。 */
export const SHADOW_VISIBLE_FIXTURE: {
  readonly assembly: PromptAssembly
  readonly ledger: readonly PromptSectionLedgerEntry[]
} = {
  assembly: assemblyOf({
    sections: [
      { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
      { name: 'deployment:persona-prefix', text: 'You are a preset reviewer.' },
    ],
  }),
  ledger: [{ sectionName: 'deployment:persona-prefix', shadowedBy: { visibility: 'visible', displaced: 'deployment scope' } }],
}

/**
 * 段内块：parts 是**纯数据入参**，由调用方决定喂什么。本 fixture 演示投影行为
 * （一段多块 → 可展开），不主张任何宿主插件现在真的可拆（brief §2.6）。
 */
export const PARTS_FIXTURE: {
  readonly assembly: PromptAssembly
  readonly ledger: readonly PromptSectionLedgerEntry[]
} = {
  assembly: assemblyOf({
    sections: [{ name: 'tools:sdk', text: '<tool name="bash">Run a shell command.</tool><tool name="read">Read a file.</tool>' }],
  }),
  ledger: [
    {
      sectionName: 'tools:sdk',
      parts: [
        { name: 'bash', text: 'Run a shell command.' },
        { name: 'read', text: 'Read a file.' },
      ],
    },
  ],
}

/**
 * 别名诊断：规划名与宿主装配名不一致。今天的代码里两者逐字相同（brief §2.5），
 * 本 fixture 按「可能发生」造数据——不是声称现状会触发。
 */
export const ALIAS_FIXTURE: {
  readonly assembly: PromptAssembly
  readonly ledger: readonly PromptSectionLedgerEntry[]
} = {
  assembly: assemblyOf({ sections: [{ name: 'atelier:model-sys', text: 'Provider deepseek runs deepseek-chat.' }] }),
  ledger: [{ sectionName: 'atelier:model-sys', planName: 'atelier:model-system' }],
}
