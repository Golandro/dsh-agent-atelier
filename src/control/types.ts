/**
 * Control-domain types (ticket 11): the composed document an editor reads, the
 * edits it produces, the write plan and report the commit path speaks, the
 * registry-edit union, and the snapshot/query shapes a list view renders from.
 *
 * Shapes here are domain data, not view models: no character offsets, no
 * editor ranges, no fold state. The frozen contract types
 * (`src/contract/types.ts`) are reused as-is wherever a read surface already
 * froze them; this file only adds what the write side needs.
 */
import type {
  AgentDefinition,
  AgentDiagnostic,
  AgentOrigin,
  AgentSource,
  AliasDefinition,
  AliasDiagnostic,
  AliasFinding,
  ModelDefinition,
} from '../contract/index.ts'

/** The two editable parts of a v1 document (single file, no clips — Q1 ruling). */
export type BlockId = 'frontmatter' | 'prose'

/** One editable part of a composed document. */
export interface ComposedBlock {
  readonly id: BlockId
  /** Same vocabulary as `id` today; a wider kind arrives with clips (ticket 14). */
  readonly kind: BlockId
  /** The file this block is written back to; v1 composes single files, so it is the document path. */
  readonly file: string
  /**
   * Raw text of the block. Byte-exact round-trip is the write path's source of
   * truth (D14): the frontmatter block keeps the newline before the closing
   * fence, and the prose block is the raw body — not the trimmed `body` the
   * frozen `AgentDefinition` carries.
   */
  readonly text: string
}

/** How the frontmatter block is framed in the file's raw bytes. */
export type DocumentFraming =
  | { readonly kind: 'plain' }
  /** The raw fence bytes, kept so reassembly is byte-exact (CRLF included). */
  | { readonly kind: 'fenced'; readonly opening: string; readonly closing: string }

/** One agent document as the editor reads it. */
export interface ComposedAgentDocument {
  readonly agentName: string
  /** Absolute path of the document file. */
  readonly path: string
  readonly source: AgentSource
  readonly origin: AgentOrigin
  readonly providerId: string
  /** Raw text between the fences; `''` for a plain document or an empty block. */
  readonly frontmatterText: string
  /** Raw body after the closing fence (the whole text for a plain document). */
  readonly bodyText: string
  /** The file as it was when composed; commit refuses to overwrite a different disk state. */
  readonly baseText: string
  readonly framing: DocumentFraming
  readonly blocks: readonly ComposedBlock[]
}

/** Frontmatter fields the field form edits; each compiles into a raw-text edit (Q5 ruling). */
export type FrontmatterField =
  | 'name'
  | 'description'
  | 'color'
  | 'emoji'
  | 'spawn'
  | 'reasoningEffort'
  | 'modelOrder'
  | 'requiredTools'
  | 'skills'

/** Value of one field edit: a scalar, a list, or a removal. */
export type FrontmatterFieldValue = string | readonly string[] | undefined

/** One edit to a composed document. */
export type DocumentEdit =
  | { readonly kind: 'setBlockText'; readonly agentName: string; readonly blockId: BlockId; readonly text: string }
  | {
      readonly kind: 'setFrontmatterField'
      readonly agentName: string
      readonly field: FrontmatterField
      readonly value: FrontmatterFieldValue
    }

/** One per-file write: what to write, which blocks it covers, and what it was based on. */
export interface WritePlanEntry {
  readonly file: string
  readonly content: string
  readonly blockIds: readonly BlockId[]
  /** Document text as it was when composed; commit refuses to overwrite a different disk state. */
  readonly baseText: string
}

/** Why one edit produced no write. */
export type WriteRejectionCode =
  | 'unknown-agent'
  | 'unknown-block'
  | 'invalid-field'
  | 'unparseable-frontmatter'
  | 'invalid-edit'

/** One edit that planning refused; data, never a throw. */
export interface WriteRejection {
  readonly code: WriteRejectionCode
  /** Human-readable, one line, safe to show in the UI. */
  readonly message: string
  /** Index of the refused edit in the caller's edit list. */
  readonly editIndex: number
}

/** The result of planning edits: pure — same document and edits, same plan; no I/O. */
export interface WritePlan {
  readonly entries: readonly WritePlanEntry[]
  readonly rejections: readonly WriteRejection[]
}

/** Why one file write failed. */
export type WriteFailureCode = 'conflict' | 'invalid-content' | 'io-error' | 'invalid-edit' | 'not-found' | 'read-only'

/** One file's commit result. */
export type WriteResult =
  | { readonly ok: true; readonly file: string }
  | {
      readonly ok: false
      /** The file the failure is about, when one was determined. */
      readonly file: string | undefined
      readonly code: WriteFailureCode
      /** Human-readable, one line, safe to show in the UI. */
      readonly message: string
    }

/** Commit never throws: every failure is one result row. */
export interface WriteReport {
  readonly results: readonly WriteResult[]
}

/** A registry.yaml tuning edit; each kind lands in exactly one layer file. */
export type RegistryEdit =
  | { readonly kind: 'setAvailable'; readonly modelName: string; readonly available: boolean }
  | { readonly kind: 'setSysPrompt'; readonly modelName: string; readonly sysPrompt: string | undefined }
  | { readonly kind: 'remapAlias'; readonly alias: string; readonly target: string }
  | { readonly kind: 'deleteAlias'; readonly alias: string }
  | { readonly kind: 'deleteModel'; readonly modelName: string }
  | {
      readonly kind: 'addAlias'
      readonly alias: string
      readonly target: string
      /** Which layer file to write; the `built-in` pointer is not user-editable. */
      readonly source: 'project-dsh' | 'user-dsh'
    }
  | {
      readonly kind: 'addModel'
      readonly modelName: string
      readonly provider: string
      readonly model: string
      readonly sysPrompt?: string | undefined
      /** Absent means available, exactly as the reader defaults it. */
      readonly available?: boolean | undefined
      readonly source: 'project-dsh' | 'user-dsh'
    }

/**
 * One normalized finding: which scan produced it decides its shape. The UI
 * renders this one list and must not re-merge the three families itself.
 */
export type ControlFinding =
  | { readonly origin: 'agent-scan'; readonly diagnostic: AgentDiagnostic }
  | { readonly origin: 'registry-layer'; readonly diagnostic: AliasDiagnostic }
  | { readonly origin: 'cross-layer'; readonly finding: AliasFinding }

/** Everything a settings view's first render needs, in one read. */
export interface ControlSnapshot {
  readonly agents: readonly AgentDefinition[]
  readonly models: readonly ModelDefinition[]
  readonly aliases: readonly AliasDefinition[]
  readonly agentDiagnostics: readonly AgentDiagnostic[]
  readonly aliasDiagnostics: readonly AliasDiagnostic[]
  readonly findings: readonly ControlFinding[]
}

/** Query options of the agent list; the view's filter/sort config compiles into it. */
export interface AgentListQuery {
  /** Which discovery root layer to show; `undefined` shows all. */
  readonly layer?: 'project' | 'user' | 'bundled' | undefined
  /** Case-insensitive haystack over agent name, display name and description. */
  readonly text?: string | undefined
  /** Only rows with at least one error or hint. */
  readonly onlyIssues?: boolean | undefined
  /** Row order; `undefined` sorts by name. */
  readonly sort?: 'name' | 'layer' | 'issues' | 'models' | undefined
  /** Sort direction; `undefined` is ascending. */
  readonly direction?: 'asc' | 'desc' | undefined
}

/** One list row: the agent plus its issue counts (hints weigh less than errors). */
export interface AgentRow {
  readonly agent: AgentDefinition
  readonly errors: number
  readonly hints: number
}
