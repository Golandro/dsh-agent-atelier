/**
 * 只读谓词的唯一真相（票 79 第 4 条）：UI 的只读徽标 / 保存门禁与宿主的
 * `read-only` 拒绝必须由同一个判定决定，否则卡片会给出一个注定被拒的保存按钮。
 */
import { describe, expect, it } from 'vitest'

import { isReadOnlyModelEntry } from '../src/control/index.ts'

describe('isReadOnlyModelEntry', () => {
  it('内置条目只读（没有层文件）', () => {
    expect(isReadOnlyModelEntry({ source: 'built-in', path: undefined })).toBe(true)
  })

  it('合成条目只读：来源仍是 built-in，且没有文件', () => {
    expect(isReadOnlyModelEntry({ source: 'built-in', path: undefined })).toBe(true)
  })

  it('有层文件的条目可写，不管声明在哪一层', () => {
    expect(isReadOnlyModelEntry({ source: 'project-dsh', path: '/p/.dsh/agents/registry.yaml' })).toBe(false)
    expect(isReadOnlyModelEntry({ source: 'user-dsh', path: '/h/.dsh/agents/registry.yaml' })).toBe(false)
  })

  it('没有文件即只读，来源不参与判定', () => {
    // 谓词的真正条件是「有没有层文件可写」；source 只是它的一个特例。
    expect(isReadOnlyModelEntry({ source: 'project-dsh', path: undefined })).toBe(true)
    expect(isReadOnlyModelEntry({ source: 'user-dsh', path: undefined })).toBe(true)
  })
})
