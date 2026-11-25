/**
 * 票 84 的纯度门：投影必须是纯函数——无 React、无 IO、不读宿主注册表。
 *
 * 两道互补的证据：
 * 1. **静态**：读源码文本，断言没有 React / node: / 宿主包 import，也没有去读
 *    `systemPrompt` 的私有层（`layers` 是 private，反推就是猜）。import 矩阵守卫
 *    （`scripts/check.mjs` 第 5 步）管跨层，这条只管「本模块碰了什么」。
 * 2. **行为**：同一份输入求值不修改输入对象，且不依赖调用次数。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PROMPT_SOURCE_ORDER, buildPromptSegments, promptSegmentParts } from '../../src/assembly/index.ts'
import { FULL_FIXTURE } from './fixtures.ts'

/** 投影层里属于本票的三个源文件。 */
const SOURCES = ['src/assembly/segments.ts', 'src/assembly/ledger.ts', 'src/assembly/sink.ts'] as const

function sourceOf(relative: string): string {
  return readFileSync(new URL('../../' + relative, import.meta.url), 'utf8')
}

/**
 * 去掉注释再断言代码：注释里会**提到** `assemble()`（解释为什么本模块不跑它），
 * 那是说明而不是调用。
 */
function codeOf(relative: string): string {
  return sourceOf(relative)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
}

describe('buildPromptSegments: 纯函数纪律', () => {
  it('不 import React / node: / 宿主包（投影只在内存里折数据）', () => {
    for (const relative of SOURCES) {
      const text = sourceOf(relative)
      expect(text, relative).not.toMatch(/from 'react'/)
      expect(text, relative).not.toMatch(/from 'node:/)
      expect(text, relative).not.toMatch(/from '@deepseek-ai\//)
      expect(text, relative).not.toMatch(/from '\.\.\/\.\.\/client/)
      expect(text, relative).not.toMatch(/from '\.\.\/control/)
    }
  })

  it('不读宿主 systemPrompt 的私有层，也不做任何装配/合并', () => {
    const segments = codeOf('src/assembly/segments.ts')
    // layers 是宿主的 private 字段（brief §1.7）：反推它就是猜。
    expect(segments).not.toMatch(/\.layers\b/)
    expect(segments).not.toMatch(/assemble\(/)
    expect(segments).not.toMatch(/\bawait\b/)
    expect(segments).not.toMatch(/\bfetch\(/)
  })

  it('求值不修改输入对象', () => {
    const assembly = structuredClone(FULL_FIXTURE.assembly)
    const ledger = structuredClone(FULL_FIXTURE.ledger)
    const assemblyBefore = JSON.stringify(assembly)
    const ledgerBefore = JSON.stringify(ledger)

    buildPromptSegments(assembly, ledger)

    expect(JSON.stringify(assembly)).toBe(assemblyBefore)
    expect(JSON.stringify(ledger)).toBe(ledgerBefore)
  })

  it('返回值不共享输入里的可变引用（改结果不影响下一次求值）', () => {
    const first = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)
    const second = buildPromptSegments(FULL_FIXTURE.assembly, FULL_FIXTURE.ledger)

    expect(first.sources[0]).not.toBe(second.sources[0])
    expect(first.sources[0]?.segments).not.toBe(second.sources[0]?.segments)
  })
})

describe('命名与 GLOSSARY 一致', () => {
  const glossary = readFileSync(new URL('../../GLOSSARY.md', import.meta.url), 'utf8')

  it('「来源（Source）」词条存在，且它列的 7 类贡献者与本模块的 7 个来源一一对应', () => {
    const entry = glossary.slice(glossary.indexOf('**来源（Source）**'), glossary.indexOf('**段内块（Part）**'))
    expect(entry).not.toBe('')

    // 词条按规格 §2 的 ①..⑦ 顺序列七类；每一类在代码里都有且只有一个来源 id。
    const phrases = [
      'harness identity',
      '部署 persona',
      'preset persona',
      'atelier 装配行',
      '工具说明节',
      '运行时 context',
      '工具声明',
    ]
    for (const phrase of phrases) expect(entry, phrase).toContain(phrase)
    expect(PROMPT_SOURCE_ORDER).toHaveLength(phrases.length)
    expect(new Set(PROMPT_SOURCE_ORDER).size).toBe(phrases.length)
  })

  it('「段内块（Part）」词条存在，本模块按 Part 命名而不是「子节」', () => {
    expect(glossary).toContain('**段内块（Part）**')
    // 词条明确避免「子节」（会与宿主 section 混淆）：代码与文案都不用它。
    expect(glossary).toMatch(/\*\*段内块（Part）\*\*[\s\S]*?_Avoid_: 子节/)
    const segments = sourceOf('src/assembly/segments.ts')
    expect(segments).not.toContain('子节')
    // 段内块的对外名字是 Part，展开视图按它命名。
    expect(typeof promptSegmentParts).toBe('function')
    expect(promptSegmentParts({ name: 'x', surface: 'section', text: 'y' }).parts).toEqual([{ name: 'x', text: 'y' }])
  })
})
