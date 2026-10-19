/**
 * 编辑器 chunk 的 React 包装（票 05）。
 *
 * - `loadEditorChunk()` 懒加载 `lib/client.editor.js`，带「编辑器加载中…」与失败重试态；
 * - chunk 就绪后在容器 div 上 `createDocumentEditor` 挂载，`agentName` 变化时销毁重建；
 * - 其余外部状态（块结构 / 已保存文本 / 草稿 / 只读）经 `handle.sync()` 对账；
 * - 卸载 `destroy()`。
 *
 * sync 触发采取「按值对账」而不是每次渲染都调：编辑器自己敲键回传的草稿在
 * `onDraftText` 里同步进 appliedDrafts（编辑器已知值），因此纯打字引发的 props
 * 变化不会触发 sync；只有外部状态真正变化（回退块 / 保存后重组 / 结构切换 /
 * 只读切换）才调一次 `sync`，避免每次击键都打扰 CodeMirror。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { loadEditorChunk } from './chunk-loader.ts'

import type { DocumentEditorHandle, DocumentEditorOptions, EditorBlock, EditorChunk, EditorFraming } from './chunk-contracts.ts'
import type { ReactNode } from 'react'

export interface EditorMountProps {
  readonly agentName: string
  readonly framing: EditorFraming
  readonly blocks: readonly EditorBlock[]
  /** 未保存草稿：blockId → 文本；编辑器内未草稿化的块显示已保存文本。 */
  readonly drafts: Readonly<Record<string, string>>
  readonly readonly: boolean
  /** 编辑器实时回传的块文本（外部 sync 不触发）。 */
  onDraftText(blockId: string, text: string): void
  /** 块头请求保存该块。 */
  onSaveBlock(blockId: string): void
  /** 块头请求回退该块。 */
  onRevertBlock(blockId: string): void
}

type ChunkState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly chunk: EditorChunk }
  | { readonly status: 'error'; readonly message: string }

export function EditorMount(props: EditorMountProps): ReactNode {
  const [chunkState, setChunkState] = useState<ChunkState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<DocumentEditorHandle | null>(null)
  // latest-props：挂载 / sync 时取当下回调，避免把陈旧闭包传进命令式句柄。
  const propsRef = useRef(props)
  // 编辑器已应用（或自己产出）的草稿，用于跳过无变化的 sync。
  const appliedDraftsRef = useRef<Readonly<Record<string, string>>>({})
  // 上次 create/sync 时外部状态（结构 + 只读）的签名。
  const lastSignatureRef = useRef('')

  // 每次渲染先刷新 latest-props，再执行下面的挂载 / sync 效应（声明序保证先后）。
  useEffect(() => {
    propsRef.current = props
  })

  // chunk 懒加载：不可 abort，用 cancelled 标记丢弃过期结果；attempt 驱动重试。
  useEffect(() => {
    let cancelled = false
    setChunkState({ status: 'loading' })
    Promise.resolve()
      .then(loadEditorChunk)
      .then((chunk) => {
        if (!cancelled) setChunkState({ status: 'ready', chunk })
      })
      .catch((error: unknown) => {
        if (!cancelled) setChunkState({ status: 'error', message: errorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  // 挂载：chunk 就绪即创建；agentName 变化时本效应重跑 = 销毁重建。
  useEffect(() => {
    if (chunkState.status !== 'ready') return
    const container = containerRef.current
    if (container === null) return
    const current = propsRef.current
    const handle = chunkState.chunk.createDocumentEditor(container, buildOptions(current, appliedDraftsRef))
    handleRef.current = handle
    appliedDraftsRef.current = { ...current.drafts }
    lastSignatureRef.current = externalSignature(current)
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [chunkState, props.agentName])

  // 对账：外部状态与编辑器已知值不一致才 sync（渲染期逐次判定，代价可忽略）。
  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    const current = propsRef.current
    const signature = externalSignature(current)
    if (signature === lastSignatureRef.current && shallowEqualDrafts(current.drafts, appliedDraftsRef.current)) return
    handle.sync(buildOptions(current, appliedDraftsRef))
    appliedDraftsRef.current = { ...current.drafts }
    lastSignatureRef.current = signature
  })

  if (chunkState.status === 'loading') {
    return h('div', { className: 'doc-editor-status' }, '编辑器加载中…')
  }
  if (chunkState.status === 'error') {
    return h(
      'div',
      { className: 'doc-editor-status doc-editor-status-error', role: 'alert' },
      h('p', null, `编辑器加载失败：${chunkState.message}`),
      h('button', { type: 'button', className: 'btn btn-sm', onClick: () => setAttempt(attempt + 1) }, '重试'),
    )
  }
  // 编辑器命令式挂载点：cm-* 样式以 .doc-editor 为容器。
  return h('div', { className: props.readonly ? 'doc-editor readonly' : 'doc-editor', ref: containerRef })
}

/** 组装 create/sync 共用的选项；回调一律走 latest-props。appliedDrafts 由调用方传 ref 进来记账。 */
function buildOptions(
  p: EditorMountProps,
  appliedDrafts: { current: Readonly<Record<string, string>> },
): DocumentEditorOptions {
  return {
    agentName: p.agentName,
    framing: p.framing,
    blocks: p.blocks,
    drafts: p.drafts,
    readonly: p.readonly,
    onDraftText: (blockId, text) => {
      // 编辑器自己产出的文本记为「已应用」，纯打字不触发回灌 sync。
      appliedDrafts.current = { ...appliedDrafts.current, [blockId]: text }
      p.onDraftText(blockId, text)
    },
    onSaveBlock: (blockId) => p.onSaveBlock(blockId),
    onRevertBlock: (blockId) => p.onRevertBlock(blockId),
  }
}

/** 外部状态签名：framing + 块结构/文本 + 只读。agentName 由销毁重建负责，不进来。 */
function externalSignature(p: EditorMountProps): string {
  return JSON.stringify([p.framing, p.blocks.map((block) => [block.id, block.kind, block.text]), p.readonly])
}

function shallowEqualDrafts(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((key) => a[key] === b[key])
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
