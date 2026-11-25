/**
 * 票 84 的接缝守卫：分段视图 DTO 必须能被 registry chunk 命名。
 *
 * 结构事实（scripts/checklist/matrix.mjs）：chunk 只准读 `control` 与
 * `chunk-contracts`（`CHUNK_ENTRIES`），而 `chunk-contracts` 所在层只准读
 * `contract` / `control` / `client` 三个入口。所以视图类型**不能**定义在
 * `src/assembly/`——那里放形状，消费方就够不着自己的类型。
 *
 * 本测试钉住接缝的两端：
 * 1. 定义唯一：DTO 只在 `src/contract/prompt-preview.ts` 定义一次，assembly 只
 *    re-export，不保留第二份（同协议两份副本就是漂移源）。
 * 2. 消费者可达：chunk 能只经 `chunk-contracts` 拿到视图类型（type-only，零运行期
 *    代码过界）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type {
  PromptSegment,
  PromptSegmentParts,
  PromptSegmentsView,
  PromptSourceId,
} from '../src/dsh/client/chunk-contracts.ts'

/** 视图 DTO：契约层定义的名字（也是 chunk 从接缝拿到的那批）。 */
const VIEW_TYPES = [
  'PromptPart',
  'PromptSegment',
  'PromptSegmentBase',
  'PromptSegmentDiagnostic',
  'PromptSegmentDiagnosticCode',
  'PromptSegmentParts',
  'PromptSegmentSurface',
  'PromptSegmentsView',
  'PromptShadow',
  'PromptSourceGroup',
  'PromptSourceId',
  'UnattributedPromptSegment',
] as const

function sourceOf(relative: string): string {
  return readFileSync(new URL('../' + relative, import.meta.url), 'utf8')
}

describe('分段视图的跨层接缝', () => {
  it('DTO 只在契约层定义一次，assembly 不保留第二份定义', () => {
    const contract = sourceOf('src/contract/prompt-preview.ts')
    const assembly = sourceOf('src/assembly/segments.ts')

    for (const name of VIEW_TYPES) {
      // 契约层：每条都有且只有一处定义（type 或 interface）。
      const declared = contract.match(new RegExp(`export (?:type|interface) ${name}\\b`, 'g')) ?? []
      expect(declared, name).toHaveLength(1)
      // 装配层：同名不得再声明（只能 import / re-export）。
      expect(assembly, name).not.toMatch(new RegExp(`export (?:type|interface) ${name}\\b`))
    }
  })

  it('宿主结构的镜像留在装配层，且不与契约同名（镜像不许变成契约）', () => {
    const assembly = sourceOf('src/assembly/segments.ts')
    for (const mirror of ['AssembledSection', 'AssembledContext', 'ToolDeclaration', 'HostPromptAssembly']) {
      expect(assembly, mirror).toMatch(new RegExp(`export interface ${mirror}\\b`))
    }
    // 宿主产物镜像带 Host 前缀：契约层若日后命名 PromptAssembly，两者不同名。
    expect(assembly).not.toMatch(/export interface PromptAssembly\b/)
  })

  it('chunk 只经 chunk-contracts 就能命名视图类型（且该接缝是 type-only）', () => {
    const chunkContracts = sourceOf('src/dsh/client/chunk-contracts.ts')
    // 接缝必须从 contract 读：dsh/client 读不到 src/assembly/。
    expect(chunkContracts).toContain("from '../../contract/index.ts'")
    expect(chunkContracts).not.toContain("from '../../assembly")
    // 只 re-export 类型，不搬运投影函数（运行期不过界）。
    expect(chunkContracts).toMatch(/export type \{[\s\S]*?PromptSegmentsView[\s\S]*?\} from '..\/..\/contract\/index.ts'/)
    expect(chunkContracts).not.toContain('buildPromptSegments')

    // 类型面真的能用：编译期赋值检查（运行时无副作用）。
    const group: PromptSegmentsView['sources'][number] = { source: 'atelier-section', segments: [] }
    const source: PromptSourceId = group.source
    const segment: PromptSegment = { name: 'atelier:model-sys', surface: 'section', text: 'x', source }
    const parts: PromptSegmentParts = { expandable: false, parts: [{ name: segment.name, text: segment.text }] }
    expect(parts.parts).toHaveLength(1)
  })
})
