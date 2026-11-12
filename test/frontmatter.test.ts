import { describe, expect, it } from 'vitest'

import { parseAgentDocument, splitAgentFence } from '../src/catalog/frontmatter.ts'
import { FRONTMATTER_FIELD_KEYS, FRONTMATTER_FIELDS } from '../src/yaml/index.ts'

/** Build a fenced document the way an author would write one. */
function document(frontmatter: string, body = ''): string {
  return `---\n${frontmatter}\n---\n${body}`
}

describe('minimal frontmatter reader', () => {
  it('types every known key of the documented shape', () => {
    const parsed = parseAgentDocument(document([
      'name: 代码审查专家',
      'description: "按 DL 能够列风险的 reviewer"',
      'color: "#4f46e5"',
      'emoji: "🔍"',
      'modelOrder: [smart, fast]',
      'model:',
      '  - { provider: deepseek, model: deepseek-chat }',
      'requiredTools: [read, grep]',
      'skills: [code-review-checklist]',
      'spawn: fork',
      'reasoningEffort: high',
    ].join('\n'), '你是审查者。\n'))

    expect(parsed.hasFrontmatter).toBe(true)
    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.name).toBe('代码审查专家')
    expect(parsed.frontmatter.description).toBe('按 DL 能够列风险的 reviewer')
    expect(parsed.frontmatter.color).toBe('#4f46e5')
    expect(parsed.frontmatter.emoji).toBe('🔍')
    expect(parsed.frontmatter.modelOrder).toEqual(['smart', 'fast'])
    expect(parsed.frontmatter.model).toEqual([{ provider: 'deepseek', model: 'deepseek-chat' }])
    expect(parsed.frontmatter.requiredTools).toEqual(['read', 'grep'])
    expect(parsed.frontmatter.skills).toEqual(['code-review-checklist'])
    expect(parsed.frontmatter.spawn).toBe('fork')
    expect(parsed.frontmatter.reasoningEffort).toBe('high')
    expect(parsed.frontmatter.extra).toEqual({})
    expect(parsed.body).toBe('你是审查者。')
  })

  it('reads a literal block scalar, keeping its blank lines and header comment', () => {
    const parsed = parseAgentDocument(document([
      'description: | # one-line summary',
      '  first line',
      '  second line',
      '',
      '  after a blank line',
      'modelOrder: [fast]',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.description).toBe('first line\nsecond line\n\nafter a blank line')
    expect(parsed.frontmatter.modelOrder).toEqual(['fast'])
  })

  it('reads block sequences and plain-form model mappings', () => {
    const parsed = parseAgentDocument(document([
      'modelOrder:',
      '  - smart',
      '  - fast',
      'model:',
      '  - provider: deepseek, model: deepseek-chat',
      '  - { provider: openai, model: gpt-5 }',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.modelOrder).toEqual(['smart', 'fast'])
    expect(parsed.frontmatter.model).toEqual([
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'openai', model: 'gpt-5' },
    ])
  })

  it('keeps unknown keys as raw text, including indented blocks', () => {
    const parsed = parseAgentDocument(document([
      'id: legacy-id',
      'vibe: 冷静而锋利',
      'notes:',
      '  keep: me',
      '  also: me',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.extra['id']).toBe('legacy-id')
    expect(parsed.frontmatter.extra['vibe']).toBe('冷静而锋利')
    expect(parsed.frontmatter.extra['notes']).toBe('keep: me\nalso: me')
  })

  it('removes only the common indent of a block value, keeping the deeper shape', () => {
    const parsed = parseAgentDocument(document([
      'notes:',
      '  keep: me',
      '    deeper: me',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.extra['notes']).toBe('keep: me\n  deeper: me')
  })

  it('does not let an unknown key make the document unreadable', () => {
    const parsed = parseAgentDocument(document([
      'modelOrder: [fast]',
      'vibe: "未闭合',
      'tag: *alias',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.modelOrder).toEqual(['fast'])
    expect(parsed.frontmatter.extra).toEqual({ vibe: '"未闭合', tag: '*alias' })
  })

  it('reports constructs the subset cannot express', () => {
    const cases: readonly string[] = [
      'modelOrder: { smart: 1 }',
      'requiredTools:\n  - [read, grep]',
      'name: >\n  multi',
      'spawn: parallel',
      'name: "unterminated',
      'modelOrder: [smart',
      'name: first\nname: second',
    ]
    for (const frontmatter of cases) {
      const parsed = parseAgentDocument(document(frontmatter))
      expect(parsed.frontmatter.problems.length, `expected a problem for: ${frontmatter}`).toBeGreaterThan(0)
    }
  })

  it('strips comments but not quoted hashes', () => {
    const parsed = parseAgentDocument(document([
      'name: 审查者 # display name',
      'description: "cost #1 reviewer"',
    ].join('\n')))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.name).toBe('审查者')
    expect(parsed.frontmatter.description).toBe('cost #1 reviewer')
  })

  it('treats an empty list as absent', () => {
    const parsed = parseAgentDocument(document('modelOrder: []\nrequiredTools: []\nskills: []'))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.modelOrder).toBeUndefined()
    expect(parsed.frontmatter.requiredTools).toBeUndefined()
    expect(parsed.frontmatter.skills).toBeUndefined()
  })

  it('accepts a document without frontmatter and takes the whole text as the body', () => {
    const parsed = parseAgentDocument('你是一个不加修饰的 agent。\n')

    expect(parsed.hasFrontmatter).toBe(false)
    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.extra).toEqual({})
    expect(parsed.body).toBe('你是一个不加修饰的 agent。')
  })

  it('flags a frontmatter fence that never closes', () => {
    const parsed = parseAgentDocument('---\nname: 半截\n正文被吞了\n')

    expect(parsed.hasFrontmatter).toBe(true)
    expect(parsed.frontmatter.problems).toEqual(['frontmatter opens with --- but never closes'])
  })

  it('keeps an empty body when the document has none', () => {
    const parsed = parseAgentDocument(document('modelOrder: [dsh-default]', '\n'))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.body).toBe('')
  })

  it('reads every field in the shared table without a second key list', () => {
    const frontmatter = FRONTMATTER_FIELDS.map((field) =>
      field.kind === 'scalar'
        ? `${field.key}: ${field.key === 'spawn' ? 'spawn' : `${field.key}-value`}`
        : `${field.key}: [${field.key}-item]`,
    ).join('\n')
    const parsed = parseAgentDocument(document(frontmatter))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.extra).toEqual({})
    const fields: Readonly<Record<string, unknown>> = { ...parsed.frontmatter }
    for (const field of FRONTMATTER_FIELDS) {
      expect(fields[field.key], field.key).toEqual(
        field.kind === 'scalar' ? (field.key === 'spawn' ? 'spawn' : `${field.key}-value`) : [`${field.key}-item`],
      )
    }
    // The table order is the single source; the legacy model key stays outside it.
    expect(FRONTMATTER_FIELD_KEYS).toEqual(FRONTMATTER_FIELDS.map((field) => field.key))
    expect(FRONTMATTER_FIELD_KEYS).not.toContain('model')
  })

  it('reads a tab-indented block as one column per tab', () => {
    const parsed = parseAgentDocument(document('notes:\n\tkeep: me\n\t\tdeeper: me'))

    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.extra['notes']).toBe('keep: me\n\tdeeper: me')
  })

  it('still rejects a top-level key that is indented, with the original message', () => {
    const parsed = parseAgentDocument(document('\tname: 审查者'))

    expect(parsed.frontmatter.problems).toEqual(['line 1 is neither a key nor an indented block: name: 审查者'])
  })

  it('keeps blank lines out of a plain block but inside a literal block', () => {
    const plain = parseAgentDocument(document([
      'notes:',
      '  first: 1',
      '',
      '  second: 2',
      'skills: [audit]',
    ].join('\n')))

    expect(plain.frontmatter.problems).toEqual([])
    expect(plain.frontmatter.extra['notes']).toBe('first: 1\nsecond: 2')
    expect(plain.frontmatter.skills).toEqual(['audit'])

    const literal = parseAgentDocument(document([
      'description: |',
      '  first',
      '',
      '  second',
    ].join('\n')))

    expect(literal.frontmatter.problems).toEqual([])
    expect(literal.frontmatter.description).toBe('first\n\nsecond')
  })

  it('reads CRLF frontmatter without leaking carriage returns into values, while the fence keeps its bytes', () => {
    const text = '---\r\nname: 审查者\r\nmodelOrder: [fast]\r\n---\r\n正文\r\n'
    const parsed = parseAgentDocument(text)

    expect(parsed.hasFrontmatter).toBe(true)
    expect(parsed.frontmatter.problems).toEqual([])
    expect(parsed.frontmatter.name).toBe('审查者')
    expect(parsed.frontmatter.modelOrder).toEqual(['fast'])
    expect(parsed.body).toBe('正文')

    const fence = splitAgentFence(text)
    expect(fence.kind).toBe('closed')
    expect(fence.opening).toBe('---\r\n')
    expect(fence.closing).toBe('---\r\n')
  })
})
