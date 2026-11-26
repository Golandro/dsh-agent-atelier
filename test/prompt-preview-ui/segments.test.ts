/**
 * 两份实现的逐例对拍（票 85）：UI 侧的两个小函数与装配侧的原版必须同结果。
 *
 * 为什么会有两份：`promptSegmentParts` / `promptShadowLabel` 住在
 * `src/assembly/segments.ts`，而发布 chunk 按 import 矩阵 `CHUNK_ENTRIES` 只能读
 * `control` 与 `chunk-contracts`——chunk 读不到装配层。所以 UI 侧只能自带一份
 * 判定，这里用真函数逐例对拍，把「注释说同步」换成「测试保证同步」。
 *
 * 测试文件不在 `src/` 下，不受矩阵扫描约束，可以直接 import 装配层。
 */
import { describe, expect, it } from 'vitest'

import { promptSegmentParts, promptShadowLabel } from '../../src/assembly/index.ts'
import { previewPartsOf, previewShadowText } from '../../src/client/chunks/registry/prompt-preview-model.ts'

import type { PromptSegmentBase, PromptShadow } from '../../src/contract/index.ts'

/** 对拍的段样本：覆盖 0 块 / 1 块 / 2 块 / 多块 / 空文本。 */
const SEGMENTS: readonly PromptSegmentBase[] = [
  { name: 'atelier:model-sys', surface: 'section', text: 'whole text' },
  { name: 'atelier:empty', surface: 'section', text: '' },
  { name: 'tools:single', surface: 'section', text: 'one', parts: [{ name: 'only', text: 'one' }] },
  { name: 'tools:two', surface: 'section', text: 'a\nb', parts: [{ name: 'a', text: 'a' }, { name: 'b', text: 'b' }] },
  {
    name: 'tools:many',
    surface: 'section',
    text: 'x',
    parts: [
      { name: 'x', text: 'x' },
      { name: 'y', text: 'y' },
      { name: 'z', text: 'z' },
    ],
  },
  { name: 'runtime:cwd', surface: 'context', text: 'cwd=/work' },
  { name: 'bash', surface: 'tool', text: 'Run a command.' },
]

const SHADOWS: readonly PromptShadow[] = [
  { visibility: 'opaque' },
  { visibility: 'visible', displaced: 'preset scope' },
  { visibility: 'visible', displaced: '' },
]

describe('段内块判定与装配侧同结果', () => {
  it('每一例的 expandable 与 parts 都一致（含 0 块 / 1 块 / 多块）', () => {
    for (const segment of SEGMENTS) {
      expect(previewPartsOf(segment), segment.name).toEqual(promptSegmentParts(segment))
    }
  })

  it('单块与空表都退回整段文本：内容不丢', () => {
    for (const segment of SEGMENTS) {
      const parts = previewPartsOf(segment)
      if (parts.expandable) continue
      expect(parts.parts).toHaveLength(1)
      expect(parts.parts[0]?.text).toBe(segment.text)
    }
  })
})

describe('遮蔽文案与装配侧同结果', () => {
  it('opaque 与 visible 的每一例都逐字一致', () => {
    for (const shadow of SHADOWS) {
      expect(previewShadowText(shadow)).toBe(promptShadowLabel(shadow))
    }
  })

  it('opaque 永远只说「遮蔽关系不可见」', () => {
    expect(previewShadowText({ visibility: 'opaque' })).toBe('遮蔽关系不可见')
  })
})
