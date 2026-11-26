/**
 * 预览视图的 fixture（票 85）：直接造**已投影好的** `PromptSegmentsView`。
 *
 * 测试不跑装配、不跑投影函数（它们在 `src/assembly/`，chunk 层读不到；跑它们
 * 也就变成了 I2 的测试）。这里按契约形状造数据，把「UI 怎么摆」的断言与
 * 「投影算得对不对」的断言分开。
 */
import type {
  PromptPreviewDegradation,
  PromptPreviewView,
  PromptSegment,
  PromptSegmentsView,
  PromptSourceGroup,
  PromptSourceId,
} from '../../src/dsh/client/chunk-contracts.ts'

/** 7 条来源的固定顺序（与契约层的词表一致；测试里当事实用）。 */
export const SOURCE_ORDER: readonly PromptSourceId[] = [
  'harness-identity',
  'deployment-persona',
  'preset-persona',
  'atelier-section',
  'tool-guidance',
  'runtime-context',
  'tool-declaration',
]

/**
 * 一组：默认空组（7 组固定顺序，空组保留）。
 *
 * 段的一级来源由组给出，所以这里顺手把 `source` 贴到每段上——与投影方的
 * 真实输出一致（组内的段都带同一个 source）。
 */
export function group(
  source: PromptSourceId,
  segments: readonly Omit<PromptSegment, 'source'>[] = [],
): PromptSourceGroup {
  return { source, segments: segments.map((segment) => ({ ...segment, source })) }
}

/** 一份最小完整视图：7 组都在、顺序固定。 */
export function emptyView(): PromptSegmentsView {
  return {
    sources: SOURCE_ORDER.map((source) => group(source)),
    unattributed: [],
    diagnostics: [],
  }
}

/** 7 条来源各来一段的最小视图。 */
export function sevenSourceView(): PromptSegmentsView {
  return {
    sources: [
      group('harness-identity', [
        { name: 'harness:identity', surface: 'section', text: 'You are DSH.' },
      ]),
      group('deployment-persona', [
        { name: 'deployment:persona-prefix', surface: 'section', text: 'Be brief.' },
      ]),
      group('preset-persona', []),
      group('atelier-section', [
        {
          name: 'atelier:model-sys',
          surface: 'section',
          text: 'route {{provider}}/{{model}}',
          planName: 'model-system',
          layer: '.dsh/agents/assembly.yml',
          rewrittenByWaterfall: true,
        },
      ]),
      group('tool-guidance', [
        {
          name: 'tools:sdk',
          surface: 'section',
          text: 'tool guidance bundle',
          parts: [
            { name: 'bash', text: 'bash: run commands' },
            { name: 'read', text: 'read: read files' },
          ],
        },
      ]),
      group('runtime-context', [
        { name: 'working-directory:current', surface: 'context', text: 'cwd=/work' },
      ]),
      group('tool-declaration', [
        { name: 'bash', surface: 'tool', text: 'Run a shell command.' },
      ]),
    ],
    unattributed: [],
    diagnostics: [],
  }
}

/** 带遮蔽（opaque）与不可归因段的视图。 */
export function shadowedView(): PromptSegmentsView {
  return {
    sources: [
      group('harness-identity', []),
      group('deployment-persona', [
        { name: 'deployment:persona-prefix', surface: 'section', text: 'Be brief.', shadowedBy: { visibility: 'opaque' } },
        { name: 'deployment:persona-suffix', surface: 'section', text: 'Thanks.', shadowedBy: { visibility: 'visible', displaced: 'preset scope' } },
      ]),
      group('preset-persona', []),
      group('atelier-section', []),
      group('tool-guidance', []),
      group('runtime-context', []),
      group('tool-declaration', []),
    ],
    unattributed: [{ name: 'unknown:section', surface: 'section', text: 'who put this here?' }],
    diagnostics: [
      { code: 'alias-mismatch', name: 'atelier:model-sys', message: '规划名 model-system 与宿主名不同，以宿主名为准。' },
      { code: 'missing-from-assembly', name: 'atelier:skills', message: '账本记了这一节，产物里没有（executable: false）。' },
    ],
  }
}

/** 完整的预览回答（档位 ①）。 */
export function fullView(overrides: Partial<PromptPreviewView> = {}): PromptPreviewView {
  return {
    agentName: 'fast-agent',
    cwd: '/work',
    assembledAt: '2026-11-26T05:00:00.000Z',
    scanId: 42,
    segments: sevenSourceView(),
    sideEffects: ['本接口会真实执行 system-prompt/assemble waterfall 的每个 handler。'],
    notes: ['新鲜度：只带装配时刻与本次请求的 scanId。'],
    ...overrides,
  }
}

/** 一档降级回答。 */
export function degradedView(
  degraded: PromptPreviewDegradation,
  segments: PromptSegmentsView = emptyView(),
): PromptPreviewView {
  return fullView({ segments, degraded })
}

/** ② 链耗尽：引擎原样报告。 */
export function chainExhaustedView(): PromptPreviewView {
  return degradedView({
    tier: 'chain-exhausted',
    reason: 'chain exhausted: smart → fast',
    missing: [{ item: 'session', reason: '链耗尽：没有选中的路由，就没有可装配的会话' }],
    report: {
      aliasChain: [{ orderIndex: 0, alias: 'smart', targets: ['fast'] }],
      rawFallbackUsed: false,
      candidates: [
        { origin: 'alias', modelName: 'fast', orderIndex: 0, skipped: 'unavailable' },
        { origin: 'raw', skipped: 'not-reached' },
      ],
      selectedBy: 'none',
      effortSource: 'none',
    },
  })
}

/** ③ 静态回退：非宿主装配结果 + 逐项缺口。 */
export function staticView(): PromptPreviewView {
  return degradedView({
    tier: 'static',
    reason: '该 agent 当前没有活跃会话',
    missing: [
      { item: 'live-agent', reason: '该 agent 当前没有活跃会话' },
      { item: 'host-config', reason: '拿不到有效 config' },
    ],
  })
}

/** ④ 空态：错误原文在 reason。 */
export function emptyStateView(): PromptPreviewView {
  return degradedView({
    tier: 'empty',
    reason: 'registry 读不到：ENOENT registry.yaml',
    missing: [{ item: 'session', reason: 'registry 读不到：连 agent 文档与模型链都取不到' }],
  })
}
