/**
 * 票 84 第一片：一级来源分组。
 *
 * 断言口径：每份 fixture 只含一条来源的贡献，它必须落进自己那一组，且别的组
 * 收不到它；分组顺序固定为 {@link PROMPT_SOURCE_ORDER}，空组也保留（UI 才能
 * 如实说「本次该来源无贡献」，而不是让组消失）。
 */
import { describe, expect, it } from 'vitest'

import {
  PROMPT_SOURCE_ORDER,
  buildPromptSegments,
  promptSegmentParts,
  promptShadowLabel,
} from '../../src/assembly/index.ts'
import {
  ALIAS_FIXTURE,
  FULL_FIXTURE,
  PARTS_FIXTURE,
  SHADOW_VISIBLE_FIXTURE,
  SOURCE_FIXTURES,
} from './fixtures.ts'

import type { PromptSegmentsView } from '../../src/assembly/index.ts'

const EMPTY_ASSEMBLY = { sections: [], contexts: [], variables: {}, tools: [] }

/** 二级键 → 段（跨组平铺；测试里只按名字取）。 */
function segmentIndex(view: PromptSegmentsView): Map<string, ReturnType<typeof allSegments>[number]> {
  return new Map(allSegments(view).map((segment) => [segment.name, segment]))
}

function allSegments(view: PromptSegmentsView) {
  return view.sources.flatMap((group) => group.segments)
}

describe('buildPromptSegments: 一级来源分组', () => {
  it('固定给出 7 组，空装配时全为空组且没有诊断', () => {
    const view = buildPromptSegments(EMPTY_ASSEMBLY, [])

    expect(view.sources.map((group) => group.source)).toEqual([...PROMPT_SOURCE_ORDER])
    expect(PROMPT_SOURCE_ORDER).toHaveLength(7)
    expect(view.sources.every((group) => group.segments.length === 0)).toBe(true)
    expect(view.unattributed).toEqual([])
    expect(view.diagnostics).toEqual([])
  })

  it('每份 fixture 的段只落在它声称的那一组', () => {
    for (const fixture of SOURCE_FIXTURES) {
      const view = buildPromptSegments(fixture.assembly, fixture.ledger)
      const own = view.sources.find((group) => group.source === fixture.source)
      const hit = own?.segments.find((segment) => segment.name === fixture.name)

      expect(hit, `${fixture.source} 组里应有 ${fixture.name}`).toBeDefined()
      expect(hit?.surface).toBe(fixture.surface)
      expect(view.unattributed, `${fixture.source} 不应有不可归因段`).toEqual([])

      for (const group of view.sources) {
        if (group.source === fixture.source) continue
        expect(
          group.segments.map((segment) => segment.name),
          `${fixture.source} 的段不该落进 ${group.source}`,
        ).not.toContain(fixture.name)
      }
    }
  })

  it('每份 fixture 覆盖的来源互不相同（7 条各一份）', () => {
    expect(new Set(SOURCE_FIXTURES.map((fixture) => fixture.source)).size).toBe(7)
    expect([...SOURCE_FIXTURES.map((fixture) => fixture.source)].sort()).toEqual([...PROMPT_SOURCE_ORDER].sort())
  })
})

describe('buildPromptSegments: 每段的标注', () => {
  it('每段都带来源、宿主装配名、通道与文本', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const all = view.sources.flatMap((group) => group.segments)

    expect(all.length).toBeGreaterThan(0)
    for (const segment of all) {
      expect(PROMPT_SOURCE_ORDER).toContain(segment.source)
      expect(segment.name).not.toBe('')
      expect(['section', 'context', 'tool']).toContain(segment.surface)
      expect(typeof segment.text).toBe('string')
    }
  })

  it('配置层标注只在账本记了文件时才出现', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const byName = segmentIndex(view)

    expect(byName.get('atelier:model-sys')?.layer).toBe('/fixtures/atlas/models.yml')
    // 没有账本记录的段不带 layer：不拿别处的路径凑。
    expect(byName.get('harness:identity')?.layer).toBeUndefined()
    expect(byName.get('tools:bash')?.layer).toBeUndefined()
  })

  it('waterfall 改写只在账本记了时才标注（缺席 ≠ 没被改写）', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const byName = segmentIndex(view)

    expect(byName.get('atelier:model-sys')?.rewrittenByWaterfall).toBe(true)
    expect(byName.get('harness:identity')?.rewrittenByWaterfall).toBeUndefined()
  })

  it('遮蔽可见时点名遮蔽者，遮蔽不可见时说「不可见」而不是猜', () => {
    const opaque = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const visible = buildPromptSegments(SHADOW_VISIBLE_FIXTURE.assembly, SHADOW_VISIBLE_FIXTURE.ledger)

    const opaqueShadow = segmentIndex(opaque).get('deployment:persona-prefix')?.shadowedBy
    const visibleShadow = segmentIndex(visible).get('deployment:persona-prefix')?.shadowedBy

    expect(opaqueShadow).toEqual({ visibility: 'opaque' })
    expect(opaqueShadow === undefined ? '' : promptShadowLabel(opaqueShadow)).toBe('遮蔽关系不可见')
    expect(visibleShadow).toEqual({ visibility: 'visible', displaced: 'deployment scope' })
    expect(visibleShadow === undefined ? '' : promptShadowLabel(visibleShadow)).toBe('遮蔽了同名注册（deployment scope）')
    // 没有账本记录就没有遮蔽标注：兼容模式下宿主节的遮蔽关系不可见。
    expect(segmentIndex(opaque).get('harness:identity')?.shadowedBy).toBeUndefined()
  })

  it('没有账本时任何段都不带账本字段', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, [])

    for (const segment of view.sources.flatMap((group) => group.segments)) {
      expect(segment.layer).toBeUndefined()
      expect(segment.rewrittenByWaterfall).toBeUndefined()
      expect(segment.shadowedBy).toBeUndefined()
      expect(segment.parts).toBeUndefined()
    }
  })
})

describe('buildPromptSegments: 段内块展开', () => {
  it('账本记了多块时段可展开，块按账本顺序原样给出', () => {
    const view = buildPromptSegments(PARTS_FIXTURE.assembly, PARTS_FIXTURE.ledger)
    const segment = segmentIndex(view).get('tools:sdk')

    expect(segment).toBeDefined()
    const expanded = segment === undefined ? null : promptSegmentParts(segment)

    expect(expanded?.expandable).toBe(true)
    expect(expanded?.parts.map((part) => part.name)).toEqual(['bash', 'read'])
    expect(expanded?.parts.map((part) => part.text)).toEqual(['Run a shell command.', 'Read a file.'])
  })

  it('没有账本块时段不展开，整段文本作为唯一块给出（不丢内容）', () => {
    const view = buildPromptSegments(PARTS_FIXTURE.assembly, [])
    const segment = segmentIndex(view).get('tools:sdk')

    const expanded = segment === undefined ? null : promptSegmentParts(segment)

    expect(expanded?.expandable).toBe(false)
    expect(expanded?.parts).toHaveLength(1)
    expect(expanded?.parts[0]?.name).toBe('tools:sdk')
    expect(expanded?.parts[0]?.text).toBe(PARTS_FIXTURE.assembly.sections[0]?.text)
  })

  it('账本记了空块表时段不展开（空块表不是「可拆成零块」）', () => {
    const view = buildPromptSegments(
      { ...PARTS_FIXTURE.assembly },
      [{ sectionName: 'tools:sdk', parts: [] }],
    )
    const segment = segmentIndex(view).get('tools:sdk')

    const expanded = segment === undefined ? null : promptSegmentParts(segment)

    expect(expanded?.expandable).toBe(false)
    expect(expanded?.parts).toHaveLength(1)
  })
})

describe('buildPromptSegments: 别名与诊断', () => {
  it('规划名与宿主装配名不一致时以宿主名为准，并记一条 alias-mismatch', () => {
    const view = buildPromptSegments(ALIAS_FIXTURE.assembly, ALIAS_FIXTURE.ledger)
    const segment = segmentIndex(view).get('atelier:model-sys')

    expect(segment?.name).toBe('atelier:model-sys')
    expect(segment?.planName).toBe('atelier:model-system')
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['alias-mismatch'])
    expect(view.diagnostics[0]?.name).toBe('atelier:model-sys')
  })

  it('名字一致时不记别名诊断', () => {
    const view = buildPromptSegments(SOURCE_FIXTURES[3]?.assembly ?? EMPTY_ASSEMBLY, SOURCE_FIXTURES[3]?.ledger ?? [])

    expect(view.diagnostics).toEqual([])
  })

  it('账本记了产物里没有的段时报 missing-from-assembly，而不是造一段', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const missing = view.diagnostics.filter((diagnostic) => diagnostic.code === 'missing-from-assembly')

    expect(missing.map((diagnostic) => diagnostic.name)).toEqual(['atelier:skills'])
    expect(segmentIndex(view).has('atelier:skills')).toBe(false)
    expect(allSegments(view).map((segment) => segment.name)).not.toContain('atelier:skills')
  })
})

describe('buildPromptSegments: 归不了因的段', () => {
  it('认不出来源的段进 unattributed，不猜一个来源', () => {
    const view = buildPromptSegments(
      { sections: [{ name: 'plugin:unknown', text: 'x' }], contexts: [], variables: {}, tools: [] },
      [],
    )

    expect(allSegments(view).map((segment) => segment.name)).not.toContain('plugin:unknown')
    expect(view.unattributed.map((segment) => segment.name)).toEqual(['plugin:unknown'])
    expect(view.unattributed[0]?.source).toBeUndefined()
  })

  it('账本声明了来源就按声明归组（同名节的 ②/③ 只能这样区分）', () => {
    const view = buildPromptSegments(
      { sections: [{ name: 'plugin:unknown', text: 'x' }], contexts: [], variables: {}, tools: [] },
      [{ sectionName: 'plugin:unknown', source: 'atelier-section' }],
    )

    expect(view.unattributed).toEqual([])
    expect(view.sources.find((group) => group.source === 'atelier-section')?.segments.map((segment) => segment.name))
      .toEqual(['plugin:unknown'])
  })
})

describe('buildPromptSegments: 同名节（②/③）只按账本区分', () => {
  const sameName = { sections: [{ name: 'deployment:persona-prefix', text: 'You review code.' }], contexts: [], variables: {}, tools: [] }

  it('没有账本声明时归部署 persona（产物里认不出 preset 的存在）', () => {
    const view = buildPromptSegments(sameName, [])

    expect(view.sources.find((group) => group.source === 'deployment-persona')?.segments.map((segment) => segment.name))
      .toEqual(['deployment:persona-prefix'])
    expect(view.sources.find((group) => group.source === 'preset-persona')?.segments).toEqual([])
  })

  it('账本声明 preset 来源时归 preset persona，且两组不会同时出现同一条', () => {
    const view = buildPromptSegments(sameName, [{ sectionName: 'deployment:persona-prefix', source: 'preset-persona' }])

    expect(view.sources.find((group) => group.source === 'preset-persona')?.segments.map((segment) => segment.name))
      .toEqual(['deployment:persona-prefix'])
    expect(view.sources.find((group) => group.source === 'deployment-persona')?.segments).toEqual([])
  })

  it('账本只记「有遮蔽」时，标注是「遮蔽关系不可见」而不是猜一个遮蔽者', () => {
    const view = buildPromptSegments(sameName, [
      { sectionName: 'deployment:persona-prefix', source: 'preset-persona', shadowedBy: { visibility: 'opaque' } },
    ])
    const segment = segmentIndex(view).get('deployment:persona-prefix')

    expect(segment?.shadowedBy).toEqual({ visibility: 'opaque' })
    expect(segment?.shadowedBy === undefined ? '' : promptShadowLabel(segment.shadowedBy)).toBe('遮蔽关系不可见')
    // 不替它编一个「遮蔽者是谁」：opaque 负载里没有这个字段。
    expect(Object.keys(segment?.shadowedBy ?? {})).toEqual(['visibility'])
  })
})

describe('buildPromptSegments: 工具说明与工具声明各归各的', () => {
  it('账本收不到的宿主工具节仍按 tools: 前缀归工具说明节（不硬塞进 atelier 组）', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const guidance = view.sources.find((group) => group.source === 'tool-guidance')

    expect(guidance?.segments.map((segment) => segment.name)).toEqual(['tools:bash', 'tools:sdk'])
    expect(view.sources.find((group) => group.source === 'atelier-section')?.segments.map((segment) => segment.name))
      .toEqual(['atelier:model-sys'])
  })

  it('工具声明整组归 ToolsService，不逐工具猜注册者', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const declarations = view.sources.find((group) => group.source === 'tool-declaration')

    expect(declarations?.segments.map((segment) => segment.name)).toEqual(['bash', 'read'])
    expect(declarations?.segments.every((segment) => segment.surface === 'tool')).toBe(true)
    // 工具声明的文本是 description，没有 layer / 账本标注。
    expect(declarations?.segments.map((segment) => segment.text)).toEqual(['Run a shell command.', 'Read a file.'])
    expect(declarations?.segments.every((segment) => segment.layer === undefined)).toBe(true)
  })

  it('variables 不是一级来源，不进任何组也不进不可归因', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const names = [...allSegments(view).map((segment) => segment.name), ...view.unattributed.map((segment) => segment.name)]

    expect(names).not.toContain('project')
  })
})

describe('buildPromptSegments: 排序稳定', () => {
  it('同一份输入两次求值完全一致', () => {
    const first = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const second = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('输入数组顺序打乱不改变结果（组内按宿主装配名升序）', () => {
    const ordered = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const shuffled = buildPromptSegments(
      {
        ...FULL_FIXTURE.assembly,
        sections: [...FULL_FIXTURE.assembly.sections].reverse(),
        contexts: [...FULL_FIXTURE.assembly.contexts].reverse(),
        tools: [...FULL_FIXTURE.assembly.tools].reverse(),
      },
      [...FULL_FIXTURE.ledger].reverse(),
    )

    expect(shuffled).toEqual(ordered)
  })

  it('结果可 JSON 序列化且不挂方法（跨序列化边界可用）', () => {
    const view = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const roundTrip = JSON.parse(JSON.stringify(view)) as unknown

    expect(roundTrip).toEqual(JSON.parse(JSON.stringify(view)))
    expect(JSON.stringify(view)).not.toContain('function')
    for (const group of view.sources) {
      for (const segment of group.segments) {
        expect(Object.values(segment).some((value) => typeof value === 'function')).toBe(false)
      }
    }
  })
})
