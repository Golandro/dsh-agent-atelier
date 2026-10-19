import { describe, expect, it } from 'vitest'

import { parseAgentDocument, splitAgentFence } from '../src/core/index.ts'
import { assembleAgentDocument, composeAgentDocument } from '../src/control/compose.ts'

import type { AgentDefinition } from '../src/contract/index.ts'

/** One fake definition; only the identity fields compose reads. */
function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentName: 'reviewer',
    path: '/ws/.dsh/agents/reviewer.md',
    source: 'project-dsh',
    origin: 'user',
    providerId: 'project-dsh',
    ...overrides,
  } as AgentDefinition
}

describe('splitAgentFence', () => {
  it('round-trips a fenced document byte for byte', () => {
    const text = '---\nname: a\n---\nbody line\n'
    const fence = splitAgentFence(text)
    expect(fence.kind).toBe('closed')
    expect(fence.opening).toBe('---\n')
    expect(fence.frontmatterText).toBe('name: a\n')
    expect(fence.closing).toBe('---\n')
    expect(fence.body).toBe('body line\n')
    expect(fence.opening + fence.frontmatterText + fence.closing + fence.body).toBe(text)
  })

  it('keeps an empty frontmatter block as empty text plus the closing fence', () => {
    const text = '---\n---\nhi'
    const fence = splitAgentFence(text)
    expect(fence).toMatchObject({ kind: 'closed', opening: '---\n', frontmatterText: '', closing: '---\n', body: 'hi' })
  })

  it('round-trips CRLF fence bytes untouched', () => {
    const text = '---\r\nname: a\r\n---\r\nbody\r\n'
    const fence = splitAgentFence(text)
    expect(fence.kind).toBe('closed')
    expect(fence.opening).toBe('---\r\n')
    expect(fence.frontmatterText).toBe('name: a\r\n')
    expect(fence.closing).toBe('---\r\n')
    expect(fence.opening + fence.frontmatterText + fence.closing + fence.body).toBe(text)
  })

  it('keeps a closing fence at EOF without a trailing newline', () => {
    const text = '---\nname: a\n---'
    const fence = splitAgentFence(text)
    expect(fence).toMatchObject({ kind: 'closed', closing: '---', body: '' })
  })

  it('reports a plain document as none and carries the whole text as body', () => {
    const text = 'just prose\n'
    const fence = splitAgentFence(text)
    expect(fence).toEqual({ kind: 'none', opening: '', frontmatterText: '', closing: '', body: text })
  })

  it('reports an unterminated fence', () => {
    const fence = splitAgentFence('---\nname: a')
    expect(fence).toMatchObject({ kind: 'unterminated', opening: '---\n', frontmatterText: 'name: a', closing: '', body: '' })
  })
})

describe('composeAgentDocument', () => {
  it('exposes the raw frontmatter and body as byte-exact blocks', () => {
    const baseText = '---\nname: a\ntrailing: 1\n---\n\nbody\n'
    const doc = composeAgentDocument(definition(), baseText)
    expect(doc.framing).toEqual({ kind: 'fenced', opening: '---\n', closing: '---\n' })
    expect(doc.frontmatterText).toBe('name: a\ntrailing: 1\n')
    expect(doc.bodyText).toBe('\nbody\n')
    expect(doc.blocks.map((block) => block.id)).toEqual(['frontmatter', 'prose'])
    expect(doc.blocks.every((block) => block.file === definition().path)).toBe(true)
    // The inverse assembles the exact input bytes.
    expect(assembleAgentDocument(doc, doc.frontmatterText, doc.bodyText)).toBe(baseText)
  })

  it('composes a plain document as one prose block', () => {
    const baseText = 'only prose\n'
    const doc = composeAgentDocument(definition(), baseText)
    expect(doc.framing).toEqual({ kind: 'plain' })
    expect(doc.frontmatterText).toBe('')
    expect(doc.blocks).toEqual([{ id: 'prose', kind: 'prose', file: definition().path, text: baseText }])
    expect(assembleAgentDocument(doc, '', baseText)).toBe(baseText)
  })

  it('synthesizes a standard fence when a plain document gains frontmatter', () => {
    const doc = composeAgentDocument(definition(), 'prose\n')
    expect(assembleAgentDocument(doc, 'name: a\n', 'prose\n')).toBe('---\nname: a\n---\nprose\n')
  })
})

describe('parseAgentDocument on split fences', () => {
  it('still trims the body and reads the fields after the refactor', () => {
    const parsed = parseAgentDocument('---\nname: a\n---\n\n  body  \n\n')
    expect(parsed.frontmatter.name).toBe('a')
    expect(parsed.body).toBe('body')
  })

  it('reports an unterminated fence as a problem, body empty', () => {
    const parsed = parseAgentDocument('---\nname: a')
    expect(parsed.hasFrontmatter).toBe(true)
    expect(parsed.frontmatter.problems).toEqual(['frontmatter opens with --- but never closes'])
    expect(parsed.body).toBe('')
  })
})
