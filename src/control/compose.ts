/**
 * Compose: one agent's file bytes → the document an editor reads (ticket 11).
 *
 * This is the only place that decides what the editable blocks are: the
 * frontmatter block is the raw text between the fences and the prose block is
 * the raw body — both byte-exact (D14), so reassembly of an untouched document
 * reproduces the file exactly, CRLF included. The frozen `AgentDefinition`
 * keeps serving its own trimmed `body`; this shape is the editor's, not a
 * second frontmatter model.
 *
 * A document without a fence composes as one prose block; when a field edit
 * later needs frontmatter, {@link assembleAgentDocument} synthesizes the fence
 * around the compiled text.
 */
import { splitAgentFence } from '../core/index.ts'

import type { AgentDefinition } from '../contract/index.ts'
import type { ComposedAgentDocument } from './types.ts'

/** Identity fields every composed block inherits from the definition. */
interface DocumentIdentity {
  readonly agentName: string
  readonly path: string
  readonly source: AgentDefinition['source']
  readonly origin: AgentDefinition['origin']
  readonly providerId: string
}

/** Compose one agent document from its definition and the file bytes as read. */
export function composeAgentDocument(definition: AgentDefinition, baseText: string): ComposedAgentDocument {
  const identity: DocumentIdentity = {
    agentName: definition.agentName,
    path: definition.path,
    source: definition.source,
    origin: definition.origin,
    providerId: definition.providerId,
  }
  const fence = splitAgentFence(baseText)
  if (fence.kind === 'none') {
    return {
      ...identity,
      frontmatterText: '',
      bodyText: fence.body,
      baseText,
      framing: { kind: 'plain' },
      blocks: [{ id: 'prose', kind: 'prose', file: definition.path, text: fence.body }],
    }
  }
  return {
    ...identity,
    frontmatterText: fence.frontmatterText,
    bodyText: fence.body,
    baseText,
    framing: { kind: 'fenced', opening: fence.opening, closing: fence.closing },
    blocks: [
      { id: 'frontmatter', kind: 'frontmatter', file: definition.path, text: fence.frontmatterText },
      { id: 'prose', kind: 'prose', file: definition.path, text: fence.body },
    ],
  }
}

/**
 * Reassemble the file bytes from the document parts — the inverse of
 * {@link composeAgentDocument}.
 *
 * The fence bytes come from the composed framing, so an edit that rewrites one
 * part leaves the others byte-identical. A plain document that gains
 * frontmatter text gets a synthesized standard fence; the compiler guarantees
 * the text ends with its newline, so no blank line is invented.
 */
export function assembleAgentDocument(doc: ComposedAgentDocument, frontmatterText: string, bodyText: string): string {
  if (doc.framing.kind === 'plain') {
    if (frontmatterText === '') return bodyText
    return `---\n${frontmatterText}---\n${bodyText}`
  }
  return doc.framing.opening + frontmatterText + doc.framing.closing + bodyText
}
