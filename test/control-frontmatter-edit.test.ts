import { describe, expect, it } from 'vitest'

import { parseAgentDocument } from '../src/core/index.ts'
import { applyFrontmatterField, serializeFrontmatterArray, serializeFrontmatterScalar } from '../src/control/frontmatter-edit.ts'

/** Wrap raw frontmatter text in a fenced document. */
function fenced(frontmatterText: string): string {
  return `---\n${frontmatterText}---\nbody\n`
}

describe('frontmatter field compiler', () => {
  it('replaces one key line and preserves comments, unknown keys and order', () => {
    const text = ['name: a', '# a comment', 'custom: keep me', 'description: old', 'emoji: "🔍"', ''].join('\n')
    const result = applyFrontmatterField(text, 'description', 'new value')
    expect(result).toEqual({ ok: true, text: ['name: a', '# a comment', 'custom: keep me', 'description: new value', 'emoji: "🔍"', ''].join('\n') })
  })

  it('appends an absent key at the end', () => {
    const result = applyFrontmatterField('name: a\n', 'color', '#fff')
    expect(result.ok).toBe(true)
    expect(result.ok && result.text).toBe('name: a\ncolor: "#fff"\n')
  })

  it('seeds an empty block and keeps the fenced invariant', () => {
    const result = applyFrontmatterField('', 'name', 'a')
    expect(result).toEqual({ ok: true, text: 'name: a\n' })
  })

  it('removes a key with its indented block, and refuses nothing when the key is absent', () => {
    const block = ['modelOrder:', '  - smart', '  - fast', 'name: a', ''].join('\n')
    const removed = applyFrontmatterField(block, 'modelOrder', undefined)
    expect(removed).toEqual({ ok: true, text: 'name: a\n' })
    const absent = applyFrontmatterField('name: a\n', 'color', undefined)
    expect(absent).toEqual({ ok: true, text: 'name: a\n' })
  })

  it('replaces a block sequence with the inline form and drops the block lines', () => {
    const block = ['modelOrder:', '  - smart', '  - fast', 'name: a', ''].join('\n')
    const result = applyFrontmatterField(block, 'modelOrder', ['one', 'two'])
    expect(result.ok && result.text).toBe(['modelOrder: [one, two]', 'name: a', ''].join('\n'))
  })

  it('treats an empty array as a removal', () => {
    const result = applyFrontmatterField('skills: [a, b]\nname: a\n', 'skills', [])
    expect(result).toEqual({ ok: true, text: 'name: a\n' })
  })

  it('validates the spawn field and value shapes', () => {
    expect(applyFrontmatterField('name: a\n', 'spawn', 'fork').ok).toBe(true)
    expect(applyFrontmatterField('name: a\n', 'spawn', 'sometimes')).toMatchObject({ ok: false })
    expect(applyFrontmatterField('name: a\n', 'name', ['a', 'b']).ok).toBe(false)
    expect(applyFrontmatterField('name: a\n', 'modelOrder', 'smart').ok).toBe(false)
    expect(applyFrontmatterField('name: a\n', 'nickname' as never, 'x').ok).toBe(false)
  })

  it('quotes only what the subset cannot read plain, and the result parses back', () => {
    expect(serializeFrontmatterScalar('plain-name_1')).toBe('plain-name_1')
    expect(serializeFrontmatterScalar('')).toBe('""')
    expect(serializeFrontmatterScalar('a: b')).toBe('"a: b"')
    expect(serializeFrontmatterScalar('# tag')).toBe('"# tag"')
    expect(serializeFrontmatterScalar('true')).toBe('"true"')
    expect(serializeFrontmatterScalar(' say hi ')).toBe('" say hi "')
    expect(serializeFrontmatterScalar('line1\nline2')).toBe('"line1\\nline2"')
    expect(serializeFrontmatterArray(['a', 'b: c'])).toBe('[a, "b: c"]')
  })

  it('round-trips every scalar field through the reader', () => {
    const text = applyFrontmatterField('', 'description', 'hello: "world" # tricky\nsecond line')
    expect(text.ok).toBe(true)
    if (!text.ok) return
    const parsed = parseAgentDocument(fenced(text.text))
    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.description).toBe('hello: "world" # tricky\nsecond line')
  })

  it('always returns empty text or text ending with its newline', () => {
    for (const [field, value] of [['name', 'a'], ['description', undefined], ['skills', ['x']]] as const) {
      const result = applyFrontmatterField('name: a', field, value)
      expect(result.ok && (result.text === '' || result.text.endsWith('\n'))).toBe(true)
    }
  })
})
